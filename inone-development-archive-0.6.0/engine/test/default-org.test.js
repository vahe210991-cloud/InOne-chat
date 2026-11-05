import { randomBytes } from 'node:crypto';
// Новый аккаунт не входит в организацию по умолчанию (решение владельца): без организации комнату не создать,
// по нику его не найти и ключи не выдать, пока нет общей одобренной организации.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ANNA = '@anna-default:inone.test';
const BORIS = '@boris-default:inone.test';
const SHARED = 'org-default-shared';
const enc = encodeURIComponent;

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const anna = await ChatClient.create(base, ANNA, 'A_PHONE', PW);
  const boris = await ChatClient.create(base, BORIS, 'B_PHONE', PW);
  await store.setNicknameForTests(ANNA, 'annadefault');
  await store.setNicknameForTests(BORIS, 'borisdefault');
  return { srv, base, store, anna, boris, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function search(base, token, nickname) {
  const res = await fetch(`${base}/users/search?nickname=${enc(nickname)}`, { headers: { authorization: `Bearer ${token}` } });
  return res.status;
}

test('новый аккаунт не входит в организацию по умолчанию: комнату без организации не создать', async () => {
  const s = await start();
  try {
    await assert.rejects(s.anna.raw('POST', '/rooms', { roomId: '!default-1:inone.test', members: [] }), (e) => e.status === 403, 'без организации комната не создаётся');
    assert.equal(await s.store.orgRoleOf('org-default', ANNA), null, 'новый аккаунт не участник организации по умолчанию');
  } finally {
    await s.stop();
  }
});

test('по нику не находит и ключи не выдаёт без общей организации; после общей организации — находит', async () => {
  const s = await start();
  try {
    assert.equal(await search(s.base, s.anna.token, 'borisdefault'), 404, 'без общей организации по нику не находит');
    await s.store.createOrganization({ orgId: SHARED, name: 'Общая', status: 'approved', createdBy: ANNA, createdAt: 1 });
    await s.store.addOrgMember(SHARED, ANNA, 'owner', 2);
    await s.store.addOrgMember(SHARED, BORIS, 'member', 3);
    assert.equal(await search(s.base, s.anna.token, 'borisdefault'), 200, 'в общей организации находит по нику');
  } finally {
    await s.stop();
  }
});
