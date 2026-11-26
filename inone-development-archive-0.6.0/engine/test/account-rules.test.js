import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword,
  checkPassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '../src/account-rules.js';

test('password policy uses a shared minimum and maximum code-point length', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(MAX_PASSWORD_LENGTH, 128);

  const valid = 'a'.repeat(MAX_PASSWORD_LENGTH);
  const hash = hashPassword(valid);
  assert.equal(checkPassword(valid, hash), true);
  assert.equal(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1), hash), false);
  assert.equal(checkPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1), hash), false);
  assert.throws(() => hashPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1)), /password length/);
});

test('password length counts Unicode code points consistently', () => {
  const valid = '🙂'.repeat(MAX_PASSWORD_LENGTH);
  const hash = hashPassword(valid);
  assert.equal(checkPassword(valid, hash), true);
});
