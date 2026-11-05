// Редактирование и удаление сообщений беседы. Удалённое содержимое не остаётся на сервере,
// включая журнал запросов.
import { postGroupEvent, mlsMessageBase64 } from './group-message-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { storeForTest } from './helpers.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ROOM = '!club:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
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
  const users = { alice: [ALICE, 'A_PHONE'], bob: [BOB, 'B_PHONE'], carol: [CAROL, 'C_PHONE'], eve: [EVE, 'E_PHONE'] };
  const c = {};
  for (const [name, [id, device]] of Object.entries(users)) c[name] = await ChatClient.create(base, id, device, PW);
  for (const client of Object.values(c)) await client.publishKeys();
  await c.alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  return c;
}

function post(client, path, body) {
  return client.raw('POST', `/rooms/${enc(ROOM)}${path}`, body);
}

function sendEvent(client, ciphertext = 'x') {
  return postGroupEvent(client, ROOM, { type: 'm.room.encrypted', content: { ciphertext } });
}

async function editEvent(client, eventId, ciphertext) {
  return post(client, `/events/${enc(eventId)}/edit`, { type: 'm.room.encrypted', message: await mlsMessageBase64(client, ROOM, ciphertext) });
}

function redactEvent(client, eventId) {
  return post(client, `/events/${enc(eventId)}/redact`, {});
}

function grant(owner, userId, capabilities) {
  return post(owner, '/capabilities', { userId, capabilities });
}

async function eventsOf(client) {
  return (await client.raw('GET', `/rooms/${enc(ROOM)}/events`)).events;
}

/** Состояние, которое хранит сервер: комнаты, очередь, ключи. Без журнала запросов и писем. */
async function storedState(srv) {
  const { wireLog, outbox, ...state } = JSON.parse(await srv.dump());
  return JSON.stringify(state);
}

test('автор редактирует своё сообщение; чужое редактировать нельзя', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'первая версия');
    await assert.rejects(editEvent(c.carol, sent.event_id, 'чужая правка'), (e) => e.status === 403);
    await editEvent(c.bob, sent.event_id, 'вторая версия');
    const replacement = (await eventsOf(c.carol)).find((e) => e.type === 'm.room.encrypted.replace');
    assert.equal(replacement.content.replaces, sent.event_id);
    assert.equal(replacement.sender, BOB);
  } finally {
    await stop();
  }
});

test('без права edit_own_messages автор не редактирует', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await grant(c.alice, BOB, ['send_messages']);
    const sent = await sendEvent(c.bob, 'текст');
    await assert.rejects(editEvent(c.bob, sent.event_id, 'правка'), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('автор удаляет своё сообщение; содержимое исчезает из состояния сервера и из ответа', async () => {
  const { srv, base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'МЕТКА-УДАЛЁННОГО-7731');
    assert.ok((await storedState(srv)).includes(sent.message));
    await redactEvent(c.bob, sent.event_id);
    const gone = (await eventsOf(c.alice)).find((e) => e.event_id === sent.event_id);
    assert.equal(gone.type, 'm.room.redacted');
    assert.ok(!JSON.stringify(gone).includes(sent.message));
    assert.ok(!(await storedState(srv)).includes('МЕТКА-УДАЛЁННОГО-7731'));
  } finally {
    await stop();
  }
});

test('удалять чужое сообщение можно только с правом delete_any_messages; владелец имеет его всегда', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const first = await sendEvent(c.bob, 'чужое');
    await assert.rejects(redactEvent(c.carol, first.event_id), (e) => e.status === 403);
    await grant(c.alice, CAROL, ['delete_any_messages']);
    await redactEvent(c.carol, first.event_id);
    const second = await sendEvent(c.bob, 'чужое снова');
    await redactEvent(c.alice, second.event_id);
  } finally {
    await stop();
  }
});

test('удалённое сообщение нельзя удалить или отредактировать повторно', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'текст');
    await redactEvent(c.bob, sent.event_id);
    await assert.rejects(redactEvent(c.bob, sent.event_id), (e) => e.status === 409);
    await assert.rejects(editEvent(c.bob, sent.event_id, 'правка'), (e) => e.status === 409);
  } finally {
    await stop();
  }
});

test('удаление сообщения убирает его содержимое из состояния сервера', async () => {
  const { srv, base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'ИСХОДНЫЙ-7731');
    assert.ok((await storedState(srv)).includes(sent.message));
    await redactEvent(c.bob, sent.event_id);
    assert.ok(!(await storedState(srv)).includes(sent.message));
    const events = await eventsOf(c.alice);
    assert.equal(events.find((e) => e.event_id === sent.event_id).type, 'm.room.redacted');
  } finally {
    await stop();
  }
});

test('посторонний не редактирует и не удаляет; неверный идентификатор и несуществующее сообщение отклоняются', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'текст');
    await assert.rejects(redactEvent(c.eve, sent.event_id), (e) => e.status === 403);
    await assert.rejects(editEvent(c.eve, sent.event_id, 'правка'), (e) => e.status === 403);
    await assert.rejects(redactEvent(c.bob, 'abc'), (e) => e.status === 400);
    await assert.rejects(redactEvent(c.bob, '$999'), (e) => e.status === 404);
  } finally {
    await stop();
  }
});

test('журнал запросов сервера не хранит тела сообщений', async () => {
  const { srv, base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'ЖУРНАЛ-МЕТКА-5150');
    const { wireLog } = JSON.parse(await srv.dump());
    assert.ok(wireLog.some((entry) => entry.includes('/messages')), 'запрос сообщения записан в журнал');
    assert.ok(!JSON.stringify(wireLog).includes('ЖУРНАЛ-МЕТКА-5150'));
    assert.ok(!JSON.stringify(wireLog).includes(sent.message), 'тело сообщения не записано');
  } finally {
    await stop();
  }
});
