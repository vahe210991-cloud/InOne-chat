import { randomBytes } from 'node:crypto';
// Состав группы через коммит MLS: добавление и удаление по правам комнаты, владелец не выходит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!members:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const EVE = '@eve:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

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
  const dave = await ChatClient.create(s.base, DAVE, 'D_PHONE', PW);
  const eve = await ChatClient.create(s.base, EVE, 'E_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  return { ...s, alice, bob, carol, dave, eve };
}

const members = async (c) => (await c.raw('GET', `/rooms/${enc(ROOM)}/members`)).members;
const currentEpoch = async (c) => (await c.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch;
const commit = (c, body) => c.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, body);

test('legacy REST member add and remove fail closed without changing the MLS roster', async () => {
  const g = await group();
  try {
    const beforeMembers = await members(g.alice);
    const beforeEpoch = await currentEpoch(g.alice);

    await assert.rejects(
      g.alice.raw('POST', `/rooms/${enc(ROOM)}/members`, { userId: DAVE }),
      (error) => error.status === 409,
      'legacy REST addition must require an MLS Add Commit and Welcome',
    );
    await assert.rejects(
      g.alice.raw('DELETE', `/rooms/${enc(ROOM)}/members/${enc(CAROL)}`),
      (error) => error.status === 409,
      'legacy REST removal must require an MLS Remove Commit',
    );

    assert.deepEqual(await members(g.alice), beforeMembers, 'neither legacy route mutates the room roster');
    assert.equal(await currentEpoch(g.alice), beforeEpoch, 'neither legacy route changes the MLS epoch');
  } finally {
    await g.stop();
  }
});


test('владелец добавляет участника коммитом: новый участник в группе, читает коммиты и получает приветствие', async () => {
  const g = await group();
  try {
    const beforeEpoch = await currentEpoch(g.alice);
    const r = await commit(g.alice, {
      epoch: beforeEpoch, commit: b64('COMMIT-ADD-DAVE'), changes: { adds: [DAVE], removes: [] },
      welcomes: [{ userId: DAVE, deviceId: 'D_PHONE', welcome: b64('WELCOME-DAVE') }],
    });
    assert.equal(r.epoch, beforeEpoch + 1);
    assert.ok((await members(g.alice)).includes(DAVE), 'Дэйв стал участником комнаты');
    const history = await g.alice.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=0`);
    assert.deepEqual(history.commits.at(-1).changes, { adds: [DAVE], removes: [], removeDevices: [] });
    assert.deepEqual(history.commits.at(-1).welcomeRecipients, [{ userId: DAVE, deviceId: 'D_PHONE' }]);
    assert.equal((await g.dave.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=0`)).commits.length, 1, 'новый участник читает коммиты');
    assert.equal((await g.dave.raw('GET', '/mls/welcomes')).welcomes.length, 1, 'новый участник получил приветствие');
  } finally {
    await g.stop();
  }
});

test('добавлять участников может только тот, у кого есть право приглашать', async () => {
  const g = await group();
  try {
    await assert.rejects(commit(g.bob, {
      epoch: await currentEpoch(g.bob), commit: b64('X'), changes: { adds: [EVE], removes: [] },
      welcomes: [{ userId: EVE, deviceId: 'E_PHONE', welcome: b64('W') }],
    }), (e) => e.status === 403, 'без права Боб не добавляет');
    assert.ok(!(await members(g.alice)).includes(EVE), 'Ева не добавлена');
  } finally {
    await g.stop();
  }
});

test('приглашённый без приветствия не добавляется, приветствие не участнику отклоняется', async () => {
  const g = await group();
  try {
    const epoch = await currentEpoch(g.alice);
    await assert.rejects(commit(g.alice, { epoch, commit: b64('X'), changes: { adds: [EVE], removes: [] }, welcomes: [] }), (e) => e.status === 400, 'без приветствия');
    await assert.rejects(commit(g.alice, {
      epoch, commit: b64('X'), changes: { adds: [], removes: [] },
      welcomes: [{ userId: EVE, deviceId: 'E_PHONE', welcome: b64('W') }],
    }), (e) => e.status === 400, 'приветствие не участнику');
    assert.equal(await currentEpoch(g.alice), epoch, 'эпоха не сдвинулась');
  } finally {
    await g.stop();
  }
});

test('удалять участников может владелец или администратор с правом; владелец не выходит', async () => {
  const g = await group();
  try {
    const beforeEpoch = await currentEpoch(g.alice);
    await assert.rejects(commit(g.bob, { epoch: beforeEpoch, commit: b64('X'), changes: { adds: [], removes: [CAROL] } }), (e) => e.status === 403, 'Боб без права не удаляет Кэрол');
    await assert.rejects(commit(g.alice, { epoch: beforeEpoch, commit: b64('X'), changes: { adds: [], removes: [ALICE] } }), (e) => e.status === 409, 'владелец не выходит');
    assert.equal((await commit(g.alice, { epoch: beforeEpoch, commit: b64('REMOVE-CAROL'), changes: { adds: [], removes: [CAROL] } })).epoch, beforeEpoch + 1);
    const history = await g.alice.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=0`);
    assert.deepEqual(history.commits.at(-1).changes, { adds: [], removes: [CAROL], removeDevices: [] });
    assert.ok(!(await members(g.alice)).includes(CAROL), 'Кэрол удалена из комнаты');
    await assert.rejects(g.carol.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=0`), (e) => e.status === 403, 'удалённая не читает коммиты');
  } finally {
    await g.stop();
  }
});

test('участник выходит сам коммитом с собственным удалением', async () => {
  const g = await group();
  try {
    const beforeAddEpoch = await currentEpoch(g.alice);
    await commit(g.alice, {
      epoch: beforeAddEpoch, commit: b64('COMMIT-ADD-DAVE'), changes: { adds: [DAVE], removes: [] },
      welcomes: [{ userId: DAVE, deviceId: 'D_PHONE', welcome: b64('WELCOME-DAVE') }],
    });
    const beforeLeaveEpoch = await currentEpoch(g.dave);
    assert.equal((await commit(g.dave, { epoch: beforeLeaveEpoch, commit: b64('LEAVE-DAVE'), changes: { adds: [], removes: [DAVE] } })).epoch, beforeLeaveEpoch + 1);
    assert.ok(!(await members(g.alice)).includes(DAVE), 'Дэйв вышел');
  } finally {
    await g.stop();
  }
});


test('legacy REST membership mutations fail closed without changing the MLS roster or epoch', async () => {
  const g = await group();
  try {
    const beforeMembers = [...await members(g.alice)].sort();
    const beforeEpoch = await currentEpoch(g.alice);
    await assert.rejects(
      g.alice.raw('POST', `/rooms/${enc(ROOM)}/members`, { userId: DAVE }),
      (e) => e.status === 409 && e.message.includes('mls_commit_required'),
    );
    await assert.rejects(
      g.alice.raw('DELETE', `/rooms/${enc(ROOM)}/members/${enc(BOB)}`),
      (e) => e.status === 409 && e.message.includes('mls_commit_required'),
    );
    assert.deepEqual([...(await members(g.alice))].sort(), beforeMembers);
    assert.equal(await currentEpoch(g.alice), beforeEpoch);
  } finally {
    await g.stop();
  }
});

test('room creation cannot insert initial members without an MLS Add Commit', async () => {
  const g = await group();
  try {
    await assert.rejects(
      g.alice.raw('POST', '/rooms', { roomId: '!legacy-initial-members:inone.test', members: [ALICE, BOB] }),
      (e) => e.status === 409 && e.message.includes('mls_commit_required'),
    );
    assert.equal((await g.alice.raw('GET', '/rooms/mine')).rooms.some((room) => room.roomId === '!legacy-initial-members:inone.test'), false);
  } finally {
    await g.stop();
  }
});
