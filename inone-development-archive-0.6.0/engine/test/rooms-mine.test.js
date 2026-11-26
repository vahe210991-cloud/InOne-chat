// Комнаты текущего пользователя (G1, этап 0.7.3): список для экрана чатов.
// Видны только свои комнаты, с ролью; без входа список не отдаётся.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = 'test-pepper-0123456789-0123456789-abcd';
const ANNA = '@anna-rooms:inone.test';
const BORIS = '@boris-rooms:inone.test';
const CAROL = '@carol-rooms:inone.test';
const ROOM_A = '!rooms-a:inone.test';
const ROOM_B = '!rooms-b:inone.test';
const enc = encodeURIComponent;

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const anna = await ChatClient.create(base, ANNA, 'A_PHONE', PW);
  const boris = await ChatClient.create(base, BORIS, 'B_PHONE', PW);
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  await anna.createRoom(ROOM_A, [ANNA]);
  await boris.createRoom(ROOM_B, [BORIS]);
  await boris.addMember(ROOM_B, ANNA);
  return { base, store, anna, boris, carol, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('список комнат: свои комнаты с ролью; чужие не видны', async () => {
  const s = await start();
  try {
    const mine = await s.anna.raw('GET', '/rooms/mine');
    const byId = Object.fromEntries(mine.rooms.map((r) => [r.roomId, r]));
    assert.deepEqual(Object.keys(byId).sort(), [ROOM_A, ROOM_B].sort(), 'видны обе свои комнаты');
    assert.equal(byId[ROOM_A].role, 'owner', 'созданная комната: владелец');
    assert.equal(byId[ROOM_B].role, 'member', 'комната, куда добавили: участник');
    assert.equal(byId[ROOM_A].kind, 'group');
    const boris = await s.boris.raw('GET', '/rooms/mine');
    assert.deepEqual(boris.rooms.map((r) => r.roomId), [ROOM_B], 'у Бориса только его комната');
    const carol = await s.carol.raw('GET', '/rooms/mine');
    assert.deepEqual(carol.rooms, [], 'посторонний не видит чужих комнат');
  } finally {
    await s.stop();
  }
});

test('room list projects encrypted last activity and per-user unread count', async () => {
  const s = await start();
  try {
    const firstSeq = await s.store.appendRoomEvent(
      ROOM_B, BORIS, 'm.room.encrypted', { mls: 'ciphertext-boris' }, 1000,
    );
    const lastSeq = await s.store.appendRoomEvent(
      ROOM_B, ANNA, 'm.room.encrypted', { mls: 'ciphertext-anna' }, 2000,
    );

    const beforeRead = await s.anna.raw('GET', '/rooms/mine');
    const room = beforeRead.rooms.find((item) => item.roomId === ROOM_B);
    assert.ok(room);
    assert.equal(room.lastEventSeq, lastSeq);
    assert.equal(room.lastEventAt, 2000);
    assert.equal(room.unreadCount, 1, 'only the other participant message is unread');
    assert.ok(firstSeq < lastSeq);

    await s.anna.raw('POST', `/rooms/${enc(ROOM_B)}/read`, { upTo: `${lastSeq}` });
    const afterRead = await s.anna.raw('GET', '/rooms/mine');
    const readRoom = afterRead.rooms.find((item) => item.roomId === ROOM_B);
    assert.equal(readRoom.unreadCount, 0, 'read marker clears the unread count');
    assert.equal(readRoom.lastEventSeq, lastSeq, 'read marker does not change last activity');
  } finally {
    await s.stop();
  }
});

test('список комнат: без входа не отдаётся', async () => {
  const s = await start();
  try {
    const res = await fetch(`${s.base}/rooms/mine`);
    assert.equal(res.status, 401);
  } finally {
    await s.stop();
  }
});
