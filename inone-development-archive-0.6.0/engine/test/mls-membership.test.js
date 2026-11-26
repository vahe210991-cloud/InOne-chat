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
const commit = (c, body) => c.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, body);

test('владелец добавляет участника коммитом: новый участник в группе, читает коммиты и получает приветствие', async () => {
  const g = await group();
  try {
    const r = await commit(g.alice, {
      epoch: 0, commit: b64('COMMIT-ADD-DAVE'), changes: { adds: [DAVE], removes: [] },
      welcomes: [{ userId: DAVE, deviceId: 'D_PHONE', welcome: b64('WELCOME-DAVE') }],
    });
    assert.equal(r.epoch, 1);
    assert.ok((await members(g.alice)).includes(DAVE), 'Дэйв стал участником комнаты');
    const history = await g.alice.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=0`);
    assert.deepEqual(history.commits[0].changes, { adds: [DAVE], removes: [], removeDevices: [] });
    assert.deepEqual(history.commits[0].welcomeRecipients, [{ userId: DAVE, deviceId: 'D_PHONE' }]);
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
      epoch: 0, commit: b64('X'), changes: { adds: [EVE], removes: [] },
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
    await assert.rejects(commit(g.alice, { epoch: 0, commit: b64('X'), changes: { adds: [EVE], removes: [] }, welcomes: [] }), (e) => e.status === 400, 'без приветствия');
    await assert.rejects(commit(g.alice, {
      epoch: 0, commit: b64('X'), changes: { adds: [], removes: [] },
      welcomes: [{ userId: EVE, deviceId: 'E_PHONE', welcome: b64('W') }],
    }), (e) => e.status === 400, 'приветствие не участнику');
    assert.equal((await g.alice.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch, 0, 'эпоха не сдвинулась');
  } finally {
    await g.stop();
  }
});

test('удалять участников может владелец или администратор с правом; владелец не выходит', async () => {
  const g = await group();
  try {
    await assert.rejects(commit(g.bob, { epoch: 0, commit: b64('X'), changes: { adds: [], removes: [CAROL] } }), (e) => e.status === 403, 'Боб без права не удаляет Кэрол');
    await assert.rejects(commit(g.alice, { epoch: 0, commit: b64('X'), changes: { adds: [], removes: [ALICE] } }), (e) => e.status === 409, 'владелец не выходит');
    assert.equal((await commit(g.alice, { epoch: 0, commit: b64('REMOVE-CAROL'), changes: { adds: [], removes: [CAROL] } })).epoch, 1);
    const history = await g.alice.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=0`);
    assert.deepEqual(history.commits[0].changes, { adds: [], removes: [CAROL], removeDevices: [] });
    assert.ok(!(await members(g.alice)).includes(CAROL), 'Кэрол удалена из комнаты');
    await assert.rejects(g.carol.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=0`), (e) => e.status === 403, 'удалённая не читает коммиты');
  } finally {
    await g.stop();
  }
});

test('участник выходит сам коммитом с собственным удалением', async () => {
  const g = await group();
  try {
    await commit(g.alice, {
      epoch: 0, commit: b64('COMMIT-ADD-DAVE'), changes: { adds: [DAVE], removes: [] },
      welcomes: [{ userId: DAVE, deviceId: 'D_PHONE', welcome: b64('WELCOME-DAVE') }],
    });
    assert.equal((await commit(g.dave, { epoch: 1, commit: b64('LEAVE-DAVE'), changes: { adds: [], removes: [DAVE] } })).epoch, 2);
    assert.ok(!(await members(g.alice)).includes(DAVE), 'Дэйв вышел');
  } finally {
    await g.stop();
  }
});


test('legacy room DELETE cannot remove a member after an MLS epoch exists', async () => {
  const g = await group();
  try {
    await commit(g.alice, { epoch: 0, commit: b64('INITIAL-MLS-EPOCH'), changes: { adds: [], removes: [] } });
    const response = await fetch(\`\${g.base}/rooms/\${enc(ROOM)}/members/\${enc(CAROL)}\`, {
      method: 'DELETE',
      headers: { authorization: \`Bearer \${g.alice.token}\` },
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, 'mls_commit_required');
    assert.ok((await members(g.alice)).includes(CAROL), 'server membership remains unchanged');
    assert.equal((await g.alice.raw('GET', \`/mls/groups/\${enc(ROOM)}/epoch\`)).epoch, 1, 'MLS epoch is unchanged');
  } finally {
    await g.stop();
  }
});
