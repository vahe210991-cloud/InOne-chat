import { randomBytes } from 'node:crypto';
// Документы заявок (шаги 5.3–5.4): документ хранится зашифрованным; без секрета оператора загрузка не принимается;
// отклонённые заявки и их документы удаляются через 90 дней после решения, одобренные — остаются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';
import { createMemoryObjectStore } from '../src/object-store.js';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const DOCS = 'test-docs-secret-0123456789-abcdefgh';
const DIR = '@director-prot:inone.test';
const OWNER = '@owner-prot:inone.test';
const DAY = 24 * 3600_000;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function start({ docsSecret = DOCS } = {}) {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const objectStore = createMemoryObjectStore();
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, objectStore, docsSecret });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const dir = await ChatClient.create(base, DIR, 'D_PHONE', PW);
  const owner = await ChatClient.create(base, OWNER, 'P_PHONE', PW);
  await store.setPlatformRole(OWNER, 'owner');
  return { srv, base, store, objectStore, dir, owner, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function call(base, method, p, token, body) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? JSON_HEADERS : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, json, buf };
}

test('документ хранится зашифрованным: в хранилище нет открытого текста; заявитель получает его целиком', async () => {
  const s = await start();
  try {
    const created = await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Шифр' });
    const secret = FIXTURE_1;
    const up = await call(s.base, 'POST', `/org-requests/${created.json.requestId}/documents`, s.dir.token, { kind: 'registration', contentBase64: Buffer.from(secret, 'utf8').toString('base64') });
    assert.equal(up.status, 200);
    const doc = await s.store.getOrgRequestDocument(up.json.docId);
    const raw = await s.objectStore.get(doc.objectKey);
    assert.ok(raw && raw.length > 0, 'документ записан в хранилище');
    assert.ok(!raw.includes(Buffer.from(secret, 'utf8')), 'открытого текста в хранилище нет');
    const got = await call(s.base, 'GET', `/org-requests/${created.json.requestId}/documents/${up.json.docId}`, s.dir.token);
    assert.equal(got.buf.toString('utf8'), secret, 'заявитель получает документ целиком');
  } finally {
    await s.stop();
  }
});

test('без секрета оператора документы не принимаются', async () => {
  const s = await start({ docsSecret: null });
  try {
    const created = await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Без ключа' });
    const up = await call(s.base, 'POST', `/org-requests/${created.json.requestId}/documents`, s.dir.token, { kind: 'other', contentBase64: Buffer.from('x').toString('base64') });
    assert.equal(up.status, 503, 'документы не принимаются без ключа шифрования');
    assert.equal(up.json.error, 'document storage is not configured');
  } finally {
    await s.stop();
  }
});

test('отклонённая заявка и её документы удаляются через 90 дней; одобренная заявка и её документ остаются', async () => {
  const s = await start();
  try {
    const rejectedId = (await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Отказ' })).json.requestId;
    const rejectedDoc = (await call(s.base, 'POST', `/org-requests/${rejectedId}/documents`, s.dir.token, { kind: 'authority', contentBase64: Buffer.from('отказ-документ').toString('base64') })).json.docId;
    const approvedId = (await call(s.base, 'POST', '/org-requests', s.dir.token, { name: 'Одобрение' })).json.requestId;
    const approvedDoc = (await call(s.base, 'POST', `/org-requests/${approvedId}/documents`, s.dir.token, { kind: 'authority', contentBase64: Buffer.from('одобрен-документ').toString('base64') })).json.docId;
    assert.equal((await call(s.base, 'POST', `/org-requests/${rejectedId}/decision`, s.owner.token, { decision: 'reject' })).status, 200);
    assert.equal((await call(s.base, 'POST', `/org-requests/${approvedId}/decision`, s.owner.token, { decision: 'approve' })).status, 200);
    const rejectedKey = (await s.store.getOrgRequestDocument(rejectedDoc)).objectKey;
    s.srv.advance(91 * DAY);
    const swept = await s.srv.sweepExpired();
    assert.ok(swept.docs >= 1, 'документы отклонённой заявки удалены по сроку');
    assert.equal(await s.store.getOrgRequest(rejectedId), null, 'отклонённая заявка удалена');
    assert.equal(await s.objectStore.get(rejectedKey), null, 'файл документа удалён из хранилища');
    assert.ok(await s.store.getOrgRequest(approvedId), 'одобренная заявка осталась');
    await s.dir.renewSession();
    const kept = await call(s.base, 'GET', `/org-requests/${approvedId}/documents/${approvedDoc}`, s.dir.token);
    assert.equal(kept.status, 200, 'документ одобренной заявки доступен');
  } finally {
    await s.stop();
  }
});
