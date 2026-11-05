import { randomBytes } from 'node:crypto';
// Инструмент создания аккаунта для разработки: проходит обычную регистрацию с фиксированным кодом.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createDevAccount } from '../scripts/dev-create-account.mjs';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const FIXTURE_2 = randomBytes(16).toString('hex');

test('аккаунт для разработки создаётся обычной регистрацией с фиксированным кодом, пароль не возвращается', async () => {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'verified', requirePhone: false, pinPepper: PEPPER, devEmailCode: '000000' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const result = await createDevAccount({ base, email: 'owner@example.test', nickname: 'owner', password: FIXTURE_1, code: '000000' });
    assert.equal(result.nickname, 'owner');
    assert.ok(!JSON.stringify(result).includes(FIXTURE_1), 'пароль не попадает в результат');
    await assert.rejects(createDevAccount({ base, email: 'owner@example.test', nickname: 'owner2', password: FIXTURE_2, code: '000000' }), /register/);
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
});

test('с неверным кодом аккаунт не создаётся', async () => {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'verified', requirePhone: false, pinPepper: PEPPER, devEmailCode: '000000' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    await assert.rejects(createDevAccount({ base, email: 'bad@example.test', nickname: 'badcode', password: FIXTURE_1, code: '111111' }), /confirm/);
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
});
