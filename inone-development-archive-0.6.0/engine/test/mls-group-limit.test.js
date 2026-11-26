import { randomBytes } from 'node:crypto';
// Лимит группы при фиксации MLS (шаг 5.8): коммит, который поднимает состав сверх лимита организации, отклоняется;
// замена участника в пределах лимита проходит, и состав не растёт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice-limit:inone.test';
const BOB = '@bob-limit:inone.test';
const CAROL = '@carol-limit:inone.test';
const DAVE = '@dave-limit:inone.test';
const ROOM = '!limit-mls:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const COMMITS = `/mls/groups/${enc(ROOM)}/commits`;

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  await ChatClient.create(base, BOB, 'B_PHONE', PW);
  await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  await ChatClient.create(base, DAVE, 'D_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  await store.setOrgSetting({ orgId: 'org-default', field: 'maxGroupMembers', value: 3, actor: ALICE, at: Date.now() });
  return { srv, base, store, alice, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('коммит, который поднимает состав сверх лимита организации, отклоняется', async () => {
  const s = await start();
  try {
    await assert.rejects(s.alice.raw('POST', COMMITS, {
      epoch: 1, commit: b64('COMMIT-ADD-DAVE'), changes: { adds: [DAVE], removes: [] },
      welcomes: [{ userId: DAVE, deviceId: 'D_PHONE', welcome: b64('WELCOME-DAVE') }],
    }), (e) => e.status === 409, 'четвёртый участник не добавляется');
    const members = (await s.alice.raw('GET', `/rooms/${enc(ROOM)}/members`)).members;
    assert.ok(!members.includes(DAVE), 'после отказа состав не изменился');
    assert.equal(members.length, 3);
  } finally {
    await s.stop();
  }
});

test('замена участника в пределах лимита проходит, состав не растёт', async () => {
  const s = await start();
  try {
    const r = await s.alice.raw('POST', COMMITS, {
      epoch: 1, commit: b64('COMMIT-SWAP'), changes: { adds: [DAVE], removes: [BOB] },
      welcomes: [{ userId: DAVE, deviceId: 'D_PHONE', welcome: b64('WELCOME-DAVE') }],
    });
    assert.equal(r.epoch, 2, 'коммит принят после начального Add Commit');
    const members = (await s.alice.raw('GET', `/rooms/${enc(ROOM)}/members`)).members;
    assert.equal(members.length, 3, 'в группе по-прежнему три участника');
    assert.ok(members.includes(DAVE) && !members.includes(BOB), 'замена прошла');
  } finally {
    await s.stop();
  }
});
