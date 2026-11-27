import { randomBytes } from 'node:crypto';
// Первичный аккаунт владельца: создаётся в базе, вход по паролю работает; защиты от повторов и подтверждения оператора.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createMemoryStore } from '../src/store-memory.js';
import { bootstrapOwnerAccount } from '../src/bootstrap-owner.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const FIXTURE_2 = randomBytes(16).toString('hex');
const OWNER = { email: 'owner@example.test', nickname: 'owner', password: FIXTURE_1, phone: '+37477000001', pin: '80421697', pinConfirmation: '80421697', pinPepper: PEPPER, confirmOwnerEmail: true };

async function makeStore() {
  if (process.env.DATABASE_URL) {
    const db = await storeForTest(PEPPER);
    return { store: db.store, close: () => db.close() };
  }
  return { store: createMemoryStore({ pinPepper: PEPPER }), close: async () => {} };
}

test('владелец создаётся в базе, вход по паролю работает, номер закреплён за ним', async () => {
  const { store, close } = await makeStore();
  const srv = createServer({ defaultOrgAutoJoin: true, store, registrationMode: 'verified', requirePhone: false, pinPepper: PEPPER });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const result = await bootstrapOwnerAccount({ store, ...OWNER });
    assert.equal(result.nickname, 'owner');
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: OWNER.email, password: OWNER.password, deviceId: 'owner-laptop', label: 'Ноутбук владельца', platform: 'test' }),
    });
    assert.equal(login.status, 200, 'вход по паролю работает');
    assert.equal(await store.phoneOwner('+37477000001'), result.userId, 'номер закреплён за владельцем');
  } finally {
    await new Promise((r) => srv.server.close(r));
    await close();
  }
});

test('без подтверждения оператора, что почта его, аккаунт не создаётся', async () => {
  const { store, close } = await makeStore();
  try {
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, confirmOwnerEmail: false }), /confirm that the email belongs to the owner/);
    assert.equal(await store.userIdByEmail(OWNER.email), null, 'в базе ничего не появилось');
  } finally {
    await close();
  }
});

test('второй аккаунт с той же почтой или тем же никнеймом не создаётся', async () => {
  const { store, close } = await makeStore();
  try {
    await bootstrapOwnerAccount({ store, ...OWNER });
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, nickname: 'other', phone: '+37477000002' }), /already registered/);
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, nickname: 'other', email: 'second@example.test' }), /phone already used/);
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, email: 'second@example.test', nickname: 'owner', phone: '+37477000003' }), /nickname taken/);
  } finally {
    await close();
  }
});

test('короткий пароль и неверный никнейм отклоняются', async () => {
  const { store, close } = await makeStore();
  try {
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, password: 'abc' }), /at least 8 characters/);
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, nickname: 'x' }));
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, pin: '12345678', pinConfirmation: '87654321' }), /PIN confirmation/);
    await assert.rejects(bootstrapOwnerAccount({ store, ...OWNER, pin: '1234567', pinConfirmation: '1234567' }), /eight digits/);
  } finally {
    await close();
  }
});

test('в режиме проверки почты номер обязателен и закрепляется за аккаунтом', async () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, store, registrationMode: 'verified', requirePhone: true, pinPepper: PEPPER, devEmailCode: '000000' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const email = 'phone@example.test';
    await post('/register/email', { email });
    const token = (await (await post('/register/email/confirm', { email, code: '000000' })).json()).registrationToken;
    const noPhone = await post('/register', { email, registrationToken: token, password: FIXTURE_1, nickname: 'phoneuser', pin: '80421697', pinConfirmation: '80421697' });
    assert.equal(noPhone.status, 400, 'без номера регистрация не проходит');
    const withPhone = await post('/register', { email, registrationToken: token, password: FIXTURE_1, nickname: 'phoneuser', phone: '+37477000002', pin: '80421697', pinConfirmation: '80421697' });
    assert.equal(withPhone.status, 200);
    const userId = (await withPhone.json()).userId;
    assert.equal(await store.phoneOwner('+37477000002'), userId);
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
});
