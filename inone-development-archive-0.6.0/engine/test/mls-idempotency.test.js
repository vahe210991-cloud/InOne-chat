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
  return { base, alice, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
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

const COMMIT_ROOM = '!commit-idem:inone.test';
const COMMIT_ROOM_RACE = '!commit-idem-race:inone.test';
const COMMIT_ROOM_STALE = '!commit-idem-stale:inone.test';
const BOB = '@bob:inone.test';
const commitPath = (room) => `/mls/groups/${enc(room)}/commits`;

test('membership commit retries replay the accepted epoch; operation ID reuse conflicts', async () => {
  const s = await start();
  try {
    const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    await s.alice.createRoom(COMMIT_ROOM, [ALICE]);
    const add = {
      epoch: 0,
      commit: b64('ADD-BOB-EXACT'),
      changes: { adds: [BOB], removes: [] },
      welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: b64('WELCOME-BOB-EXACT') }],
      clientOperationId: 'commit-add-000000000001',
    };
    const first = await s.alice.raw('POST', commitPath(COMMIT_ROOM), add);
    const replay = await s.alice.raw('POST', commitPath(COMMIT_ROOM), add);
    assert.equal(first.epoch, 1);
    assert.equal(replay.epoch, 1);
    assert.equal(replay.replayed, true);
    const history = await s.alice.raw('GET', `/mls/groups/${enc(COMMIT_ROOM)}/commits?since=0`);
    assert.equal(history.commits.length, 1, 'exact replay does not append another commit');

    const remove = {
      epoch: 1,
      commit: b64('BOB-SELF-REMOVE'),
      changes: { adds: [], removes: [BOB] },
      clientOperationId: 'commit-remove-0000000001',
    };
    const removed = await bob.raw('POST', commitPath(COMMIT_ROOM), remove);
    assert.equal(removed.epoch, 2);
    const removedReplay = await bob.raw('POST', commitPath(COMMIT_ROOM), remove);
    assert.equal(removedReplay.epoch, 2, 'removed sender can still receive original commit ACK');
    assert.equal(removedReplay.replayed, true);
    await assert.rejects(
      bob.raw('POST', commitPath(COMMIT_ROOM), { ...remove, commit: b64('DIFFERENT-BYTES') }),
      (error) => error.status === 409 && error.message.includes('"code":"operation_id_reused"'),
    );
    const finalHistory = await s.alice.raw('GET', `/mls/groups/${enc(COMMIT_ROOM)}/commits?since=0`);
    assert.equal(finalHistory.commits.length, 2, 'conflicting replay does not append a commit');
  } finally {
    await s.stop();
  }
});

test('concurrent membership commit retries with one operation ID advance one epoch', async () => {
  const s = await start();
  try {
    await s.alice.createRoom(COMMIT_ROOM_RACE, [ALICE]);
    const body = {
      epoch: 0,
      commit: b64('RACE-COMMIT'),
      changes: { adds: [], removes: [] },
      clientOperationId: 'commit-race-000000000001',
    };
    const results = await Promise.all([
      s.alice.raw('POST', commitPath(COMMIT_ROOM_RACE), body),
      s.alice.raw('POST', commitPath(COMMIT_ROOM_RACE), body),
    ]);
    assert.deepEqual(results.map((result) => result.epoch), [1, 1]);
    assert.equal(results.filter((result) => result.replayed).length, 1);
    const history = await s.alice.raw('GET', `/mls/groups/${enc(COMMIT_ROOM_RACE)}/commits?since=0`);
    assert.equal(history.commits.length, 1);
  } finally {
    await s.stop();
  }
});

test('epoch_outdated is structured and does not reserve the operation ID', async () => {
  const s = await start();
  try {
    await s.alice.createRoom(COMMIT_ROOM_STALE, [ALICE]);
    await s.alice.raw('POST', commitPath(COMMIT_ROOM_STALE), {
      epoch: 0, commit: b64('ADVANCE'), changes: { adds: [], removes: [] },
    });
    const stale = {
      epoch: 0,
      commit: b64('STALE-ATTEMPT'),
      changes: { adds: [], removes: [] },
      clientOperationId: 'commit-stale-0000000001',
    };
    await assert.rejects(
      s.alice.raw('POST', commitPath(COMMIT_ROOM_STALE), stale),
      (error) => error.status === 409 && error.message.includes('"code":"epoch_outdated"'),
    );
    const accepted = await s.alice.raw('POST', commitPath(COMMIT_ROOM_STALE), {
      ...stale, epoch: 1, commit: b64('REBASED-AFTER-EXPLICIT-REJECTION'),
    });
    assert.equal(accepted.epoch, 2);
  } finally {
    await s.stop();
  }
});
