import { randomBytes } from 'node:crypto';
// Организации (этап 5, шаг 5.1): модель. Организация по умолчанию есть; новый аккаунт становится её участником;
// один аккаунт может состоять в нескольких организациях; комната принадлежит организации; роли и статусы ограничены.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const DEFAULT_ORG = 'org-default';
const ANNA = '@anna-org:inone.test';
const BORIS = '@boris-org:inone.test';

async function open() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  return { store, close: async () => { await db?.close(); } };
}

test('есть организация по умолчанию; новый аккаунт в неё не входит, пока не указано иное', async () => {
  const { store, close } = await open();
  try {
    assert.equal(await store.addAccount(ANNA, 'hash-anna'), true);
    assert.equal(await store.orgRoleOf(DEFAULT_ORG, ANNA), null, 'новый аккаунт не участник организации по умолчанию');
    assert.equal(await store.addAccount(BORIS, 'hash-boris', { joinDefaultOrg: true }), true);
    assert.equal(await store.orgRoleOf(DEFAULT_ORG, BORIS), 'member', 'с указанием входит в организацию по умолчанию');
    const orgs = await store.listUserOrgs(BORIS);
    assert.ok(orgs.some((o) => o.orgId === DEFAULT_ORG && o.status === 'approved'), 'организация по умолчанию одобрена');
  } finally {
    await close();
  }
});

test('один аккаунт может состоять в нескольких организациях, роли разные', async () => {
  const { store, close } = await open();
  try {
    await store.addAccount(ANNA, 'hash-anna', { joinDefaultOrg: true });
    await store.createOrganization({ orgId: 'org-b', name: 'Вторая', status: 'approved', createdBy: ANNA, createdAt: 1 });
    assert.equal(await store.addOrgMember('org-b', ANNA, 'admin', 2), true);
    const orgs = await store.listUserOrgs(ANNA);
    assert.deepEqual(orgs.map((o) => [o.orgId, o.role]).sort(), [[DEFAULT_ORG, 'member'], ['org-b', 'admin']].sort(), 'два членства с разными ролями');
    assert.equal(await store.addOrgMember('org-b', ANNA, 'member', 3), false, 'повторное членство не создаётся');
  } finally {
    await close();
  }
});

test('комната принадлежит организации: по умолчанию — организация по умолчанию, можно указать другую', async () => {
  const { store, close } = await open();
  try {
    await store.addAccount(ANNA, 'hash-anna');
    await store.addAccount(BORIS, 'hash-boris');
    await store.addOrgMember(DEFAULT_ORG, ANNA, 'owner', 1);
    await store.addOrgMember(DEFAULT_ORG, BORIS, 'member', 2);
    assert.deepEqual(await store.createRoom('!org-room-invalid:inone.test', ANNA, [ANNA, BORIS], {}), { status: 'mls_commit_required' }, 'store не допускает начальное добавление другого участника без MLS');
    assert.equal(await store.createRoom('!org-room-1:inone.test', ANNA, [ANNA], {}), true);
    assert.equal(await store.roomOrg('!org-room-1:inone.test'), DEFAULT_ORG, 'комната по умолчанию в организации по умолчанию');
    await store.createOrganization({ orgId: 'org-c', name: 'Третья', status: 'approved', createdBy: BORIS, createdAt: 4 });
    await store.addOrgMember('org-c', BORIS, 'owner', 5);
    assert.equal(await store.createRoom('!org-room-2:inone.test', BORIS, [BORIS], { orgId: 'org-c' }), true);
    assert.equal(await store.roomOrg('!org-room-2:inone.test'), 'org-c', 'комната создана в указанной организации');
    await store.createOrganization({ orgId: 'org-pending', name: 'Ожидает', status: 'pending', createdBy: BORIS, createdAt: 6 });
    assert.equal((await store.createRoom('!org-room-pending:inone.test', BORIS, [BORIS], { orgId: 'org-pending' })).status, 'org_not_approved');
  } finally {
    await close();
  }
});

test('роли и статусы ограничены: неизвестная роль или статус не принимаются', async () => {
  const { store, close } = await open();
  try {
    await store.addAccount(ANNA, 'hash-anna');
    await store.addAccount(BORIS, 'hash-boris');
    await assert.rejects(async () => store.addOrgMember(DEFAULT_ORG, BORIS, 'superuser', 5), 'неизвестная роль отвергнута');
    await assert.rejects(async () => store.createOrganization({ orgId: 'org-d', name: 'Четвёртая', status: 'maybe', createdBy: ANNA, createdAt: 6 }), 'неизвестный статус отвергнут');
  } finally {
    await close();
  }
});
