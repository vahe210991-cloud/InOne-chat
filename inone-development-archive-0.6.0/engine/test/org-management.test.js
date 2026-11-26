import { randomBytes } from 'node:crypto';
// Управление организацией (шаг 5.4): владелец меняет роли; владелец и администратор добавляют и удаляют участников;
// выход из организации снимает доступ к её комнатам; владелец с комнатами не выходит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';
import { createStore } from '../src/store.js';

const PEPPER = randomBytes(24).toString('hex');
const DOCS = 'test-docs-secret-0123456789-abcdefgh';
const ANNA = '@anna-mgmt:inone.test';
const BORIS = '@boris-mgmt:inone.test';
const CAROL = '@carol-mgmt:inone.test';
const DAVE = '@dave-mgmt:inone.test';
const EVE = '@eve-mgmt:inone.test';
const ORG = 'org-manage';
const enc = encodeURIComponent;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, docsSecret: DOCS });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const users = {};
  for (const [name, id] of [['anna', ANNA], ['boris', BORIS], ['carol', CAROL], ['dave', DAVE], ['eve', EVE]]) {
    users[name] = await ChatClient.create(base, id, `${name}-PHONE`, PW);
  }
  await store.createOrganization({ orgId: ORG, name: 'Управление', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.addOrgMember(ORG, ANNA, 'owner', 2);
  await store.addOrgMember(ORG, BORIS, 'admin', 3);
  await store.addOrgMember(ORG, CAROL, 'member', 4);
  return { srv, base, store, users, ...users, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function call(base, method, p, token, body) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? JSON_HEADERS : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test('добавлять участников могут владелец и администратор; обычный участник — нет; администратор добавляет только обычных', async () => {
  const s = await start();
  try {
    const byMember = await call(s.base, 'POST', `/orgs/${ORG}/members`, s.carol.token, { userId: DAVE });
    assert.equal(byMember.status, 403, 'обычный участник не добавляет');
    assert.equal(byMember.json.code, 'org_role_required');
    const adminAsAdmin = await call(s.base, 'POST', `/orgs/${ORG}/members`, s.boris.token, { userId: DAVE, role: 'admin' });
    assert.equal(adminAsAdmin.status, 403, 'администратор не назначает администраторов');
    const adminAddsMember = await call(s.base, 'POST', `/orgs/${ORG}/members`, s.boris.token, { userId: DAVE });
    assert.equal(adminAddsMember.status, 200, 'администратор добавляет обычного участника');
    const ownerAddsAdmin = await call(s.base, 'POST', `/orgs/${ORG}/members`, s.anna.token, { userId: EVE, role: 'admin' });
    assert.equal(ownerAddsAdmin.status, 200, 'владелец назначает администратора при добавлении');
    const again = await call(s.base, 'POST', `/orgs/${ORG}/members`, s.anna.token, { userId: DAVE });
    assert.equal(again.status, 409, 'повторное добавление отклоняется');
  } finally {
    await s.stop();
  }
});

test('менять роли может только владелец; последнего владельца понизить нельзя', async () => {
  const s = await start();
  try {
    const byAdmin = await call(s.base, 'POST', `/orgs/${ORG}/members/${enc(CAROL)}/role`, s.boris.token, { role: 'admin' });
    assert.equal(byAdmin.status, 403, 'администратор роли не меняет');
    const promoted = await call(s.base, 'POST', `/orgs/${ORG}/members/${enc(CAROL)}/role`, s.anna.token, { role: 'admin' });
    assert.equal(promoted.status, 200, 'владелец меняет роль');
    const lastOwner = await call(s.base, 'POST', `/orgs/${ORG}/members/${enc(ANNA)}/role`, s.anna.token, { role: 'member' });
    assert.equal(lastOwner.status, 409, 'последнего владельца не понизить');
    assert.equal(lastOwner.json.code, 'last_owner');
    await call(s.base, 'POST', `/orgs/${ORG}/members/${enc(BORIS)}/role`, s.anna.token, { role: 'owner' });
    const demoteSelf = await call(s.base, 'POST', `/orgs/${ORG}/members/${enc(ANNA)}/role`, s.anna.token, { role: 'member' });
    assert.equal(demoteSelf.status, 200, 'при втором владельце понижение возможно');
  } finally {
    await s.stop();
  }
});


test('параллельное самопонижение двух владельцев не оставляет организацию без владельца', async () => {
  const s = await start();
  try {
    await s.store.setOrgMemberRole(ORG, BORIS, 'owner');
    const results = await Promise.all([
      call(s.base, 'POST', `/orgs/${ORG}/members/${enc(ANNA)}/role`, s.anna.token, { role: 'member' }),
      call(s.base, 'POST', `/orgs/${ORG}/members/${enc(BORIS)}/role`, s.boris.token, { role: 'member' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await s.store.countOrgOwners(ORG), 1, 'после гонки ровно один владелец');
    const actions = await s.store.listAdminActions(ORG);
    assert.equal(actions.filter((a) => a.action === 'role_change').length, 1, 'успешное изменение и аудит зафиксированы ровно один раз');
  } finally {
    await s.stop();
  }
});

test('ошибка записи admin audit откатывает изменение роли и удаление участника', async (t) => {
  const db = await storeForTest(PEPPER);
  if (!db?.pool || !db?.store) {
    t.skip('PostgreSQL test database is not configured');
    return;
  }
  const orgId = `org-audit-rollback-${randomBytes(6).toString('hex')}`;
  const owner = `@owner-${randomBytes(5).toString('hex')}:inone.test`;
  const member = `@member-${randomBytes(5).toString('hex')}:inone.test`;
  try {
    await db.store.addAccount(owner, 'test-password-hash');
    await db.store.addAccount(member, 'test-password-hash');
    await db.store.createOrganization({ orgId, name: 'Audit rollback', status: 'approved', createdBy: owner, createdAt: 1 });
    await db.store.addOrgMember(orgId, owner, 'owner', 2);
    await db.store.addOrgMember(orgId, member, 'owner', 3);
    const failingStore = createStore({
      pool: db.pool, pinPepper: PEPPER,
      testHooks: { beforeAdminActionInsert() { throw new Error('injected admin audit failure'); } },
    });
    await assert.rejects(
      failingStore.changeOrgMemberRoleAtomic({ orgId, actor: owner, target: member, role: 'member', at: 4 }),
      /injected admin audit failure/,
    );
    assert.equal(await db.store.orgRoleOf(orgId, member), 'owner', 'понижение откатилось');
    await assert.rejects(
      failingStore.removeOrgMemberAtomic({ orgId, actor: owner, target: member, action: 'member_remove', at: 5 }),
      /injected admin audit failure/,
    );
    assert.equal(await db.store.orgRoleOf(orgId, member), 'owner', 'удаление участника откатилось');
  } finally {
    await db.pool.query('DELETE FROM admin_action_log WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM room_members WHERE room_id IN (SELECT room_id FROM rooms WHERE org_id = $1)', [orgId]);
    await db.pool.query('DELETE FROM rooms WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM org_members WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM organizations WHERE org_id = $1', [orgId]);
    await db.pool.query('DELETE FROM accounts WHERE user_id = ANY($1::text[])', [[owner, member]]);
    await db.close();
  }
});

test('выход из организации снимает доступ к её комнатам; владелец с комнатами не выходит; администратор удаляет только обычных', async () => {
  const s = await start();
  try {
    const room = '!mgmt-room:inone.test';
    const created = await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: room, orgId: ORG, members: [CAROL] });
    assert.equal(created.status, 200, 'владелец создаёт комнату организации с участником');
    const left = await call(s.base, 'POST', `/orgs/${ORG}/leave`, s.carol.token, {});
    assert.equal(left.status, 200, 'участник выходит из организации');
    const back = await call(s.base, 'POST', `/rooms/${enc(room)}/members`, s.anna.token, { userId: CAROL });
    assert.equal(back.status, 403, 'после выхода в комнату организации не вернуть');
    assert.equal(back.json.code, 'org_not_member');
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG}/members`, s.anna.token, { userId: EVE, role: 'owner' })).status, 200, 'владелец назначает второго владельца');
    const ownerLeaves = await call(s.base, 'POST', `/orgs/${ORG}/leave`, s.anna.token, {});
    assert.equal(ownerLeaves.status, 409, 'владелец с комнатами не выходит');
    assert.equal(ownerLeaves.json.code, 'owns_rooms');
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG}/members`, s.anna.token, { userId: DAVE })).status, 200, 'владелец добавляет обычного участника');
    const adminRemovesOwner = await call(s.base, 'DELETE', `/orgs/${ORG}/members/${enc(ANNA)}`, s.boris.token);
    assert.equal(adminRemovesOwner.status, 403, 'администратор не удаляет владельца');
    const adminRemovesMember = await call(s.base, 'DELETE', `/orgs/${ORG}/members/${enc(DAVE)}`, s.boris.token);
    assert.equal(adminRemovesMember.status, 200, 'администратор удаляет обычного участника');
  } finally {
    await s.stop();
  }
});


test('organization member removal fails closed until every MLS room has a Remove Commit', async () => {
  const s = await start();
  const room = '!org-member-mls-revoke:inone.test';
  try {
    const created = await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: room, orgId: ORG, members: [CAROL] });
    assert.equal(created.status, 200);
    await s.anna.raw('POST', `/mls/groups/${enc(room)}/commits`, {
      epoch: 0, commit: Buffer.from('INITIAL-MLS').toString('base64'),
      changes: { adds: [], removes: [] },
    });

    const blocked = await call(s.base, 'DELETE', `/orgs/${ORG}/members/${enc(CAROL)}`, s.anna.token);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, 'mls_removal_required');
    assert.deepEqual(blocked.json.rooms, [room]);
    assert.equal(await s.store.orgRoleOf(ORG, CAROL), 'member', 'organization membership is not partially removed');
    assert.ok((await s.store.getRoom(room)).members.includes(CAROL), 'room membership is not deleted outside MLS');

    await s.anna.raw('POST', `/mls/groups/${enc(room)}/commits`, {
      epoch: 1, commit: Buffer.from('REMOVE-CAROL').toString('base64'),
      changes: { adds: [], removes: [CAROL] },
    });
    const removed = await call(s.base, 'DELETE', `/orgs/${ORG}/members/${enc(CAROL)}`, s.anna.token);
    assert.equal(removed.status, 200);
    assert.equal(await s.store.orgRoleOf(ORG, CAROL), null);
  } finally {
    await s.stop();
  }
});
