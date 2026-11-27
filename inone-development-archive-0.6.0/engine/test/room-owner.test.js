import { randomBytes } from 'node:crypto';
// Передача владения группой: только текущий владелец, новым владельцем становится участник.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!owner:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const EVE = '@eve:inone.test';
const enc = encodeURIComponent;

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
  await ChatClient.create(s.base, EVE, 'E_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  return { ...s, alice, bob, carol };
}

const roomInfo = async (c) => c.raw('GET', `/rooms/${enc(ROOM)}/members`);

test('владелец передаёт владение участнику: новый владелец получает права, прежний становится обычным участником', async () => {
  const g = await group();
  try {
    assert.equal((await g.alice.raw('POST', `/rooms/${enc(ROOM)}/owner`, { userId: BOB })).owner, BOB);
    const info = await roomInfo(g.bob);
    assert.equal(info.owner, BOB);
    assert.ok(!info.admins.includes(ALICE), 'прежний владелец не администратор');
    await g.bob.removeMember(ROOM, CAROL);
    assert.ok(!(await roomInfo(g.bob)).members.includes(CAROL), 'новый владелец удаляет участника через MLS');
  } finally {
    await g.stop();
  }
});

test('передавать владение может только текущий владелец; новым владельцем — участник группы', async () => {
  const g = await group();
  try {
    await assert.rejects(g.bob.raw('POST', `/rooms/${enc(ROOM)}/owner`, { userId: CAROL }), (e) => e.status === 403, 'участник не передаёт владение');
    await assert.rejects(g.alice.raw('POST', `/rooms/${enc(ROOM)}/owner`, { userId: EVE }), (e) => e.status === 400, 'не участник не становится владельцем');
    assert.equal((await roomInfo(g.alice)).owner, ALICE, 'владелец не изменился');
  } finally {
    await g.stop();
  }
});

test('прежний владелец выходит только после передачи; новый владелец ведёт состав коммитами', async () => {
  const g = await group();
  try {
    await assert.rejects(g.alice.raw('DELETE', `/rooms/${enc(ROOM)}/members/${enc(ALICE)}`), (e) => e.status === 409, 'без передачи владелец не выходит');
    await g.alice.raw('POST', `/rooms/${enc(ROOM)}/owner`, { userId: BOB });
    await g.alice.removeMember(ROOM, ALICE);
    await g.bob.removeMember(ROOM, CAROL);
    assert.ok(!(await roomInfo(g.bob)).members.includes(CAROL), 'новый владелец удаляет участника коммитом MLS');
    assert.ok(!(await roomInfo(g.bob)).members.includes(CAROL));
  } finally {
    await g.stop();
  }
});
