// Проверка сквозного шифрования через сервер.
// Alice и Bob переписываются через настоящий HTTP-сервер, а тест проверяет,
// что сервер не видит открытого текста.
import { postGroupEvent } from './group-message-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient } from '../src/client.js';

const ROOM = '!room1:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const EVE = '@eve:inone.test';
const SECRET_1 = 'Привет, Bob, это секрет МАРКЕР-4417-ПЕРВЫЙ';
const SECRET_2 = 'Ответ от Bob: принято, МАРКЕР-9053-ВТОРОЙ';

async function startServer() {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: 'test-pepper-0123456789-0123456789-abcd' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

test('Alice и Bob обмениваются сообщениями, сервер не видит открытого текста', async () => {
  const { srv, base, stop } = await startServer();
  try {
    const alice = await ChatClient.create(base, ALICE, 'ALICE_PHONE');
    const bob = await ChatClient.create(base, BOB, 'BOB_PHONE');
    await alice.publishKeys();
    await bob.publishKeys();

    await alice.createRoom(ROOM, [ALICE, BOB]);
    await alice.addPeers([ALICE, BOB]);
    await alice.establishSessions([BOB]);
    await alice.shareRoomKey(ROOM, [ALICE, BOB]);
    await bob.sync();

    await alice.sendText(ROOM, SECRET_1);
    const bobSees = await bob.readText(ROOM);
    assert.equal(bobSees.length, 1);
    assert.equal(bobSees[0].body, SECRET_1, 'Bob должен прочитать сообщение Alice');

    await bob.sendText(ROOM, SECRET_2);
    await alice.sync(); // Alice получает ключ отправителя Bob
    const aliceSees = await alice.readText(ROOM);
    assert.equal(aliceSees.at(-1).body, SECRET_2, 'Alice должна прочитать ответ Bob');

    const serverData = (await srv.dump());
    assert.ok(!serverData.includes('МАРКЕР-4417-ПЕРВЫЙ'), 'в данных сервера не должно быть открытого текста');
    assert.ok(!serverData.includes('МАРКЕР-9053-ВТОРОЙ'), 'в данных сервера не должно быть открытого текста ответа');
    assert.ok(!serverData.includes('секрет'), 'слово из текста не должно попасть на сервер');
    assert.ok(serverData.includes('m.room.encrypted'), 'на сервере должны лежать зашифрованные события');
  } finally {
    await stop();
  }
});

test('посторонний не получает беседу с сервера и не расшифрует копию сообщения', async () => {
  const { srv, base, stop } = await startServer();
  try {
    const alice = await ChatClient.create(base, ALICE, 'ALICE_PHONE');
    const bob = await ChatClient.create(base, BOB, 'BOB_PHONE');
    const eve = await ChatClient.create(base, EVE, 'EVE_PHONE');
    await alice.publishKeys();
    await bob.publishKeys();
    await eve.publishKeys();
    await alice.createRoom(ROOM, [ALICE, BOB]);
    await alice.addPeers([ALICE, BOB]);
    await alice.establishSessions([BOB]);
    await alice.shareRoomKey(ROOM, [ALICE, BOB]);
    await bob.sync();
    await alice.sendText(ROOM, SECRET_1);

    // Сервер не отдаёт беседу тому, кто в ней не состоит.
    await assert.rejects(eve.readText(ROOM), (e) => e.status === 403);
    // Даже если копия шифротекста у Eve есть, ключа у неё нет.
    const copy = (await srv.roomEvents(ROOM))[0];
    await assert.rejects(eve.decryptRaw(copy, ROOM));
  } finally {
    await stop();
  }
});

test('нельзя загрузить ключи от имени другого устройства', async () => {
  const { base, stop } = await startServer();
  try {
    const alice = await ChatClient.create(base, ALICE, 'ALICE_PHONE');
    const bob = await ChatClient.create(base, BOB, 'BOB_PHONE');
    await alice.publishKeys();
    await assert.rejects(
      bob.raw('POST', '/keys/upload', {
        device_keys: { user_id: ALICE, device_id: 'ALICE_PHONE', algorithms: [], keys: {}, signatures: {} },
      }),
      (err) => err.status === 403,
    );
  } finally {
    await stop();
  }
});

test('сервер отклоняет открытый текст в беседе', async () => {
  const { base, stop } = await startServer();
  try {
    const alice = await ChatClient.create(base, ALICE, 'ALICE_PHONE');
    await assert.rejects(
      postGroupEvent(alice, ROOM, { type: 'm.room.message', content: { body: 'открыто' } }),
      (err) => err.status === 400,
    );
  } finally {
    await stop();
  }
});
