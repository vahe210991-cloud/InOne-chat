// Публичные группы: поиск по названию, вступление свободно или по заявке,
// приватная группа не видна посторонним.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { storeForTest } from './helpers.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ROOM = '!club:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const EVE = '@eve:inone.test';
const enc = encodeURIComponent;

async function start() {
  const db = await storeForTest('test-pepper-0123456789-0123456789-abcd');
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: 'test-pepper-0123456789-0123456789-abcd', store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function clubWith(base) {
  const users = { alice: [ALICE, 'A_PHONE'], bob: [BOB, 'B_PHONE'], carol: [CAROL, 'C_PHONE'], dave: [DAVE, 'D_PHONE'], eve: [EVE, 'E_PHONE'] };
  const c = {};
  for (const [name, [id, device]] of Object.entries(users)) c[name] = await ChatClient.create(base, id, device, PW);
  for (const client of Object.values(c)) await client.publishKeys();
  await c.alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  return c;
}

function post(client, path, body) {
  return client.raw('POST', `/rooms/${enc(ROOM)}${path}`, body);
}

function makePublic(owner, name, joinPolicy) {
  return post(owner, '/settings', { name, visibility: 'public', ...(joinPolicy ? { joinPolicy } : {}) });
}

function search(client, q) {
  return client.raw('GET', `/rooms/search?q=${enc(q)}`);
}

function membersOf(client) {
  return client.raw('GET', `/rooms/${enc(ROOM)}/members`);
}

function requestsOf(client) {
  return client.raw('GET', `/rooms/${enc(ROOM)}/requests`);
}

function decide(owner, userId, decision) {
  return post(owner, `/requests/${enc(userId)}/${decision}`, {});
}

function grant(owner, userId, capabilities) {
  return post(owner, '/capabilities', { userId, capabilities });
}

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
const pkg = (name) => Buffer.from(`KEYPACKAGE-${name}-${'x'.repeat(40)}`).toString('base64');

async function approveJoinRequestViaMls(owner, requester, targetUserId, claimId) {
  await requester.raw('POST', '/mls/key-packages', { packages: [pkg(`${targetUserId}-${claimId}`)] });
  const claim = await owner.raw('POST', `/mls/key-packages/${enc(targetUserId)}/claims`, { claimId, roomId: ROOM });
  assert.ok(claim.packages.some((item) => item.deviceId === requester.deviceId), 'requester device KeyPackage is claimed');
  const welcomes = claim.packages.map((item) => ({
    userId: targetUserId,
    deviceId: item.deviceId,
    welcome: b64(`WELCOME-${claimId}-${item.deviceId}`),
  }));
  const epoch = (await owner.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch;
  return owner.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
    epoch,
    commit: b64(`COMMIT-${claimId}`),
    changes: { adds: [targetUserId], removes: [] },
    welcomes,
    clientOperationId: claimId,
    keyPackageClaimId: claimId,
    joinRequestUserId: targetUserId,
  });
}

test('приватная группа не находится поиском, и посторонний не может в неё вступить', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await post(c.alice, '/settings', { name: 'Тайный клуб' });
    assert.deepEqual((await search(c.dave, 'тайн')).rooms, []);
    await assert.rejects(post(c.dave, '/join', {}), (e) => e.status === 404);
  } finally {
    await stop();
  }
});

test('публичная группа находится по названию; состав видят только участники', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice, 'Соседи квартала');
    const found = (await search(c.dave, 'сосед')).rooms;
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'Соседи квартала');
    assert.equal(found[0].join_policy, 'approval');
    assert.equal(found[0].members, 3);
    assert.equal(found[0].roomId, ROOM);
    await assert.rejects(membersOf(c.dave), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('вступление по умолчанию по заявке: заявку видит тот, у кого есть право приглашать', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice, 'Соседи квартала');
    assert.equal((await post(c.dave, '/join', {})).status, 'requested');
    assert.deepEqual((await requestsOf(c.alice)).requests.map((r) => r.userId), [DAVE]);
    await assert.rejects(requestsOf(c.bob), (e) => e.status === 403);
    await assert.rejects(decide(c.alice, DAVE, 'approve'), (error) => error.status === 409);
    assert.equal((await approveJoinRequestViaMls(c.alice, c.dave, DAVE, 'join-approval-public-dave-0003')).epoch, 2);
    assert.ok((await membersOf(c.alice)).members.includes(DAVE));
    assert.equal((await post(c.eve, '/join', {})).status, 'requested');
    assert.equal((await decide(c.alice, EVE, 'reject')).status, 'rejected');
    assert.ok(!(await membersOf(c.alice)).members.includes(EVE));
  } finally {
    await stop();
  }
});

test('открытая группа создаёт MLS-заявку; после Add Commit участник читает только новые события', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice, 'Соседи квартала', 'open');
    await c.alice.sendText(ROOM, 'до вступления');
    assert.equal((await post(c.dave, '/join', {})).status, 'requested');
    assert.ok(!(await membersOf(c.alice)).members.includes(DAVE));
    await approveJoinRequestViaMls(c.alice, c.dave, DAVE, 'join-approval-open-dave-0005');
    await c.alice.sync();
    await c.dave.sync();
    await c.alice.sendText(ROOM, 'после вступления');
    await c.dave.sync();
    assert.deepEqual((await c.dave.readText(ROOM)).map((m) => m.body), ['после вступления']);
  } finally {
    await stop();
  }
});

test('одобрить заявку может только тот, у кого есть право приглашать', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await c.dave.publishKeys();
    await makePublic(c.alice, 'Соседи квартала');
    await post(c.dave, '/join', {});
    await assert.rejects(decide(c.bob, DAVE, 'approve'), (e) => e.status === 403);
    await grant(c.alice, BOB, ['send_messages', 'invite_members']);
    assert.equal((await approveJoinRequestViaMls(c.bob, c.dave, DAVE, 'join-approval-bob-dave-0001')).epoch, 2);
  } finally {
    await stop();
  }
});

test('повторная заявка не создаёт дубликата; переход в приватную группу отменяет заявки', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await c.dave.publishKeys();
    await makePublic(c.alice, 'Соседи квартала');
    await post(c.dave, '/join', {});
    await post(c.dave, '/join', {});
    assert.equal((await requestsOf(c.alice)).requests.length, 1);
    await post(c.alice, '/settings', { visibility: 'private' });
    assert.equal((await requestsOf(c.alice)).requests.length, 0);
    await assert.rejects(post(c.dave, '/join', {}), (e) => e.status === 404);
  } finally {
    await stop();
  }
});

test('участник, вступивший по заявке, получает права по умолчанию', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await c.dave.publishKeys();
    await makePublic(c.alice, 'Соседи квартала');
    await post(c.dave, '/join', {});
    await approveJoinRequestViaMls(c.alice, c.dave, DAVE, 'join-approval-default-rights-0002');
    const caps = (await membersOf(c.alice)).capabilities[DAVE];
    assert.ok(caps.includes('send_messages'));
    assert.ok(!caps.includes('invite_members'));
  } finally {
    await stop();
  }
});

test('поиск: короткий запрос отклоняется, символы подстановки ничего не открывают', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await c.dave.publishKeys();
    await makePublic(c.alice, 'Соседи квартала');
    await assert.rejects(search(c.dave, 'с'), (e) => e.status === 400);
    assert.deepEqual((await search(c.dave, '%%')).rooms, []);
    assert.deepEqual((await search(c.dave, '_о')).rooms, []);
  } finally {
    await stop();
  }
});
