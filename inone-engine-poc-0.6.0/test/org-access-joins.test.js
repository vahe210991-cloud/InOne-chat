import { randomBytes } from 'node:crypto';
// Единое правило доступа (шаг 5.2), входы в комнату: открытая группа, заявка и одобрение, приглашение.
// Посторонний организации не входит ни одним способом; участник организации входит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ANNA = '@anna-join:inone.test';
const BORIS = '@boris-join:inone.test';
const ORG = 'org-join';
const enc = encodeURIComponent;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const anna = await ChatClient.create(base, ANNA, 'A_PHONE', PW);
  const boris = await ChatClient.create(base, BORIS, 'B_PHONE', PW);
  await store.createOrganization({ orgId: ORG, name: 'Тест входов', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.addOrgMember(ORG, ANNA, 'owner', 2);
  return { srv, base, store, anna, boris, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function post(base, token, p, body) {
  const res = await fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...JSON_HEADERS }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test('открытая группа: посторонний организации не входит; после добавления в организацию входит', async () => {
  const s = await start();
  try {
    const room = '!join-open:inone.test';
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Открытая', visibility: 'public', joinPolicy: 'open' })).status, 200);
    const outsider = await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    assert.equal(outsider.status, 403, 'посторонний организации не входит в открытую группу');
    assert.equal(outsider.json.code, 'org_not_member');
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    const joined = await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    assert.equal(joined.status, 200);
    assert.equal(joined.json.status, 'joined', 'участник организации входит');
  } finally {
    await s.stop();
  }
});

test('заявка на вход: одобрить может только участник организации; после добавления в организацию одобрение проходит', async () => {
  const s = await start();
  try {
    const room = '!join-approval:inone.test';
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'По заявке', visibility: 'public', joinPolicy: 'approval' })).status, 200);
    const request = await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    assert.equal(request.json.status, 'requested', 'заявка подана');
    const refused = await post(s.base, s.anna.token, `/rooms/${enc(room)}/requests/${enc(BORIS)}/approve`, {});
    assert.equal(refused.status, 403, 'одобрить заявку постороннего нельзя');
    assert.equal(refused.json.code, 'org_not_member');
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    const approved = await post(s.base, s.anna.token, `/rooms/${enc(room)}/requests/${enc(BORIS)}/approve`, {});
    assert.equal(approved.status, 200, 'заявка участника организации одобряется');
  } finally {
    await s.stop();
  }
});

test('приглашение: вступить по нему может только участник организации', async () => {
  const s = await start();
  try {
    const room = '!join-invite:inone.test';
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    const invite = await post(s.base, s.anna.token, `/rooms/${enc(room)}/invites`, {});
    assert.equal(invite.status, 200, 'приглашение создано');
    const token = String(invite.json.url ?? '').split('/invite/')[1];
    assert.ok(token, 'у приглашения есть токен');
    const outsider = await post(s.base, s.boris.token, '/invites/join', { token });
    assert.equal(outsider.status, 403, 'посторонний организации не входит по приглашению');
    assert.equal(outsider.json.code, 'org_not_member');
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    const joined = await post(s.base, s.boris.token, '/invites/join', { token });
    assert.equal(joined.status, 200);
    assert.equal(joined.json.status, 'joined', 'участник организации входит по приглашению');
  } finally {
    await s.stop();
  }
});
