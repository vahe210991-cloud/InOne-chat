import { randomBytes } from 'node:crypto';
// Сообщения групп через серверный контракт: шифротекст MLS проверяется по группе и эпохе в открытом заголовке.
import { postGroupEvent, mlsMessageAt, mlsMessageBase64 } from './group-message-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createIdentity, parseKeyPackage, createGroupState, addMember, removeMember, selfUpdate, joinFromWelcome, processCommit, encryptText, decryptText } from './mls-reference-client.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!messages:inone.test';
const ROOM2 = '!messages-other:inone.test';
const ROOM3 = '!messages-empty:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const enc = encodeURIComponent;
const claimKeyPackage = (client, userId) => client.raw('POST', `/mls/key-packages/${enc(userId)}/claim`, { claimId: randomBytes(16).toString('hex') });
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function group() {
  const s = await start();
  const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
  const carol = await ChatClient.create(s.base, CAROL, 'C_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE]);
  await alice.createRoom(ROOM2, [ALICE]);
  await alice.createRoom(ROOM3, [ALICE]);
  const aliceId = await createIdentity('alice');
  const bobId = await createIdentity('bob');
  const carolId = await createIdentity('carol');
  await bob.raw('POST', '/mls/key-packages', { packages: [bobId.keyPackageB64] });
  await carol.raw('POST', '/mls/key-packages', { packages: [carolId.keyPackageB64] });
  let aliceState = await createGroupState(aliceId, ROOM);
  const addBob = await addMember(aliceState, parseKeyPackage((await claimKeyPackage(alice, BOB)).packages[0].package));
  await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 0, commit: addBob.commitB64, changes: { adds: [BOB], removes: [] }, welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: addBob.welcomeB64 }] });
  aliceState = addBob.newState;
  const bobState = await joinFromWelcome((await bob.raw('GET', '/mls/welcomes')).welcomes[0].welcome, bobId);
  return { ...s, alice, bob, carol, aliceId, bobId, carolId, aliceState, bobState };
}

test('сообщение группы через MLS: участник читает и расшифровывает, эпоха совпадает', async () => {
  const g = await group();
  try {
    const sent = await encryptText(g.aliceState, 'первое');
    const r = await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: sent.messageB64, kind: 'text' });
    assert.match(r.event_id, /^\$\d+$/);
    const events = (await g.bob.raw('GET', `/rooms/${enc(ROOM)}/events`)).events;
    const last = events.at(-1);
    assert.equal(last.type, 'm.room.encrypted');
    assert.equal((await decryptText(g.bobState, last.content.mls)).text, 'первое');
  } finally {
    await g.stop();
  }
});

test('сообщение в старой эпохе отклоняется; после нового приглашения пишем уже в текущей эпохе', async () => {
  const g = await group();
  try {
    const old = await encryptText(g.aliceState, 'в эпохе один');
    const addCarol = await addMember(g.aliceState, parseKeyPackage((await claimKeyPackage(g.alice, CAROL)).packages[0].package));
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 1, commit: addCarol.commitB64, changes: { adds: [CAROL], removes: [] }, welcomes: [{ userId: CAROL, deviceId: 'C_PHONE', welcome: addCarol.welcomeB64 }] });
    await assert.rejects(g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: old.messageB64 }), (e) => e.status === 409, 'старая эпоха');
    const fresh = await encryptText(addCarol.newState, 'в эпохе два');
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: fresh.messageB64 });
  } finally {
    await g.stop();
  }
});

test('сообщение, зашифрованное для другой группы, отклоняется', async () => {
  const g = await group();
  try {
    const other = await g.alice.raw('POST', `/mls/groups/${enc(ROOM2)}/commits`, { epoch: 0, commit: (await selfUpdate(await createGroupState(g.aliceId, ROOM2))).commitB64, changes: { adds: [], removes: [] } });
    assert.equal(other.epoch, 1);
    const sent = await encryptText(g.aliceState, 'не для ROOM2');
    await assert.rejects(g.alice.raw('POST', `/mls/groups/${enc(ROOM2)}/messages`, { message: sent.messageB64 }), (e) => e.status === 400, 'чужая группа');
  } finally {
    await g.stop();
  }
});

test('группа без эпохи не принимает сообщения; старый маршрут закрыт для группы с эпохой', async () => {
  const g = await group();
  try {
    const empty = await encryptText(await createGroupState(g.aliceId, ROOM3), 'без эпохи');
    await assert.rejects(g.alice.raw('POST', `/mls/groups/${enc(ROOM3)}/messages`, { message: empty.messageB64 }), (e) => e.status === 409, 'группа без эпохи');
    await assert.rejects(g.alice.raw('POST', `/rooms/${enc(ROOM)}/events`, { type: 'm.room.encrypted', content: { ciphertext: 'x' } }), (e) => e.status === 409, 'старый маршрут для MLS-группы');
  } finally {
    await g.stop();
  }
});

test('удалённый участник не пишет и не читает группу', async () => {
  const g = await group();
  try {
    const removeBob = await removeMember(g.aliceState, 1);
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 1, commit: removeBob.commitB64, changes: { adds: [], removes: [BOB] } });
    const sent = await encryptText(g.bobState, 'после удаления');
    await assert.rejects(g.bob.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: sent.messageB64 }), (e) => e.status === 403, 'удалённый не пишет');
    await assert.rejects(g.bob.raw('GET', `/rooms/${enc(ROOM)}/events`), (e) => e.status === 403, 'удалённый не читает');
  } finally {
    await g.stop();
  }
});

test('сообщение больше 64 КБ отклоняется', async () => {
  const g = await group();
  try {
    await assert.rejects(g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: Buffer.alloc(70 * 1024, 7).toString('base64') }), (e) => e.status === 400);
  } finally {
    await g.stop();
  }
});

test('правка сообщения группы MLS: проходит в текущей эпохе, в старой отклоняется', async () => {
  const g = await group();
  try {
    const sent = await postGroupEvent(g.alice, ROOM, { type: 'm.room.encrypted' });
    const oldEdit = mlsMessageAt(ROOM, 1, 'старая правка');
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 1, commit: b64('ADVANCE'), changes: { adds: [], removes: [] } });
    await assert.rejects(g.alice.raw('POST', `/rooms/${enc(ROOM)}/events/${enc(sent.event_id)}/edit`, { type: 'm.room.encrypted', message: oldEdit }), (e) => e.status === 409, 'правка в старой эпохе');
    const other = await g.alice.raw('POST', `/mls/groups/${enc(ROOM2)}/commits`, { epoch: 0, commit: b64('OTHER'), changes: { adds: [], removes: [] } });
    const foreign = mlsMessageAt(ROOM2, other.epoch, 'чужая группа');
    await assert.rejects(g.alice.raw('POST', `/rooms/${enc(ROOM)}/events/${enc(sent.event_id)}/edit`, { type: 'm.room.encrypted', message: foreign }), (e) => e.status === 400, 'правка сообщением другой группы');
    const fresh = await mlsMessageBase64(g.alice, ROOM, 'новая версия');
    await g.alice.raw('POST', `/rooms/${enc(ROOM)}/events/${enc(sent.event_id)}/edit`, { type: 'm.room.encrypted', message: fresh });
    const replacement = (await g.bob.raw('GET', `/rooms/${enc(ROOM)}/events`)).events.find((e) => e.type === 'm.room.encrypted.replace');
    assert.equal(replacement.content.replaces, sent.event_id);
  } finally {
    await g.stop();
  }
});

test('автор удаляет своё сообщение группы MLS: содержимое исчезает из ленты', async () => {
  const g = await group();
  try {
    const sent = await postGroupEvent(g.alice, ROOM, { type: 'm.room.encrypted' });
    const before = (await g.bob.raw('GET', `/rooms/${enc(ROOM)}/events`)).events.find((e) => e.event_id === sent.event_id);
    assert.equal(typeof before.content.mls, 'string', 'до удаления шифротекст виден участникам');
    await g.alice.raw('POST', `/rooms/${enc(ROOM)}/events/${enc(sent.event_id)}/redact`, {});
    const after = (await g.bob.raw('GET', `/rooms/${enc(ROOM)}/events`)).events.find((e) => e.event_id === sent.event_id);
    assert.equal(after.type, 'm.room.redacted', 'событие помечено как удалённое');
    assert.equal(after.content?.mls, undefined, 'шифротекста после удаления нет');
  } finally {
    await g.stop();
  }
});

