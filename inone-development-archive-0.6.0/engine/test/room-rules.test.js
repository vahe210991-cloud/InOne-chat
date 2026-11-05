// Сроки и прочтение: правка 24 часа, удаление до прочтения и не позже 24 часов,
// настройки группы (название и публичная или приватная).
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
const enc = encodeURIComponent;
const HOUR = 60 * 60 * 1000;

async function start() {
  const db = await storeForTest('test-pepper-0123456789-0123456789-abcd');
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: 'test-pepper-0123456789-0123456789-abcd', store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function clubWith(base) {
  const users = { alice: [ALICE, 'A_PHONE'], bob: [BOB, 'B_PHONE'], carol: [CAROL, 'C_PHONE'] };
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

function readUpTo(client, eventId) {
  return post(client, '/read', { upTo: eventId });
}

function settings(client, body) {
  return post(client, '/settings', body);
}

function grant(owner, userId, capabilities) {
  return post(owner, '/capabilities', { userId, capabilities });
}

function membersOf(client) {
  return client.raw('GET', `/rooms/${enc(ROOM)}/members`);
}

test('правка разрешена в течение 24 часов после отправки, после — нет', async () => {
  const { srv, base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'первая');
    srv.advance(23 * HOUR);
    await editEvent(c.bob, sent.event_id, 'вторая');
    srv.advance(2 * HOUR);
    await assert.rejects(editEvent(c.bob, sent.event_id, 'третья'), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('удаление до прочтения разрешено; после прочтения другим участником — нет', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const unread = await sendEvent(c.bob, 'непрочитанное');
    await redactEvent(c.bob, unread.event_id);
    const read = await sendEvent(c.bob, 'прочитанное');
    await readUpTo(c.carol, read.event_id);
    await assert.rejects(redactEvent(c.bob, read.event_id), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('прочтение самим автором не закрывает удаление', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const sent = await sendEvent(c.bob, 'текст');
    await readUpTo(c.bob, sent.event_id);
    await redactEvent(c.bob, sent.event_id);
  } finally {
    await stop();
  }
});

test('через 24 часа не удаляют ни автор, ни владелец, ни администратор', async () => {
  const { srv, base, stop } = await start();
  try {
    const c = await clubWith(base);
    await grant(c.alice, CAROL, ['delete_any_messages']);
    await c.alice.setRole(ROOM, CAROL, 'admin');
    const sent = await sendEvent(c.bob, 'текст');
    srv.advance(25 * HOUR);
    await assert.rejects(redactEvent(c.bob, sent.event_id), (e) => e.status === 403);
    await assert.rejects(redactEvent(c.alice, sent.event_id), (e) => e.status === 403);
    await assert.rejects(redactEvent(c.carol, sent.event_id), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('владелец и администратор удаляют чужое в пределах 24 часов и до прочтения', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const first = await sendEvent(c.bob, 'первое');
    await redactEvent(c.alice, first.event_id);
    await grant(c.alice, CAROL, ['delete_any_messages']);
    const second = await sendEvent(c.bob, 'второе');
    await redactEvent(c.carol, second.event_id);
  } finally {
    await stop();
  }
});

test('отметка чтения не откатывается назад и не принимает несуществующее сообщение', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const first = await sendEvent(c.bob, '1');
    const second = await sendEvent(c.bob, '2');
    await readUpTo(c.carol, second.event_id);
    await readUpTo(c.carol, first.event_id);
    assert.equal((await membersOf(c.alice)).read_upto[CAROL], second.event_id);
    await assert.rejects(readUpTo(c.carol, '$999'), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('группа по умолчанию приватная; название и видимость меняют только с правом', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    assert.equal((await membersOf(c.alice)).visibility, 'private');
    await assert.rejects(settings(c.bob, { name: 'Чужое' }), (e) => e.status === 403);
    await settings(c.alice, { name: 'Команда', visibility: 'public' });
    const seen = await membersOf(c.bob);
    assert.equal(seen.name, 'Команда');
    assert.equal(seen.visibility, 'public');
    await grant(c.alice, BOB, ['send_messages', 'edit_group_name']);
    await settings(c.bob, { name: 'Команда 2' });
    await assert.rejects(settings(c.bob, { visibility: 'private' }), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('неверные значения настроек отклоняются', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(settings(c.alice, { visibility: 'secret' }), (e) => e.status === 400);
    await assert.rejects(settings(c.alice, { name: '   ' }), (e) => e.status === 400);
    await assert.rejects(settings(c.alice, { name: 'я'.repeat(101) }), (e) => e.status === 400);
    await assert.rejects(settings(c.alice, {}), (e) => e.status === 400);
  } finally {
    await stop();
  }
});
