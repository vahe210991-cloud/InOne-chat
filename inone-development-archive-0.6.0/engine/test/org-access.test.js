import { randomBytes } from 'node:crypto';
// Единое правило доступа (этап 5, шаг 5.2): участник комнаты обязан быть участником её одобренной организации.
// Создать комнату в чужой или неодобренной организации нельзя; добавить в комнату постороннего нельзя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ANNA = '@anna-acc:inone.test';
const BORIS = '@boris-acc:inone.test';
const ORG_B = 'org-b-acc';
const ORG_PENDING = 'org-pending-acc';
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
  return { srv, base, store, anna, boris, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function post(base, token, p, body) {
  const res = await fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...JSON_HEADERS }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test('создать комнату в организации может только её участник; в неодобренной организации — никто', async () => {
  const s = await start();
  try {
    await s.store.createOrganization({ orgId: ORG_B, name: 'Вторая', status: 'approved', createdBy: ANNA, createdAt: 1 });
    const outside = await post(s.base, s.anna.token, '/rooms', { roomId: '!acc-1:inone.test', orgId: ORG_B });
    assert.equal(outside.status, 403, 'не участник организации не создаёт комнату в ней');
    assert.equal(outside.json.code, 'org_not_member');
    await s.store.addOrgMember(ORG_B, ANNA, 'owner', 2);
    const inside = await post(s.base, s.anna.token, '/rooms', { roomId: '!acc-1:inone.test', orgId: ORG_B });
    assert.equal(inside.status, 200, 'участник организации создаёт комнату');
    await s.store.createOrganization({ orgId: ORG_PENDING, name: 'На проверке', status: 'pending', createdBy: ANNA, createdAt: 3 });
    await s.store.addOrgMember(ORG_PENDING, ANNA, 'owner', 4);
    const pending = await post(s.base, s.anna.token, '/rooms', { roomId: '!acc-2:inone.test', orgId: ORG_PENDING });
    assert.equal(pending.status, 403, 'в неодобренной организации комнату не создать');
    assert.equal(pending.json.code, 'org_not_approved');
  } finally {
    await s.stop();
  }
});

test('в комнату организации нельзя добавить постороннего; участник организации — можно', async () => {
  const s = await start();
  try {
    await s.store.createOrganization({ orgId: ORG_B, name: 'Вторая', status: 'approved', createdBy: ANNA, createdAt: 1 });
    await s.store.addOrgMember(ORG_B, ANNA, 'owner', 2);
    const created = await post(s.base, s.anna.token, '/rooms', { roomId: '!acc-3:inone.test', orgId: ORG_B });
    assert.equal(created.status, 200);
    await assert.rejects(s.anna.addMember('!acc-3:inone.test', BORIS), (error) => error.status === 403, 'посторонний не добавляется в комнату организации');
    await s.store.addOrgMember(ORG_B, BORIS, 'member', 3);
    await s.anna.addMember('!acc-3:inone.test', BORIS);
    assert.ok((await s.anna.raw('GET', `/rooms/${enc('!acc-3:inone.test')}/members`)).members.includes(BORIS), 'участник организации добавляется через MLS');
  } finally {
    await s.stop();
  }
});
