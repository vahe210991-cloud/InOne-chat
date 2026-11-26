// Права участников беседы: владелец выдаёт администраторам и участникам отдельные права.
import { postGroupEvent } from './group-message-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { storeForTest } from './helpers.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { CAPABILITIES } from '../src/room-permissions.js';

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

function grant(owner, userId, capabilities) {
  return owner.raw('POST', `/rooms/${enc(ROOM)}/capabilities`, { userId, capabilities });
}

function sendEvent(client, body = {}) {
  return postGroupEvent(client, ROOM, { type: 'm.room.encrypted', content: { ciphertext: 'x' }, ...body });
}

function addMember(client, userId) {
  return client.addMember(ROOM, userId);
}

test('права по умолчанию: участник пишет, но не приглашает и не удаляет людей', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await c.bob.sync();
    await c.bob.sendText(ROOM, 'привет');
    await assert.rejects(addMember(c.bob, DAVE), (e) => e.status === 403);
    await assert.rejects(c.bob.removeMember(ROOM, CAROL), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('владелец выдаёт право приглашать: с правом участник добавляет людей, без права — нет', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await grant(c.alice, BOB, ['invite_members', 'send_messages']);
    await addMember(c.bob, DAVE);
    await assert.rejects(addMember(c.carol, EVE), (e) => e.status === 403);
    await grant(c.alice, BOB, ['send_messages']);
    await assert.rejects(addMember(c.bob, EVE), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('право выдаёт только владелец: участник не выдаёт права и не назначает роли', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(grant(c.bob, CAROL, ['send_messages']), (e) => e.status === 403);
    await assert.rejects(c.carol.setRole(ROOM, DAVE, 'admin'), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('владельцу права не выдаются; неизвестное право и не список отклоняются', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(grant(c.alice, ALICE, ['send_messages']), (e) => e.status === 409);
    await assert.rejects(grant(c.alice, BOB, ['fly']), (e) => e.status === 400);
    await assert.rejects(grant(c.alice, BOB, 'send_messages'), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('без права send_messages участник не пишет вообще', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await grant(c.alice, BOB, []);
    await assert.rejects(sendEvent(c.bob), (e) => e.status === 403);
    await assert.rejects(c.bob.sendText(ROOM, 'x'), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('стикеры и GIF требуют права send_stickers_gifs; текст доступен при праве send_messages', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await grant(c.alice, BOB, ['send_messages']);
    await assert.rejects(sendEvent(c.bob, { kind: 'sticker' }), (e) => e.status === 403);
    await assert.rejects(sendEvent(c.bob, { kind: 'gif' }), (e) => e.status === 403);
    await sendEvent(c.bob, { kind: 'text' });
    await grant(c.alice, BOB, ['send_messages', 'send_stickers_gifs']);
    await sendEvent(c.bob, { kind: 'sticker' });
    await sendEvent(c.bob, { kind: 'gif' });
  } finally {
    await stop();
  }
});

test('пересылка требует права forward_messages', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await grant(c.alice, BOB, ['send_messages']);
    await assert.rejects(sendEvent(c.bob, { forwarded: true }), (e) => e.status === 403);
    await sendEvent(c.bob, { forwarded: false });
    await grant(c.alice, BOB, ['send_messages', 'forward_messages']);
    await sendEvent(c.bob, { forwarded: true });
  } finally {
    await stop();
  }
});

test('неизвестный вид сообщения и нестрогий признак пересылки отклоняются', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(sendEvent(c.bob, { kind: 'video' }), (e) => e.status === 400);
    await assert.rejects(sendEvent(c.bob, { forwarded: 'yes' }), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('назначение администратора даёт права приглашать и удалять; понижение возвращает права участника', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await c.alice.setRole(ROOM, BOB, 'admin');
    const admin = await c.alice.listMembers(ROOM);
    assert.ok(admin.capabilities[BOB].includes('invite_members'));
    assert.ok(admin.capabilities[BOB].includes('remove_members'));
    assert.ok(admin.capabilities[BOB].includes('send_messages'));
    assert.deepEqual(admin.capabilities[ALICE], [...CAPABILITIES].sort());
    await addMember(c.bob, DAVE);

    await c.alice.setRole(ROOM, BOB, 'member');
    const member = await c.alice.listMembers(ROOM);
    assert.ok(!member.capabilities[BOB].includes('invite_members'));
    await assert.rejects(addMember(c.bob, EVE), (e) => e.status === 403);
  } finally {
    await stop();
  }
});
