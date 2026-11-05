import { randomBytes } from 'node:crypto';
// Управление организацией (шаг 5.4): владелец меняет роли; владелец и администратор добавляют и удаляют участников;
// выход из организации снимает доступ к её комнатам; владелец с комнатами не выходит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

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
