import { randomBytes } from 'node:crypto';
// Эталонный клиент MLS через серверный контракт: приглашение, приветствие, сообщение, удаление.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createIdentity, parseKeyPackage, createGroupState, addMember, removeMember, joinFromWelcome, processCommit, encryptText, decryptText } from './mls-reference-client.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!reference:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const enc = encodeURIComponent;

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('эталонный клиент: группа через серверный контракт — приглашение, приветствие, сообщение, удаление', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    const carol = await ChatClient.create(s.base, CAROL, 'C_PHONE', PW);
    await alice.createRoom(ROOM, [ALICE]);
    const aliceId = await createIdentity('alice');
    const bobId = await createIdentity('bob');
    const carolId = await createIdentity('carol');
    await bob.raw('POST', '/mls/key-packages', { packages: [bobId.keyPackageB64] });
    await carol.raw('POST', '/mls/key-packages', { packages: [carolId.keyPackageB64] });

    // Алиса приглашает Боба: пакет берётся с сервера, коммит и приветствие уходят через сервер.
    let aliceState = await createGroupState(aliceId, ROOM);
    const bobPackage = (await alice.raw('GET', `/mls/key-packages/${enc(BOB)}`)).packages[0];
    const addBob = await addMember(aliceState, parseKeyPackage(bobPackage.package));
    assert.equal((await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 0, commit: addBob.commitB64, changes: { adds: [BOB], removes: [] },
      welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: addBob.welcomeB64 }],
    })).epoch, 1);
    aliceState = addBob.newState;
    let bobState = await joinFromWelcome((await bob.raw('GET', '/mls/welcomes')).welcomes[0].welcome, bobId);
    const hello = await encryptText(aliceState, 'привет, Боб');
    aliceState = hello.newState;
    assert.equal((await decryptText(bobState, hello.messageB64)).text, 'привет, Боб', 'Боб читает сообщение после приглашения');

    // Алиса приглашает Кэрол; Боб обрабатывает коммит, полученный с сервера.
    const carolPackage = (await alice.raw('GET', `/mls/key-packages/${enc(CAROL)}`)).packages[0];
    const addCarol = await addMember(aliceState, parseKeyPackage(carolPackage.package));
    assert.equal((await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 1, commit: addCarol.commitB64, changes: { adds: [CAROL], removes: [] },
      welcomes: [{ userId: CAROL, deviceId: 'C_PHONE', welcome: addCarol.welcomeB64 }],
    })).epoch, 2);
    aliceState = addCarol.newState;
    const fromServer = (await bob.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=1`)).commits;
    for (const c of fromServer) bobState = await processCommit(bobState, c.commit);
    let carolState = await joinFromWelcome((await carol.raw('GET', '/mls/welcomes')).welcomes[0].welcome, carolId);
    const second = await encryptText(aliceState, 'Кэрол, добро пожаловать');
    aliceState = second.newState;
    assert.equal((await decryptText(carolState, second.messageB64)).text, 'Кэрол, добро пожаловать', 'Кэрол читает');
    assert.equal((await decryptText(bobState, second.messageB64)).text, 'Кэрол, добро пожаловать', 'Боб читает после добавления Кэрол');

    // Алиса удаляет Боба (лист 1): коммит с удалением уходит через сервер.
    const removeBob = await removeMember(aliceState, 1);
    assert.equal((await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 2, commit: removeBob.commitB64, changes: { adds: [], removes: [BOB] },
    })).epoch, 3);
    aliceState = removeBob.newState;
    carolState = await processCommit(carolState, (await carol.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=2`)).commits[0].commit);
    await assert.rejects(bob.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=2`), (e) => e.status === 403, 'удалённый не получает коммиты с сервера');
    const bye = await encryptText(aliceState, 'после удаления Боба');
    assert.equal((await decryptText(carolState, bye.messageB64)).text, 'после удаления Боба', 'Кэрол читает новые сообщения');
    await assert.rejects(decryptText(bobState, bye.messageB64), 'Боб не читает сообщения после удаления');
  } finally {
    await s.stop();
  }
});
