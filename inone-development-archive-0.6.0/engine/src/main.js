// Точка входа сервера: npm start. Настройки — из переменных окружения (см. .env.example).
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { migrate } from './migrate.js';
import { createStore } from './store.js';
import { createServer } from './server.js';
import { createSmtpMailer } from './mail-smtp.js';
import { createEmailDelivery } from './email-delivery.js';
import { createFirebaseAdminPushSender } from './firebase-admin-push.js';
import { createPushDelivery } from './push-delivery.js';

/** Запускает сервер. pool = null — память (только для тестов и разработки). */
export async function startServer({ config, logger = createLogger({ level: config.logLevel }), pool = null }) {
  let store;
  if (pool) {
    if (config.runMigrations) await migrate(pool, { logger });
    store = createStore({ pool, pinPepper: config.pinPepper });
  }
  const pushSender = config.firebaseProjectId && pool
    ? await createFirebaseAdminPushSender({
      projectId: config.firebaseProjectId,
      serviceAccountJson: config.firebaseServiceAccountJson,
    })
    : null;
  const pushDelivery = pushSender
    ? createPushDelivery({
      pool,
      sender: pushSender,
      encryptionKey: config.pushEncryptionKey,
      logger,
      pollIntervalMs: config.pushWorkerPollMs,
      maxAttempts: config.pushMaxAttempts,
    })
    : undefined;
  if (pushDelivery) await pushDelivery.backfillLegacyRegistrations();
  const smtpMailer = config.mailTransport === 'smtp'
    ? createSmtpMailer({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      requireTls: config.smtpRequireTls,
      user: config.smtpUser,
      password: config.smtpPassword,
      from: config.smtpFrom,
      logger,
    })
    : null;
  if (smtpMailer && !pool) throw new Error('SMTP email delivery requires PostgreSQL');
  const mailer = smtpMailer
    ? createEmailDelivery({
      pool,
      smtpMailer,
      encryptionKey: config.emailEncryptionKey,
      logger,
      pollIntervalMs: config.emailWorkerPollMs,
      maxAttempts: config.emailMaxAttempts,
    })
    : undefined;
  const app = createServer({
    pinPepper: config.pinPepper,
    docsSecret: config.docsSecret || null,
    testUi: config.testUi,
    store,
    trustProxy: config.trustProxy,
    filesDir: config.filesDir || null,
    quotaBytes: config.fileQuotaBytes ?? null,
    registrationMode: config.registrationMode,
    publicUrl: config.publicUrl,
    bodyLimit: config.bodyLimitBytes,
        requirePhone: config.requirePhone,
    mailer,
    pushDelivery,
    devEmailCode: config.devEmailCode,
        smsEnabled: config.smsEnabled,
        phoneBlockedCountries: config.phoneBlockedCountries,
    phoneAllowedCountries: config.phoneAllowedCountries,
    logger,
  });
  app.server.requestTimeout = config.requestTimeoutMs;
  app.server.headersTimeout = Math.min(config.requestTimeoutMs, 60000);
  let cleanupTimer = null;
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, () => {
      cleanupTimer = setInterval(() => {
        app.sweepExpired().catch(() => {});
      }, 10 * 60_000);
      cleanupTimer.unref();
      resolve();
    });
  });
  const port = app.server.address().port;
  mailer?.start?.();
  pushDelivery?.start?.();
  logger.info('server started', { port, environment: config.nodeEnv });
  if (config.devEmailCode) logger.warn('development email code is enabled: never use this in production', { environment: config.nodeEnv });
  let stopping = null;
  const stop = () => {
    stopping ??= (async () => {
      logger.info('shutting down');
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
      await new Promise((resolve) => app.server.close(resolve));
      await mailer?.stop?.();
      await pushDelivery?.stop?.();
      if (pool) await pool.end();
      logger.info('stopped');
    })();
    return stopping;
  };
  return { server: app.server, port, stop };
}

// Запуск: node src/main.js
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  const logger = createLogger({ level: config.logLevel });
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
  try {
    const app = await startServer({ config, logger, pool });
    const shutdown = () => app.stop().then(() => process.exit(0), (error) => {
      logger.error('shutdown failed', { error: error.message });
      process.exit(1);
    });
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('start failed', { error: error.message });
    await pool.end().catch(() => {});
    process.exit(1);
  }
}
