// Роли в беседе: владелец, администраторы, участники.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { storeForTest } from './helpers.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ROOM = '!roles:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const EVE = '@eve:inone.test';

async function start() {
  const db = await storeForTest('test-pepper-0123456789-0123456789-abcd');
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: 'test-pepper-0123456789-0123456789-abcd', store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function setup(base) {
  const clients = {};
  for (const [name, id] of [['alice', ALICE], ['bob', BOB], ['carol', CAROL], ['dave', DAVE], ['eve', EVE]]) {
    clients[name] = await ChatClient.create(base, id, `${name.toUpperCase()}_PHONE`, PW);
    await clients[name].publishKeys();
  }
  await clients.alice.createRoom(ROOM, [ALICE, BOB, CAROL, DAVE]);
  return clients;
}

test('администратор добавляет участников; обычный участник этого не может', async () => {
  const { base, stop } = await start();
  try {
    const c = await setup(base);
    await c.alice.setRole(ROOM, BOB, 'admin');
    await c.bob.addMember(ROOM, EVE); // администратор добавляет
    const members = (await c.alice.listMembers(ROOM)).members;
    assert.ok(members.includes(EVE));
    await assert.rejects(c.carol.addMember(ROOM, DAVE), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('администратор удаляет обычного участника, но не другого администратора', async () => {
  const { base, stop } = await start();
  try {
    const c = await setup(base);
    await c.alice.setRole(ROOM, BOB, 'admin');
    await c.alice.setRole(ROOM, DAVE, 'admin');
    await assert.rejects(c.bob.removeMember(ROOM, DAVE), (e) => e.status === 403, 'админ не удаляет админа');
    await c.bob.removeMember(ROOM, CAROL); // обычного участника — можно
    assert.ok(!(await c.alice.listMembers(ROOM)).members.includes(CAROL));
  } finally {
    await stop();
  }
});

test('владелец понижает администратора: тот теряет право добавлять людей', async () => {
  const { base, stop } = await start();
  try {
    const c = await setup(base);
    await c.alice.setRole(ROOM, BOB, 'admin');
    await c.alice.setRole(ROOM, BOB, 'member');
    await assert.rejects(c.bob.addMember(ROOM, EVE), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('участник не назначает роли; владельца нельзя понизить или удалить', async () => {
  const { base, stop } = await start();
  try {
    const c = await setup(base);
    await assert.rejects(c.carol.setRole(ROOM, DAVE, 'admin'), (e) => e.status === 403);
    await assert.rejects(c.alice.setRole(ROOM, ALICE, 'member'), (e) => e.status === 409);
    await assert.rejects(c.bob.removeMember(ROOM, ALICE), (e) => e.status === 409);
  } finally {
    await stop();
  }
});

test('назначение роли не меняет состав беседы и не требует смены ключей', async () => {
  const { base, stop } = await start();
  try {
    const c = await setup(base);
    const before = (await c.alice.listMembers(ROOM)).members.slice().sort();
    await c.alice.setRole(ROOM, CAROL, 'admin');
    const after = (await c.alice.listMembers(ROOM)).members.slice().sort();
    assert.deepEqual(after, before);
  } finally {
    await stop();
  }
});
