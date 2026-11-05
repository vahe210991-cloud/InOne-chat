import { randomBytes } from 'node:crypto';
// Повтор отправки с тем же clientMessageId не создаёт второго сообщения: нужно очереди без связи.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { mlsMessageAt } from './group-message-helper.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!idem:inone.test';
const ALICE = '@alice:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  return { alice, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('повтор с тем же clientMessageId возвращает первое сообщение и не создаёт второе', async () => {
  const s = await start();
  try {
    await s.alice.createRoom(ROOM, [ALICE]);
    await s.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 0, commit: b64('FIRST'), changes: { adds: [], removes: [] } });
    const message = mlsMessageAt(ROOM, 1, 'раз');
    const send = (id) => s.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message, kind: 'text', forwarded: false, clientMessageId: id });
    const first = await send('msg-0001');
    assert.equal((await send('msg-0001')).event_id, first.event_id, 'тот же идентификатор события');
    const events = (await s.alice.raw('GET', `/rooms/${enc(ROOM)}/events`)).events.filter((e) => e.type === 'm.room.encrypted');
    assert.equal(events.length, 1, 'одно сообщение в ленте');
    assert.notEqual((await send('msg-0002')).event_id, first.event_id, 'новый идентификатор — новое сообщение');
    await assert.rejects(send('плохой id!'), (e) => e.status === 400, 'неверный идентификатор отклоняется');
  } finally {
    await s.stop();
  }
});

test('параллельные повторы с одним clientMessageId создают одно сообщение', async () => {
  const ROOM2 = '!idem-race:inone.test';
  const s = await start();
  try {
    await s.alice.createRoom(ROOM2, [ALICE]);
    await s.alice.raw('POST', `/mls/groups/${enc(ROOM2)}/commits`, { epoch: 0, commit: b64('FIRST'), changes: { adds: [], removes: [] } });
    const message = mlsMessageAt(ROOM2, 1, 'параллельно');
    const attempts = 20;
    for (let i = 0; i < attempts; i++) {
      const id = `race-${i}`;
      const results = await Promise.allSettled([1, 2, 3].map(() => s.alice.raw('POST', `/mls/groups/${enc(ROOM2)}/messages`, { message, kind: 'text', forwarded: false, clientMessageId: id })));
      const accepted = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.event_id);
      assert.ok(accepted.length >= 1, 'хотя бы один запрос принят');
      assert.equal(new Set(accepted).size, 1, `все принятые ответы — одно событие (${id})`);
      for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.status, 409, 'отказ только «уже отправляется»');
    }
    const events = (await s.alice.raw('GET', `/rooms/${enc(ROOM2)}/events`)).events.filter((e) => e.type === 'm.room.encrypted');
    assert.equal(events.length, attempts, 'по одному сообщению на каждый идентификатор');
  } finally {
    await s.stop();
  }
});
