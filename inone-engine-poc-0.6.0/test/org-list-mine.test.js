// Список организаций пользователя (шаг 5.9): только свои членства, с ролью и статусом; без входа — отказ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = 'test-pepper-0123456789-0123456789-abcd';
const ANNA = '@anna-mine:inone.test';
const BORIS = '@boris-mine:inone.test';

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: false, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const anna = await ChatClient.create(base, ANNA, 'A_PHONE', PW);
  const boris = await ChatClient.create(base, BORIS, 'B_PHONE', PW);
  await store.createOrganization({ orgId: 'org-mine-a', name: 'Первая', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.createOrganization({ orgId: 'org-mine-b', name: 'Вторая', status: 'pending', createdBy: ANNA, createdAt: 2 });
  await store.createOrganization({ orgId: 'org-mine-c', name: 'Чужая', status: 'approved', createdBy: BORIS, createdAt: 3 });
  await store.addOrgMember('org-mine-a', ANNA, 'owner', 4);
  await store.addOrgMember('org-mine-b', ANNA, 'member', 5);
  await store.addOrgMember('org-mine-c', BORIS, 'owner', 6);
  return { srv, base, anna, boris, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function get(base, token) {
  const res = await fetch(`${base}/orgs/mine`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test('список организаций: только свои членства, с ролью и статусом', async () => {
  const s = await start();
  try {
    const mine = await get(s.base, s.anna.token);
    assert.equal(mine.status, 200);
    const pairs = mine.json.orgs.map((o) => [o.orgId, o.role, o.status]).sort();
    assert.deepEqual(pairs, [['org-mine-a', 'owner', 'approved'], ['org-mine-b', 'member', 'pending']], 'видны только свои организации');
    const boris = await get(s.base, s.boris.token);
    assert.deepEqual(boris.json.orgs.map((o) => o.orgId), ['org-mine-c'], 'чужая организация Анны не видна Борису и наоборот');
  } finally {
    await s.stop();
  }
});

test('без входа список не отдаётся', async () => {
  const s = await start();
  try {
    assert.equal((await get(s.base, null)).status, 401);
  } finally {
    await s.stop();
  }
});
