import { randomBytes } from 'node:crypto';
// Журнал действий администраторов (шаг 5.7): действия организации видны владельцу и администратору, участнику — нет;
// администратор, не состоящий в комнате, её события не читает (сквозное шифрование).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ANNA = '@anna-journal:inone.test';
const BORIS = '@boris-journal:inone.test';
const CAROL = '@carol-journal:inone.test';
const DAVE = '@dave-journal:inone.test';
const EVE = '@eve-journal:inone.test';
const ORG_A = 'org-journal-a';
const ORG_B = 'org-journal-b';
const enc = encodeURIComponent;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const users = {};
  for (const [name, id] of [['anna', ANNA], ['boris', BORIS], ['carol', CAROL], ['dave', DAVE], ['eve', EVE]]) {
    users[name] = await ChatClient.create(base, id, `${name}-PHONE`, PW);
  }
  await store.createOrganization({ orgId: ORG_A, name: 'Первая', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.createOrganization({ orgId: ORG_B, name: 'Вторая', status: 'approved', createdBy: DAVE, createdAt: 2 });
  await store.addOrgMember(ORG_A, ANNA, 'owner', 3);
  await store.addOrgMember(ORG_A, BORIS, 'admin', 4);
  await store.addOrgMember(ORG_A, CAROL, 'member', 5);
  await store.addOrgMember(ORG_B, DAVE, 'owner', 6);
  return { srv, base, store, ...users, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function call(base, method, p, token, body) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? JSON_HEADERS : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test('журнал действий администраторов: действия организации видны владельцу и администратору, участнику — нет', async () => {
  const s = await start();
  try {
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_A}/members`, s.anna.token, { userId: EVE })).status, 200);
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_A}/members/${enc(EVE)}/role`, s.anna.token, { role: 'admin' })).status, 200);
    assert.equal((await call(s.base, 'DELETE', `/orgs/${ORG_A}/members/${enc(EVE)}`, s.anna.token)).status, 200);
    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.anna.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(proposed.json.linkId)}/accept`, s.dave.token, {})).status, 200);
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_A}/settings`, s.anna.token, { field: 'maxGroupMembers', value: 5 })).status, 200);
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(proposed.json.linkId)}/revoke`, s.dave.token, {})).status, 200);
    const byAdmin = await call(s.base, 'GET', `/orgs/${ORG_A}/admin-log`, s.boris.token);
    assert.equal(byAdmin.status, 200, 'администратор читает журнал');
    const actions = byAdmin.json.actions.map((a) => a.action);
    for (const expected of ['member_add', 'role_change', 'member_remove', 'link_propose', 'link_accept', 'link_revoke', 'setting_change']) {
      assert.ok(actions.includes(expected), `в журнале есть ${expected}`);
    }
    const roleEntry = byAdmin.json.actions.find((a) => a.action === 'role_change');
    assert.equal(roleEntry.actor, ANNA, 'в журнале указан тот, кто сделал действие');
    assert.equal(roleEntry.detail, 'member->admin', 'в журнале указаны прежняя и новая роль');
    const byMember = await call(s.base, 'GET', `/orgs/${ORG_A}/admin-log`, s.carol.token);
    assert.equal(byMember.status, 403, 'участник журнал не читает');
  } finally {
    await s.stop();
  }
});

test('администратор организации не читает содержимое комнат, в которых не состоит (сквозное шифрование)', async () => {
  const s = await start();
  try {
    const room = '!journal-room:inone.test';
    await s.anna.createRoom(room, [ANNA, CAROL], { orgId: ORG_A });
    const control = await call(s.base, 'GET', `/rooms/${enc(room)}/events`, s.carol.token);
    assert.equal(control.status, 200, 'контроль: участник комнаты читает её события');
    const adminRead = await call(s.base, 'GET', `/rooms/${enc(room)}/events`, s.boris.token);
    assert.equal(adminRead.status, 403, 'администратор, не состоящий в комнате, её события не читает');
    assert.equal(adminRead.json.events, undefined, 'содержимого в ответе нет');
  } finally {
    await s.stop();
  }
});
