import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createMemoryStore } from '../src/store-memory.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { buildPrivateMessageHeader } from '../src/mls-wire.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const enc = encodeURIComponent;
const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
const keyPackage = (label) => b64(`KEYPACKAGE-${label}-${'x'.repeat(48)}`);

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({
    defaultOrgAutoJoin: false,
    registrationMode: 'open',
    requirePhone: false,
    pinPepper: PEPPER,
    store,
  });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { base, db, store, stop: async () => { await new Promise((resolve) => srv.server.close(resolve)); await db?.close(); } };
}

test('direct chats require no recipient approval and activate automatically through claimed multi-device MLS Welcome', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    const bobTablet = await ChatClient.loginFromNewDevice(s.base, BOB, PW, 'B_TABLET', bob);
    const carol = await ChatClient.create(s.base, CAROL, 'C_PHONE', PW);

    const opened = await alice.raw('POST', '/direct-chats/open', { userId: BOB });
    assert.equal(opened.status, 'provisioning');
    assert.equal(opened.created, true);
    assert.equal(opened.isCreator, true);
    assert.ok(opened.roomId.startsWith('!dm_'));

    const reverseOpen = await bob.raw('POST', '/direct-chats/open', { userId: ALICE });
    assert.equal(reverseOpen.roomId, opened.roomId, 'A→B and B→A resolve to one canonical pair');
    assert.equal(reverseOpen.status, 'provisioning');
    assert.equal(reverseOpen.created, false);
    assert.equal(reverseOpen.isCreator, false);

    await assert.rejects(
      bob.raw('GET', `/rooms/${enc(opened.roomId)}/members`),
      (error) => error.status === 403,
      'membership is provisioned automatically, without recipient approval, by the MLS Welcome',
    );

    const resumed = await alice.raw('POST', '/rooms', { roomId: opened.roomId, members: [ALICE] });
    assert.equal(resumed.status, 'provisioning');
    assert.equal(resumed.resumed, true, 'native MLS group initialization can resume the reserved direct room');

    await bob.raw('POST', '/mls/key-packages', { packages: [keyPackage('B_PHONE')] });
    await bobTablet.raw('POST', '/mls/key-packages', { packages: [keyPackage('B_TABLET')] });
    const claimId = 'direct-chat-claim-bob-0001';
    const claim = await alice.raw('POST', `/mls/key-packages/${enc(BOB)}/claims`, {
      claimId,
      roomId: opened.roomId,
    });
    assert.deepEqual(claim.packages.map((item) => item.deviceId).sort(), ['B_PHONE', 'B_TABLET']);

    const epoch = (await alice.raw('GET', `/mls/groups/${enc(opened.roomId)}/epoch`)).epoch;
    const welcomes = claim.packages.map((item) => ({
      userId: BOB,
      deviceId: item.deviceId,
      welcome: b64(`WELCOME-${item.deviceId}`),
    }));
    const committed = await alice.raw('POST', `/mls/groups/${enc(opened.roomId)}/commits`, {
      epoch,
      clientOperationId: claimId,
      keyPackageClaimId: claimId,
      commit: b64('DIRECT-ADD-COMMIT'),
      changes: { adds: [BOB], removes: [] },
      welcomes,
    });
    assert.equal(committed.epoch, epoch + 1);

    const members = (await alice.raw('GET', `/rooms/${enc(opened.roomId)}/members`)).members;
    assert.deepEqual([...members].sort(), [ALICE, BOB].sort());
    const bobRooms = (await bob.raw('GET', '/rooms/mine')).rooms;
    const bobDirectRoom = bobRooms.find((room) => room.roomId === opened.roomId);
    assert.ok(bobDirectRoom);
    assert.equal(bobDirectRoom.kind, 'direct');
    assert.notEqual(bobDirectRoom.name, opened.roomId, 'the room list uses the peer display name instead of the opaque room ID');
    assert.equal((await bob.raw('GET', '/mls/welcomes')).welcomes.length, 1);
    assert.equal((await bobTablet.raw('GET', '/mls/welcomes')).welcomes.length, 1);
    const wireMessage = Buffer.concat([
      buildPrivateMessageHeader(opened.roomId, committed.epoch),
      Buffer.from('opaque-mls-ciphertext'),
    ]).toString('base64');
    const sent = await alice.raw('POST', `/mls/groups/${enc(opened.roomId)}/messages`, {
      message: wireMessage,
      kind: 'text',
    });
    assert.equal(typeof sent.event_id, 'string', 'creator can send through the MLS-only message route');
    const delivered = await bob.raw('GET', `/rooms/${enc(opened.roomId)}/events?since=0`);
    assert.ok(delivered.events.some((event) => event.event_id === sent.event_id),
      'recipient receives the sent message without accepting a chat request');
    const replyWireMessage = Buffer.concat([
      buildPrivateMessageHeader(opened.roomId, committed.epoch),
      Buffer.from('opaque-mls-reply-ciphertext'),
    ]).toString('base64');
    const reply = await bob.raw('POST', `/mls/groups/${enc(opened.roomId)}/messages`, {
      message: replyWireMessage,
      kind: 'text',
    });
    const senderHistory = await alice.raw('GET', `/rooms/${enc(opened.roomId)}/events?since=0`);
    assert.ok(senderHistory.events.some((event) => event.event_id === reply.event_id),
      'recipient can reply without accepting a chat request');
    const thirdPartyWrite = await s.store.appendRoomEvent(
      opened.roomId, CAROL, 'm.room.encrypted', { ciphertext: 'third-party' }, Date.now(),
    );
    assert.equal(thirdPartyWrite.state, 'not_member');

    const activeOpen = await bob.raw('POST', '/direct-chats/open', { userId: ALICE });
    assert.equal(activeOpen.roomId, opened.roomId);
    assert.equal(activeOpen.status, 'active');
    assert.equal(activeOpen.created, false);

    await assert.rejects(
      carol.raw('GET', `/mls/groups/${enc(opened.roomId)}/epoch`),
      (error) => error.status === 403,
      'a third account cannot read a direct conversation epoch',
    );
    const unrelated = await carol.raw('POST', '/direct-chats/open', { userId: ALICE });
    assert.notEqual(unrelated.roomId, opened.roomId, 'a third user gets a separate pair conversation');

    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/settings`, { visibility: 'public', joinPolicy: 'open' }),
      (error) => error.status === 404,
      'direct conversations cannot be converted into public groups',
    );
    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/invites`, {}),
      (error) => error.status === 404,
      'direct conversations do not expose group invite links',
    );
    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/roles`, { userId: BOB, role: 'admin' }),
      (error) => error.status === 404,
      'direct conversations do not expose group roles',
    );
    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/capabilities`, { userId: BOB, capabilities: [] }),
      (error) => error.status === 404,
      'direct conversations do not expose group capabilities',
    );
    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/owner`, { userId: BOB }),
      (error) => error.status === 404,
      'direct conversations do not expose group ownership transfer',
    );
    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/appearance`, {}),
      (error) => error.status === 404,
      'direct conversations do not expose group appearance',
    );
    await assert.rejects(
      alice.raw('GET', `/rooms/${enc(opened.roomId)}/stickers`),
      (error) => error.status === 404,
      'direct conversations do not expose group stickers',
    );
    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/assets`, {}),
      (error) => error.status === 404,
      'direct conversations do not accept group appearance assets',
    );
    await assert.rejects(
      alice.raw('GET', `/rooms/${enc(opened.roomId)}/assets/pending`),
      (error) => error.status === 404,
      'direct conversations do not expose pending group assets',
    );
    await assert.rejects(
      alice.raw('GET', `/rooms/${enc(opened.roomId)}/assets/not-an-asset`),
      (error) => error.status === 404,
      'direct conversations do not expose group assets',
    );
    await assert.rejects(
      alice.raw('POST', `/rooms/${enc(opened.roomId)}/members`, { userId: CAROL }),
      (error) => error.status === 409,
      'a direct conversation cannot add a third account through the legacy route',
    );
    await assert.rejects(
      alice.raw('POST', `/mls/key-packages/${enc(CAROL)}/claims`, {
        claimId: 'direct-chat-claim-carol-0001',
        roomId: opened.roomId,
      }),
      (error) => error.status === 403,
      'the direct pair cannot claim a Welcome for a third account',
    );
  } finally {
    await s.stop();
  }
});

test('concurrent opens from opposite sides reserve exactly one direct room', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    const [fromAlice, fromBob] = await Promise.all([
      alice.raw('POST', '/direct-chats/open', { userId: BOB }),
      bob.raw('POST', '/direct-chats/open', { userId: ALICE }),
    ]);
    assert.equal(fromAlice.roomId, fromBob.roomId);
    assert.equal([fromAlice.created, fromBob.created].filter(Boolean).length, 1);
    assert.equal([fromAlice.isCreator, fromBob.isCreator].filter(Boolean).length, 1);
    assert.equal(fromAlice.status, 'provisioning');
    assert.equal(fromBob.status, 'provisioning');
  } finally {
    await s.stop();
  }
});

test('direct chat open rejects self-pairs and unknown accounts', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    await assert.rejects(
      alice.raw('POST', '/direct-chats/open', { userId: ALICE }),
      (error) => error.status === 400,
    );
    await assert.rejects(
      alice.raw('POST', '/direct-chats/open', { userId: '@missing:inone.test' }),
      (error) => error.status === 404,
    );
  } finally {
    await s.stop();
  }
});
