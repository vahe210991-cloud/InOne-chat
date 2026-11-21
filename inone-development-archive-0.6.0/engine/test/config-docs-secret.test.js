import { randomBytes } from 'node:crypto';
// Секрет шифрования документов (шаг 5.8): в продакшене запуск не начинается без него или с коротким значением.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const DOCS_SECRET = randomBytes(24).toString('hex');
const PROD = {
  NODE_ENV: 'production',
  INONE_PIN_PEPPER: 'prod-pepper-7f3a9c1e5b2d8046a1c9e7f0b3d5a2c8',
  INONE_PUBLIC_URL: 'https://inone.example',
  INONE_REGISTRATION_MODE: 'verified',
  INONE_FILES_DIR: '/var/lib/inone/files',
  INONE_MAIL_TRANSPORT: 'smtp',
  INONE_SMTP_HOST: 'smtp.example',
  INONE_SMTP_FROM: 'no-reply@inone.example',
  INONE_EMAIL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  INONE_FIREBASE_PROJECT_ID: 'inone-messenger',
  INONE_PUSH_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  DATABASE_URL: 'postgresql://db.example/inone',
};

test('в продакшене без секрета документов запуск не начинается', () => {
  assert.throws(() => loadConfig({ ...PROD }), /INONE_DOCS_SECRET/);
});

test('с секретом документов не короче 32 символов запуск проходит, секрет попадает в настройки', () => {
  const config = loadConfig({ ...PROD, INONE_DOCS_SECRET: DOCS_SECRET });
  assert.equal(config.docsSecret, DOCS_SECRET);
});

test('в продакшене короткий секрет документов не принимается', () => {
  assert.throws(() => loadConfig({ ...PROD, INONE_DOCS_SECRET: 'short' }), /INONE_DOCS_SECRET/);
});
