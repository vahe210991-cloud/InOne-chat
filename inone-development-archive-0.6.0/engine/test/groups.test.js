// Группы: несколько участников, добавление, удаление с обновлением ключей, роли.
import { postGroupEvent } from './group-message-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { storeForTest } from './helpers.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ROOM = '!team:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const EVE = '@eve:inone.test';

async function start() {
  const db = await storeForTest('test-pepper-0123456789-0123456789-abcd');
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: 'test-pepper-0123456789-0123456789-abcd', store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('три участника переписываются; сервер видит только шифротекст', async () => {
  const { srv, base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
    for (const c of [alice, bob, carol]) await c.publishKeys();
    await alice.createRoom(ROOM, [ALICE, BOB, CAROL]);

    await alice.sendText(ROOM, 'Привет, команда, пароль от склада МАРКЕР-7731');
    await bob.sync();
    await carol.sync();
    await bob.sendText(ROOM, 'Принято, отвечу к 18:00');
    await carol.sendText(ROOM, 'Я тоже в деле, код МАРКЕР-2468');

    await alice.sync();
    await bob.sync();
    await carol.sync();
    const texts = (seen) => seen.map((m) => m.body);
    const expected = ['Привет, команда, пароль от склада МАРКЕР-7731', 'Принято, отвечу к 18:00', 'Я тоже в деле, код МАРКЕР-2468'];
    assert.deepEqual(texts(await alice.readText(ROOM)), expected);
    assert.deepEqual(texts(await bob.readText(ROOM)), expected);
    assert.deepEqual(texts(await carol.readText(ROOM)), expected);

    const serverData = (await srv.dump());
    for (const secret of ['МАРКЕР-7731', 'МАРКЕР-2468', 'пароль от склада', 'отвечу к 18']) {
      assert.ok(!serverData.includes(secret), `на сервере не должно быть открытого текста: ${secret}`);
    }
  } finally {
    await stop();
  }
});

test('новый участник не читает историю до своего входа', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
    for (const c of [alice, bob, carol]) await c.publishKeys();
    await alice.createRoom(ROOM, [ALICE, BOB]);
    await alice.sendText(ROOM, 'до прихода Carol');
    await bob.sync();

    await alice.addMember(ROOM, CAROL);
    await carol.sync();
    await alice.sendText(ROOM, 'после прихода Carol');
    await carol.sync();

    // Сервер не отдаёт даже шифротекст события до входа (C-07). Прежняя проверка ловила «ошибку расшифровки»,
    // а это значило, что шифротекст до входа Carol всё же уходил на её устройство.
    const seen = await carol.readText(ROOM);
    assert.equal(seen.length, 1, 'до входа Carol сервер не отдаёт ни одного события');
    assert.equal(seen[0].body, 'после прихода Carol');
  } finally {
    await stop();
  }
});

test('legacy member removal is blocked for MLS rooms; membership and messages remain consistent', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.createRoom(ROOM, [ALICE, BOB]);
    await alice.sendText(ROOM, 'до попытки удаления');
    const response = await fetch(`${base}/rooms/${encodeURIComponent(ROOM)}/members/${encodeURIComponent(BOB)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, 'mls_commit_required');
    assert.equal((await bob.readText(ROOM)).at(-1).body, 'до попытки удаления');
  } finally {
    await stop();
  }
});
test('посторонний не получает события беседы, а участник не добавляет и не удаляет людей без прав', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
    const eve = await ChatClient.create(base, EVE, 'E_PHONE', PW);
    for (const c of [alice, bob, carol, eve]) await c.publishKeys();
    await alice.createRoom(ROOM, [ALICE, BOB, CAROL]);

    // Посторонний не читает и не пишет в беседу.
    await assert.rejects(eve.readText(ROOM), (e) => e.status === 403);
    await assert.rejects(postGroupEvent(eve, ROOM, { type: 'm.room.encrypted', content: {} }), (e) => e.status === 403);

    // Участник без прав не добавляет и не удаляет людей.
    await assert.rejects(bob.addMember(ROOM, EVE), (e) => e.status === 403);
    await assert.rejects(bob.removeMember(ROOM, CAROL), (e) => e.status === 403);

    // Владельца нельзя удалить.
    await assert.rejects(alice.removeMember(ROOM, ALICE), (e) => e.status === 409);
  } finally {
    await stop();
  }
});
