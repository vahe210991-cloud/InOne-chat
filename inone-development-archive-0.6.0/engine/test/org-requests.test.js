import { randomBytes } from 'node:crypto';
// Заявки на создание организации (шаг 5.3): заявитель загружает документы; администрация платформы видит их только на просмотр;
// решение принимает только владелец платформы; решения и просмотры администрации пишутся в журнал;
// содержимое документа не попадает в журнал запросов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const DIR = '@director-req:inone.test';
const OUT = '@outsider-req:inone.test';
const STAFF = '@staff-req:inone.test';
const OWNER = '@owner-req:inone.test';
const JSON_HEADERS = { 'content-type': 'application/json' };

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, docsSecret: 'test-docs-secret-0123456789-abcdefgh' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const dir = await ChatClient.create(base, DIR, 'D_PHONE', PW);
  const out = await ChatClient.create(base, OUT, 'O_PHONE', PW);
  const staff = await ChatClient.create(base, STAFF, 'S_PHONE', PW);
  const owner = await ChatClient.create(base, OWNER, 'P_PHONE', PW);
  await store.setPlatformRole(OWNER, 'owner');
  await store.setPlatformRole(STAFF, 'admin');
  return { srv, base, store, dir, out, staff, owner, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function call(base, method, p, token, body) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? JSON_HEADERS : {}) }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, json, buf };
}

test('заявитель загружает документ и видит его; посторонний не видит; администрация открывает на просмотр и это записано', async () => {
  const s = await start();
  try {
    const created = await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Ромашка' });
    assert.equal(created.status, 200);
    const requestId = created.json.requestId;
    const content = Buffer.from('СЕКРЕТНЫЙ ДОКУМЕНТ: регистрация компании 42', 'utf8');
    const up = await call(s.base, 'POST', `/org-requests/${requestId}/documents`, s.dir.token, { kind: 'registration', contentBase64: content.toString('base64') });
    assert.equal(up.status, 200, 'заявитель загружает документ');
    const docId = up.json.docId;
    const own = await call(s.base, 'GET', `/org-requests/${requestId}/documents/${docId}`, s.dir.token);
    assert.equal(own.status, 200);
    assert.ok(own.buf.equals(content), 'заявитель получает свой документ');
    const outsider = await call(s.base, 'GET', `/org-requests/${requestId}/documents/${docId}`, s.out.token);
    assert.equal(outsider.status, 404, 'посторонний документа не видит');
    const viewed = await call(s.base, 'GET', `/org-requests/${requestId}/documents/${docId}`, s.staff.token);
    assert.equal(viewed.status, 200, 'администрация открывает документ на просмотр');
    assert.ok(viewed.buf.equals(content), 'администрация видит тот же документ');
    const log = await s.store.listOrgRequestLog(requestId);
    assert.ok(log.some((e) => e.action === 'view' && e.actor === STAFF), 'просмотр администрации записан в журнал');
  } finally {
    await s.stop();
  }
});

test('решение принимает только владелец платформы; одобрение создаёт организацию с заявителем-владельцем; решённую заявку не меняют', async () => {
  const s = await start();
  try {
    const created = await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Лилия' });
    const requestId = created.json.requestId;
    await call(s.base, 'POST', `/org-requests/${requestId}/documents`, s.dir.token, { kind: 'authority', contentBase64: Buffer.from('доверенность').toString('base64') });
    const byStaff = await call(s.base, 'POST', `/org-requests/${requestId}/decision`, s.staff.token, { decision: 'approve' });
    assert.equal(byStaff.status, 403, 'администрация не принимает решение');
    assert.equal(byStaff.json.code, 'not_platform_owner');
    const approved = await call(s.base, 'POST', `/org-requests/${requestId}/decision`, s.owner.token, { decision: 'approve' });
    assert.equal(approved.status, 200);
    const orgId = approved.json.orgId;
    assert.ok(orgId, 'организация создана');
    assert.equal(await s.store.orgRoleOf(orgId, DIR), 'owner', 'заявитель — владелец организации');
    const req = await s.store.getOrgRequest(requestId);
    assert.equal(req.status, 'approved');
    assert.equal(req.orgId, orgId);
    const again = await call(s.base, 'POST', `/org-requests/${requestId}/decision`, s.owner.token, { decision: 'reject' });
    assert.equal(again.status, 409, 'решённую заявку больше не меняют');
  } finally {
    await s.stop();
  }
});

test('отклонённая заявка не создаёт организацию; отказ записан в журнал', async () => {
  const s = await start();
  try {
    const created = await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Тюльпан' });
    const requestId = created.json.requestId;
    const rejected = await call(s.base, 'POST', `/org-requests/${requestId}/decision`, s.owner.token, { decision: 'reject' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.json.status, 'rejected');
    const req = await s.store.getOrgRequest(requestId);
    assert.equal(req.orgId, null, 'организация не создана');
    const log = await s.store.listOrgRequestLog(requestId);
    assert.ok(log.some((e) => e.action === 'reject' && e.actor === OWNER), 'отказ записан в журнал');
  } finally {
    await s.stop();
  }
});

test('содержимое документа не попадает в журнал запросов', async () => {
  const s = await start();
  try {
    const created = await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Нарцисс' });
    const secret = FIXTURE_1;
    const b64 = Buffer.from(secret, 'utf8').toString('base64');
    await call(s.base, 'POST', `/org-requests/${created.json.requestId}/documents`, s.dir.token, { kind: 'other', contentBase64: b64 });
    const dump = await s.srv.dump();
    assert.ok(dump.includes('/org-requests/'), 'контроль: запрос загрузки попал в журнал');
    assert.ok(!dump.includes(b64), 'содержимое документа (base64) не попало в журнал');
    assert.ok(!dump.includes(secret), 'содержимое документа не попало в журнал открытым текстом');
  } finally {
    await s.stop();
  }
});


test('authenticated profile exposes platform role for role-aware navigation', async () => {
  const s = await start();
  try {
    const ownerProfile = await call(s.base, 'GET', '/profile', s.owner.token);
    const adminProfile = await call(s.base, 'GET', '/profile', s.staff.token);
    const applicantProfile = await call(s.base, 'GET', '/profile', s.dir.token);
    assert.equal(ownerProfile.status, 200);
    assert.equal(ownerProfile.json.platformRole, 'owner');
    assert.equal(adminProfile.json.platformRole, 'admin');
    assert.equal(applicantProfile.json.platformRole, null);
  } finally {
    await s.stop();
  }
});


test('concurrent owner decisions serialize and exactly one decision is committed', async () => {
  const s = await start();
  try {
    const created = await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Конкурентная заявка' });
    assert.equal(created.status, 200);
    const requestId = created.json.requestId;
    const [approved, rejected] = await Promise.all([
      call(s.base, 'POST', `/org-requests/${requestId}/decision`, s.owner.token, { decision: 'approve' }),
      call(s.base, 'POST', `/org-requests/${requestId}/decision`, s.owner.token, { decision: 'reject' }),
    ]);
    const outcomes = [approved, rejected];
    assert.equal(outcomes.filter((result) => result.status === 200).length, 1);
    assert.equal(outcomes.filter((result) => result.status === 409).length, 1);

    const request = await s.store.getOrgRequest(requestId);
    const decisions = (await s.store.listOrgRequestLog(requestId))
      .filter((entry) => entry.action === 'approve' || entry.action === 'reject');
    assert.equal(decisions.length, 1, 'exactly one decision is journaled');
    if (request.status === 'approved') {
      assert.equal(request.orgId, `org-${requestId}`);
      assert.equal(await s.store.orgRoleOf(request.orgId, DIR), 'owner');
      assert.equal(await s.store.orgStatus(request.orgId), 'approved');
    } else {
      assert.equal(request.status, 'rejected');
      assert.equal(request.orgId, null);
    }
  } finally {
    await s.stop();
  }
});
