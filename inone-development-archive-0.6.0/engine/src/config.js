// Настройки сервера из переменных окружения. Неверная конфигурация останавливает запуск до открытия порта.
import { DEFAULT_PHONE_COUNTRIES } from './phone-international.js';
import { parseEmailEncryptionKey } from './email-delivery.js';
const TEST_PEPPER_MARKERS = ['test-pepper', 'change-me', 'example', 'dev-only'];

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  const config = {
    nodeEnv,
    production,
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? '',
    pinPepper: env.INONE_PIN_PEPPER ?? '',
    publicUrl: env.INONE_PUBLIC_URL ?? (production ? '' : 'http://localhost:8080'),
    registrationMode: env.INONE_REGISTRATION_MODE ?? 'verified',
    trustProxy: env.INONE_TRUST_PROXY === 'true',
    filesDir: env.INONE_FILES_DIR ?? '',
    docsSecret: env.INONE_DOCS_SECRET ?? '',
    testUi: env.INONE_TEST_UI === '1',
    fileQuotaBytes: env.INONE_FILE_QUOTA_BYTES ? Number(env.INONE_FILE_QUOTA_BYTES) : null,
    bodyLimitBytes: Number(env.INONE_BODY_LIMIT_BYTES ?? 4 * 1024 * 1024),
    requestTimeoutMs: Number(env.INONE_REQUEST_TIMEOUT_MS ?? 30000),
    logLevel: env.LOG_LEVEL ?? 'info',
    runMigrations: env.INONE_RUN_MIGRATIONS !== 'false',
    mailTransport: env.INONE_MAIL_TRANSPORT ?? 'memory',
    devEmailCode: env.INONE_DEV_EMAIL_CODE ?? '',
    smtpHost: env.INONE_SMTP_HOST ?? '',
    smtpPort: Number(env.INONE_SMTP_PORT ?? 587),
    smtpSecure: env.INONE_SMTP_SECURE === 'true',
    smtpRequireTls: env.INONE_SMTP_REQUIRE_TLS !== 'false',
    smtpUser: env.INONE_SMTP_USER ?? '',
    smtpPassword: env.INONE_SMTP_PASSWORD ?? '',
    smtpFrom: env.INONE_SMTP_FROM ?? '',
    emailEncryptionKey: env.INONE_EMAIL_ENCRYPTION_KEY ?? '',
    emailWorkerPollMs: Number(env.INONE_EMAIL_WORKER_POLL_MS ?? 1000),
    emailMaxAttempts: Number(env.INONE_EMAIL_MAX_ATTEMPTS ?? 8),
    requirePhone: env.INONE_REQUIRE_PHONE !== 'false',
    smsEnabled: env.INONE_SMS_ENABLED === 'true',
    phoneBlockedCountries: (env.INONE_PHONE_BLOCKED_COUNTRIES ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
    phoneAllowedCountries: (env.INONE_PHONE_ALLOWED_COUNTRIES ?? DEFAULT_PHONE_COUNTRIES.join(',')).split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
  };
  const errors = [];
  if (!config.databaseUrl) errors.push('DATABASE_URL is required');
  if (!['verified', 'open'].includes(config.registrationMode)) errors.push('INONE_REGISTRATION_MODE must be verified or open');
  if (!['memory', 'smtp'].includes(config.mailTransport)) errors.push('INONE_MAIL_TRANSPORT must be memory or smtp');
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) errors.push('PORT must be a port number');
  if (!Number.isInteger(config.bodyLimitBytes) || config.bodyLimitBytes < 1024) errors.push('INONE_BODY_LIMIT_BYTES must be at least 1024');
  if (production) {
    if (config.registrationMode === 'open') errors.push('open registration is not allowed in production');
    if (config.pinPepper.length < 32) errors.push('INONE_PIN_PEPPER must be at least 32 characters in production');
    if (TEST_PEPPER_MARKERS.some((m) => config.pinPepper.includes(m))) errors.push('INONE_PIN_PEPPER looks like a test or example value');
    if (!config.publicUrl.startsWith('https://')) errors.push('INONE_PUBLIC_URL must start with https:// in production');
    // Production требует SMTP transport и зашифрованную PostgreSQL queue; memory transport запрещён.
    if (config.mailTransport !== 'smtp') errors.push('production needs a real mail transport: set INONE_MAIL_TRANSPORT=smtp');
    if (config.mailTransport === 'smtp' && !config.smtpRequireTls) errors.push('production SMTP must require TLS (INONE_SMTP_REQUIRE_TLS)');
    if (!config.filesDir) errors.push('INONE_FILES_DIR is required in production: files kept in memory are lost on restart');
    if (config.docsSecret.length < 32) errors.push('INONE_DOCS_SECRET must be at least 32 characters in production');
    if (config.testUi) errors.push('INONE_TEST_UI must not be set in production');
  } else if (!config.pinPepper) {
    // Только для разработки: значение явно помечено и в продакшене не принимается.
    config.pinPepper = 'dev-only-pepper-do-not-use-in-production-000000';
  }
  if (config.devEmailCode) {
    // Фиксированный код подтверждения почты: только для разработки, в продакшене запрещён.
    if (production) errors.push('INONE_DEV_EMAIL_CODE is not allowed in production');
    if (!/^\d{6}$/.test(config.devEmailCode)) errors.push('INONE_DEV_EMAIL_CODE must be 6 digits');
  }
  if (config.mailTransport === 'smtp') {
    if (!config.smtpHost || [...config.smtpHost].some((ch) => ch <= ' ')) errors.push('INONE_SMTP_HOST is required and must not contain whitespace');
    if (!config.smtpFrom || config.smtpFrom.includes('\r') || config.smtpFrom.includes('\n') || config.smtpFrom.length > 320) errors.push('INONE_SMTP_FROM is required and must be a valid single-line address');
    if (!Number.isInteger(config.smtpPort) || config.smtpPort < 1 || config.smtpPort > 65535) errors.push('INONE_SMTP_PORT must be a port number');
    if (config.smtpSecure && config.smtpPort !== 465) errors.push('INONE_SMTP_SECURE=true requires port 465');
    if (!config.smtpSecure && config.smtpPort === 465) errors.push('port 465 requires INONE_SMTP_SECURE=true');
    if (!!config.smtpUser !== !!config.smtpPassword) errors.push('INONE_SMTP_USER and INONE_SMTP_PASSWORD must be configured together');
    if (!Number.isInteger(config.emailWorkerPollMs) || config.emailWorkerPollMs < 250 || config.emailWorkerPollMs > 60000) errors.push('INONE_EMAIL_WORKER_POLL_MS must be 250..60000');
    if (!Number.isInteger(config.emailMaxAttempts) || config.emailMaxAttempts < 1 || config.emailMaxAttempts > 20) errors.push('INONE_EMAIL_MAX_ATTEMPTS must be 1..20');
    try {
      parseEmailEncryptionKey(config.emailEncryptionKey);
    } catch {
      errors.push('INONE_EMAIL_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
    }
  }
  if (errors.length > 0) {
    const error = new Error(`invalid configuration: ${errors.join('; ')}`);
    error.code = 'CONFIG_INVALID';
    throw error;
  }
  return config;
}
