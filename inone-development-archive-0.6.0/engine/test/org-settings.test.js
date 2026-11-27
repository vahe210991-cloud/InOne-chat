import { randomBytes } from 'node:crypto';
// Настройки организации (шаг 5.5): лимит группы (меньший из общего и организации), каналы, квота файлов организации.
// Меняют владелец и администратор; каждое изменение пишется в журнал; значения не выше общих.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';
import { createStore } from '../src/store.js';

const PEPPER = randomBytes(24).toString('hex');
const DOCS = 'test-docs-secret-0123456789-abcdefgh';
const ANNA = '@anna-set:inone.test';
const BORIS = '@boris-set:inone.test';
const CAROL = '@carol-set:inone.test';
const DAVE = '@dave-set:inone.test';
const ORG = 'org-settings';
const enc = encodeURIComponent;
const JSON_HEADERS = { 'content-type': 'application/json' };
const SHA = 'a'.repeat(64);

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, docsSecret: DOCS });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const anna = await ChatClient.create(base, ANNA, 'A_PHONE', PW);
  const boris = await ChatClient.create(base, BORIS, 'B_PHONE', PW);
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  const dave = await ChatClient.create(base, DAVE, 'D_PHONE', PW);
  await store.createOrganization({ orgId: ORG, name: 'Настройки', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.addOrgMember(ORG, ANNA, 'owner', 2);
  await store.addOrgMember(ORG, BORIS, 'admin', 3);
  await store.addOrgMember(ORG, CAROL, 'member', 4);
  return { srv, base, store, anna, boris, carol, dave, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function call(base, method, p, token, body) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? JSON_HEADERS : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test('настройки меняют владелец и администратор; обычный участник — нет; значения проверяются; изменения записаны в журнал', async () => {
  const s = await start();
  try {
    const byMember = await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.carol.token, { field: 'channelsEnabled', value: false });
    assert.equal(byMember.status, 403, 'обычный участник настройки не меняет');
    const byAdmin = await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.boris.token, { field: 'channelsEnabled', value: false });
    assert.equal(byAdmin.status, 200, 'администратор меняет настройку');
    assert.equal(byAdmin.json.settings.channelsEnabled, false);
    const badValue = await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.anna.token, { field: 'maxGroupMembers', value: 1 });
    assert.equal(badValue.status, 400, 'лимит группы меньше двух не принимается');
    const log = await call(s.base, 'GET', `/orgs/${ORG}/settings/log`, s.anna.token);
    assert.equal(log.status, 200);
    assert.ok(log.json.log.some((e) => e.field === 'channelsEnabled' && e.actor === BORIS && e.old === true && e.new === false), 'изменение записано в журнал с прежним и новым значением');
    const logByMember = await call(s.base, 'GET', `/orgs/${ORG}/settings/log`, s.carol.token);
    assert.equal(logByMember.status, 403, 'журнал читают владелец и администратор');
  } finally {
    await s.stop();
  }
});

test('лимит группы организации действует и не выше общего', async () => {
  const s = await start();
  try {
    const tooHigh = await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.anna.token, { field: 'maxGroupMembers', value: 1000000 });
    assert.equal(tooHigh.status, 400, 'лимит организации не выше общего');
    const set = await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.anna.token, { field: 'maxGroupMembers', value: 3 });
    assert.equal(set.status, 200);
    const room = '!set-group:inone.test';
    await s.anna.createRoom(room, [ANNA, CAROL], { orgId: ORG });
    await s.anna.addMember(room, BORIS);
    await s.store.addOrgMember(ORG, DAVE, 'member', 9);
    await assert.rejects(s.anna.addMember(room, DAVE), (error) => error.status === 409 && error.message.includes('group is full'), 'четвёртый участник не входит: лимит организации');
  } finally {
    await s.stop();
  }
});

test('в организации без каналов канал не создать; после включения — можно', async () => {
  const s = await start();
  try {
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.anna.token, { field: 'channelsEnabled', value: false })).status, 200);
    const refused = await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: '!set-ch-1:inone.test', orgId: ORG, kind: 'channel', name: 'Объявления' });
    assert.equal(refused.status, 403, 'канал в организации без каналов не создаётся');
    assert.equal(refused.json.code, 'org_channels_disabled');
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.anna.token, { field: 'channelsEnabled', value: true })).status, 200);
    const allowed = await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: '!set-ch-2:inone.test', orgId: ORG, kind: 'channel', name: 'Новости' });
    assert.equal(allowed.status, 200, 'канал создаётся после включения');
  } finally {
    await s.stop();
  }
});

test('квота файлов организации: загрузка сверх квоты отклоняется, в пределах — принимается', async () => {
  const s = await start();
  try {
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG}/settings`, s.anna.token, { field: 'fileQuotaBytes', value: 100 })).status, 200);
    const room = '!set-files:inone.test';
    assert.equal((await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: room, orgId: ORG })).status, 200);
    const first = await call(s.base, 'POST', '/files', s.anna.token, { kind: 'file', size: 80, sha256: SHA, roomId: room });
    assert.equal(first.status, 200, 'первый файл в пределах квоты принимается');
    const second = await call(s.base, 'POST', '/files', s.anna.token, { kind: 'file', size: 80, sha256: SHA, roomId: room });
    assert.equal(second.status, 413, 'файл сверх квоты организации отклоняется');
    assert.equal(second.json.code, 'org_quota_exceeded');
  } finally {
    await s.stop();
  }
});

test('ошибка admin audit откатывает настройку организации и её журнал', async (t) => {
  const db = await storeForTest(PEPPER);
  if (!db?.pool || !db?.store) {
    t.skip('PostgreSQL test database is not configured');
    return;
  }
  const orgId = `org-setting-rollback-${randomBytes(6).toString('hex')}`;
  const owner = `@setting-owner-${randomBytes(5).toString('hex')}:inone.test`;
  try {
    await db.store.addAccount(owner, 'test-password-hash');
    await db.store.createOrganization({ orgId, name: 'Settings rollback', status: 'approved', createdBy: owner, createdAt: 1 });
    await db.store.addOrgMember(orgId, owner, 'owner', 2);
    const failingStore = createStore({
      pool: db.pool, pinPepper: PEPPER,
      testHooks: { beforeAdminActionInsert() { throw new Error('injected admin audit failure'); } },
    });
    await assert.rejects(
      failingStore.setOrgSettingAtomic({ orgId, field: 'channelsEnabled', value: false, actor: owner, at: 3 }),
      /injected admin audit failure/,
    );
    assert.equal((await db.store.orgSettings(orgId)).channelsEnabled, true, 'настройка вернулась к прежнему значению');
    assert.deepEqual(await db.store.listOrgSettingsLog(orgId), [], 'журнал настройки тоже откатился');
    assert.equal((await db.store.listAdminActions(orgId)).filter((a) => a.action === 'setting_change').length, 0);
  } finally {
    await db.pool.query('DELETE FROM admin_action_log WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM org_settings_log WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM org_settings WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM org_members WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM organizations WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM accounts WHERE user_id = $1', [owner]);
    await db.close();
  }
});
