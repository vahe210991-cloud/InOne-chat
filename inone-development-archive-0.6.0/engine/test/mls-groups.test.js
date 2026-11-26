import { randomBytes } from 'node:crypto';
// Группы MLS: эпоха, коммиты от актуальной эпохи, приветственные сообщения адресату.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!mls:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function group() {
  const s = await start();
  const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
  const carol = await ChatClient.create(s.base, CAROL, 'C_PHONE', PW);
  const dave = await ChatClient.create(s.base, DAVE, 'D_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  return { ...s, alice, bob, carol, dave };
}

const epoch = async (client) => (await client.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch;
const commits = (client) => `/mls/groups/${enc(ROOM)}/commits`;

test('создание группы фиксирует начальный состав MLS Add Commit; следующая эпоха принимается', async () => {
  const g = await group();
  try {
    const initialEpoch = await epoch(g.alice);
    assert.equal(initialEpoch, 1, 'начальный состав группы зафиксирован отдельным MLS Add Commit');
    const r = await g.alice.raw('POST', commits(g.alice), { epoch: initialEpoch, commit: b64('COMMIT-1') });
    assert.equal(r.epoch, initialEpoch + 1);
    const list = await g.alice.raw('GET', `${commits(g.alice)}?since=0`);
    assert.equal(list.commits.length, 2);
    assert.equal(list.commits.at(-1).epoch, 2);
    assert.equal(list.commits.at(-1).sender, ALICE);
    assert.equal(Buffer.from(list.commits.at(-1).commit, 'base64').toString('utf8'), 'COMMIT-1');
    assert.deepEqual(list.commits.at(-1).changes, { adds: [], removes: [], removeDevices: [] });
    assert.deepEqual(list.commits.at(-1).welcomeRecipients, []);
  } finally {
    await g.stop();
  }
});

test('два коммита от одной эпохи: принят только первый, второй получает 409', async () => {
  const g = await group();
  try {
    const baseEpoch = await epoch(g.alice);
    await g.alice.raw('POST', commits(g.alice), { epoch: baseEpoch, commit: b64('COMMIT-1') });
    assert.equal((await g.bob.raw('POST', commits(g.bob), { epoch: baseEpoch + 1, commit: b64('COMMIT-BOB') })).epoch, baseEpoch + 2);
    await assert.rejects(g.carol.raw('POST', commits(g.carol), { epoch: baseEpoch + 1, commit: b64('COMMIT-CAROL') }), (e) => e.status === 409, 'вторая ветка отклоняется');
    assert.equal(await epoch(g.alice), baseEpoch + 2, 'эпоха не сдвинулась второй раз');
    const list = await g.alice.raw('GET', `${commits(g.alice)}?since=0`);
    assert.deepEqual(list.commits.map((c) => c.epoch), [1, 2, 3]);
  } finally {
    await g.stop();
  }
});

test('устаревший коммит отклоняется, коммит не от участника тоже', async () => {
  const g = await group();
  try {
    const baseEpoch = await epoch(g.alice);
    await g.alice.raw('POST', commits(g.alice), { epoch: baseEpoch, commit: b64('COMMIT-1') });
    await assert.rejects(g.bob.raw('POST', commits(g.bob), { epoch: baseEpoch, commit: b64('STALE') }), (e) => e.status === 409, 'коммит от старой эпохи');
    await assert.rejects(g.dave.raw('POST', commits(g.dave), { epoch: baseEpoch + 1, commit: b64('FOREIGN') }), (e) => e.status === 403, 'не участник не коммитит');
    await assert.rejects(g.dave.raw('GET', `${commits(g.dave)}?since=0`), (e) => e.status === 403, 'не участник не читает коммиты');
  } finally {
    await g.stop();
  }
});

test('Welcome доставляется устройству нового адресата, подтверждается и исчезает из очереди', async () => {
  const g = await group();
  try {
    const baseEpoch = await epoch(g.alice);
    await g.alice.raw('POST', commits(g.alice), {
      epoch: baseEpoch,
      commit: b64('COMMIT-ADD-DAVE'),
      changes: { adds: [DAVE], removes: [] },
      welcomes: [{ userId: DAVE, deviceId: 'D_PHONE', welcome: b64('WELCOME-DAVE') }],
    });
    const daveWelcomes = (await g.dave.raw('GET', '/mls/welcomes')).welcomes;
    assert.equal(daveWelcomes.length, 1);
    assert.equal(Buffer.from(daveWelcomes[0].welcome, 'base64').toString('utf8'), 'WELCOME-DAVE');
    assert.equal(daveWelcomes[0].roomId, ROOM);
    assert.equal((await g.carol.raw('GET', '/mls/welcomes')).welcomes.length, 0, 'чужое приветствие не видно');
    await g.dave.raw('POST', `/mls/welcomes/${daveWelcomes[0].id}/ack`, {});
    assert.equal((await g.dave.raw('GET', '/mls/welcomes')).welcomes.length, 0, 'после подтверждения очередь пуста');
    await assert.rejects(g.dave.raw('POST', `/mls/welcomes/${daveWelcomes[0].id}/ack`, {}), (e) => e.status === 404);
  } finally {
    await g.stop();
  }
});

test('без входа коммиты не принимаются', async () => {
  const g = await group();
  try {
    const anon = await fetch(`${g.base}/mls/groups/${enc(ROOM)}/commits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ epoch: 0, commit: b64('X') }) });
    assert.equal(anon.status, 401);
  } finally {
    await g.stop();
  }
});
