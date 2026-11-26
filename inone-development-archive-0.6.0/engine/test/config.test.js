import { randomBytes } from 'node:crypto';
// Настройки сервера: продакшен отказывается запускаться с небезопасными значениями.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const DOCS_SECRET = randomBytes(24).toString('hex');
const GOOD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://db.example/inone',
  INONE_PIN_PEPPER: 'q8Lw2rT6vN1zXc4bH9mK0pJs7dFg5aYe',
  INONE_DOCS_SECRET: DOCS_SECRET,
  INONE_OBJECT_SIGNING_SECRET: randomBytes(32).toString('hex'),
  INONE_EMAIL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  INONE_FIREBASE_PROJECT_ID: 'inone-messenger',
  INONE_PUSH_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  INONE_PUBLIC_URL: 'https://inone.example',
  INONE_FILES_DIR: '/var/lib/inone/objects',
};

test('production requires a persistent object URL signing secret', () => {
  const { INONE_OBJECT_SIGNING_SECRET, ...withoutSecret } = GOOD;
  assert.throws(() => loadConfig(withoutSecret), /INONE_OBJECT_SIGNING_SECRET/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_OBJECT_SIGNING_SECRET: 'short' }), /INONE_OBJECT_SIGNING_SECRET/);
  assert.equal(loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'memory', NODE_ENV: 'development' }).objectSigningSecret, GOOD.INONE_OBJECT_SIGNING_SECRET);
});

test('trusted proxy mode requires an explicit valid IP allowlist', () => {
  const testEnv = { ...GOOD, NODE_ENV: 'development', INONE_MAIL_TRANSPORT: 'memory' };
  assert.throws(() => loadConfig({ ...testEnv, INONE_TRUST_PROXY: 'true' }), /INONE_TRUSTED_PROXY_IPS/);
  assert.throws(() => loadConfig({ ...testEnv, INONE_TRUST_PROXY: 'true', INONE_TRUSTED_PROXY_IPS: 'not-an-ip' }), /valid IP addresses/);
  const config = loadConfig({ ...testEnv, INONE_TRUST_PROXY: 'true', INONE_TRUSTED_PROXY_IPS: '127.0.0.1, 192.0.2.10' });
  assert.deepEqual(config.trustedProxyIps, ['127.0.0.1', '192.0.2.10']);
  assert.equal(config.trustProxy, true);
  assert.throws(() => loadConfig({ ...testEnv, INONE_TRUSTED_PROXY_IPS: '127.0.0.1' }), /requires INONE_TRUST_PROXY=true/);
});

test('продакшен без реального почтового транспорта не стартует', () => {
  assert.throws(() => loadConfig(GOOD), /needs a real mail transport/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'smtp' }), /INONE_SMTP_HOST is required/);
});

test('продакшен со всеми настройками проходит проверку и подставляет значения по умолчанию', () => {
  const config = loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'memory', NODE_ENV: 'development' });
  assert.equal(config.port, 8080);
  assert.equal(config.registrationMode, 'verified');
  assert.equal(config.bodyLimitBytes, 4 * 1024 * 1024);
  assert.equal(config.runMigrations, true);
});

test('без базы данных сервер не стартует', () => {
  assert.throws(() => loadConfig({ ...GOOD, DATABASE_URL: '' }), /DATABASE_URL is required/);
});

test('продакшен не открывает регистрацию без проверки', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'smtp', INONE_REGISTRATION_MODE: 'open' }), /open registration is not allowed/);
});

test('короткий или тестовый перец отклоняется', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_PIN_PEPPER: 'короткий' }), /at least 32 characters/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_PIN_PEPPER: 'test-pepper-0123456789-0123456789-abcd' }), /test or example value/);
});

test('продакшен требует адрес https', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_PUBLIC_URL: 'http://inone.example' }), /must start with https/);
});

test('разработка работает с локальными значениями, перец помечен и не годится для продакшена', () => {
  const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://db.example/inone' });
  assert.equal(config.publicUrl, 'http://localhost:8080');
  assert.match(config.pinPepper, /dev-only/);
});

test('неверные числа отклоняются', () => {
  assert.throws(() => loadConfig({ ...GOOD, PORT: 'много' }), /PORT must be a port number/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_BODY_LIMIT_BYTES: '10' }), /at least 1024/);
});

test('продакшен со SMTP, адресом отправителя и TLS проходит проверку', () => {
  const config = loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.provider.test', INONE_SMTP_FROM: 'InOne <noreply@inone.example>' });
  assert.equal(config.mailTransport, 'smtp');
  assert.equal(config.smtpRequireTls, true);
  assert.equal(config.smtpPort, 587);
});

test('продакшен отказывается от SMTP без TLS', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.provider.test', INONE_SMTP_FROM: 'InOne <noreply@inone.example>', INONE_SMTP_REQUIRE_TLS: 'false' }), /must require TLS/);
});

test('SMTP без адреса отправителя не запускается', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://db.example/inone', INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.provider.test' }), /INONE_SMTP_FROM is required/);
});

test('продакшен без INONE_FILES_DIR не стартует: файлы в памяти пропадут при перезапуске', () => {
  const PROD = { ...GOOD, INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.provider.test', INONE_SMTP_FROM: 'InOne <noreply@inone.example>' };
  assert.throws(() => loadConfig({ ...PROD, INONE_FILES_DIR: '' }), /INONE_FILES_DIR/);
  const ok = loadConfig({ ...PROD, INONE_FILES_DIR: '/var/lib/inone/objects' });
  assert.equal(ok.filesDir, '/var/lib/inone/objects');
  assert.equal(ok.fileQuotaBytes, null, 'квота не задана по умолчанию');
  assert.equal(loadConfig({ ...PROD, INONE_FILES_DIR: '/x', INONE_FILE_QUOTA_BYTES: '1000' }).fileQuotaBytes, 1000);
});

test('SMTP rejects invalid transport, mismatched credentials and invalid encryption keys', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'sendgrid' }), /must be memory or smtp/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.example', INONE_SMTP_FROM: 'noreply@example.test', INONE_SMTP_USER: 'mailer' }), /must be configured together/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.example', INONE_SMTP_FROM: 'noreply@example.test', INONE_EMAIL_ENCRYPTION_KEY: 'short' }), /must be 32 bytes/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.example', INONE_SMTP_FROM: 'noreply@example.test', INONE_SMTP_PORT: '465' }), /requires INONE_SMTP_SECURE/);
});

test('SMTP rejects non-canonical base64 encryption keys even when Buffer.from would decode bytes', () => {
  const malformed = `${'A'.repeat(43)}!`;
  assert.equal(Buffer.from(malformed, 'base64').length, 32);
  assert.throws(() => loadConfig({
    ...GOOD,
    INONE_MAIL_TRANSPORT: 'smtp',
    INONE_SMTP_HOST: 'smtp.example',
    INONE_SMTP_FROM: 'noreply@example.test',
    INONE_EMAIL_ENCRYPTION_KEY: malformed,
  }), /canonical base64/);
});

test('SMTP rejects non-canonical base64 padding and reports the encryption-key error once', () => {
  const canonical = randomBytes(32).toString('base64');
  const invalidKeys = [canonical.slice(0, -1), canonical + '='];
  for (const key of invalidKeys) {
    assert.throws(() => loadConfig({
      ...GOOD,
      INONE_MAIL_TRANSPORT: 'smtp',
      INONE_SMTP_HOST: 'smtp.example',
      INONE_SMTP_FROM: 'noreply@example.test',
      INONE_EMAIL_ENCRYPTION_KEY: key,
    }), (error) => {
      assert.equal((error.message.match(/INONE_EMAIL_ENCRYPTION_KEY/g) ?? []).length, 1);
      assert.match(error.message, /canonical base64/);
      return true;
    });
  }
});


test('продакшен запрещает фиксированный код подтверждения почты и тестовый UI', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_DEV_EMAIL_CODE: '123456' }), /INONE_DEV_EMAIL_CODE is not allowed in production/);
  assert.throws(() => loadConfig({ ...GOOD, INONE_TEST_UI: '1' }), /INONE_TEST_UI must not be set in production/);
});

test('продакшен требует корректный ключ шифрования push', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_PUSH_ENCRYPTION_KEY: 'development-key' }), /INONE_PUSH_ENCRYPTION_KEY must be 32 bytes/);
});
