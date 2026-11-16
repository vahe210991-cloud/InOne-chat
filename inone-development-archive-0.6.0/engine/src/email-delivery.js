import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { renderEmailTemplate } from './email-templates.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;
const LEASE_MS = 60_000;
const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60 * 60_000;

export function parseEmailEncryptionKey(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('INONE_EMAIL_ENCRYPTION_KEY is required');
  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    const decoded = Buffer.from(value, 'base64');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
      throw new Error('INONE_EMAIL_ENCRYPTION_KEY must be valid base64');
    }
    key = decoded;
  }
  if (key.length !== 32) throw new Error('INONE_EMAIL_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

function deriveSubkey(masterKey, purpose) {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('inone-email-delivery-v1'), Buffer.from(purpose), 32));
}

function encryptPayload(payload, payloadKey, idempotencyHash) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(idempotencyHash, 'hex'));
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plain.length > MAX_PAYLOAD_BYTES) throw new Error('email payload exceeds size limit');
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptPayload(row, payloadKey) {
  const decipher = createDecipheriv('aes-256-gcm', key, row.payload_iv);
  decipher.setAAD(Buffer.from(row.idempotency_key, 'hex'));
  decipher.setAuthTag(row.payload_tag);
  const plain = Buffer.concat([decipher.update(row.payload_ciphertext), decipher.final()]);
  const payload = JSON.parse(plain.toString('utf8'));
  if (!payload || typeof payload.to !== 'string' || typeof payload.subject !== 'string' || typeof payload.text !== 'string') {
    throw new Error('invalid encrypted email payload');
  }
  return payload;
}

function retryDelay(attempt, baseMs, maxMs) {
  const ceiling = Math.min(maxMs, baseMs * (2 ** Math.min(attempt - 1, 16)));
  return randomInt(Math.max(1, Math.floor(ceiling / 2)), ceiling + 1);
}

function errorClass(error) {
  const reason = typeof error?.reason === 'string' ? error.reason : '';
  if (reason === 'auth' || reason === 'envelope') return 'permanent';
  if (reason === 'connection') return 'transient';
  return 'transient';
}

export function createEmailDelivery({
  pool, smtpMailer, encryptionKey, logger = null, workerId = randomBytes(12).toString('hex'),
  pollIntervalMs = 1_000, batchSize = 10, maxAttempts = 8, retryBaseMs = BASE_RETRY_MS, retryMaxMs = MAX_RETRY_MS,
} = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('email delivery requires a PostgreSQL pool');
  if (!smtpMailer || typeof smtpMailer.send !== 'function') throw new Error('email delivery requires an SMTP sender');
  const masterKey = Buffer.isBuffer(encryptionKey) ? Buffer.from(encryptionKey) : parseEmailEncryptionKey(encryptionKey);
  if (masterKey.length !== 32) throw new Error('email encryption key must be 32 bytes');
  const payloadKey = deriveSubkey(masterKey, 'payload-encryption');
  const fingerprintKey = deriveSubkey(masterKey, 'payload-fingerprint');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('email batchSize must be 1..100');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('email maxAttempts must be 1..20');
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) throw new Error('email pollIntervalMs must be 250..60000');
  if (!Number.isInteger(retryBaseMs) || retryBaseMs < 100 || retryBaseMs > 60_000) throw new Error('email retryBaseMs must be 100..60000');
  if (!Number.isInteger(retryMaxMs) || retryMaxMs < retryBaseMs || retryMaxMs > 24 * 60 * 60_000) throw new Error('email retryMaxMs must be >= retryBaseMs and <= 24h');

  let timer = null;
  let activeTick = null;
  let stopping = false;
  let lastCleanupAt = 0;

  async function claimBatch() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `WITH candidates AS (
           SELECT id FROM email_deliveries
           WHERE (status = 'queued' AND available_at <= now() AND expires_at > now())
              OR (status = 'processing' AND locked_at < now() - ($2::double precision * interval '1 millisecond') AND expires_at > now())
           ORDER BY available_at, id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE email_deliveries AS e
         SET status = 'processing', attempts = e.attempts + 1,
             locked_at = now(), locked_by = $3, updated_at = now()
         FROM candidates
         WHERE e.id = candidates.id
         RETURNING e.id, e.idempotency_key, e.payload_ciphertext, e.payload_iv, e.payload_tag, e.attempts, e.expires_at`,
        [batchSize, LEASE_MS, workerId],
      );
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateSent(row, messageId) {
    await pool.query(
      `UPDATE email_deliveries
       SET status = 'sent', provider_message_id = $2, sent_at = now(),
           locked_at = NULL, locked_by = NULL, last_error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'processing' AND locked_by = $3`,
      [row.id, messageId ?? null, workerId],
    );
  }

  async function updateFailure(row, error) {
    const classification = errorClass(error);
    const permanent = classification === 'permanent' || row.attempts >= maxAttempts;
    const safeCode = ['auth', 'connection', 'envelope'].includes(error?.reason) ? error.reason : 'transport_error';
    if (permanent) {
      await pool.query(
        `UPDATE email_deliveries
         SET status = 'dead', locked_at = NULL, locked_by = NULL,
             last_error_code = $2, updated_at = now()
         WHERE id = $1 AND status = 'processing' AND locked_by = $3`,
        [row.id, safeCode, workerId],
      );
      logger?.error('email delivery dead-lettered', { deliveryId: row.id, reason: safeCode, attempts: row.attempts });
      return;
    }
    const delay = retryDelay(row.attempts, retryBaseMs, retryMaxMs);
    await pool.query(
      `UPDATE email_deliveries
       SET status = 'queued', available_at = now() + ($2::double precision * interval '1 millisecond'),
           locked_at = NULL, locked_by = NULL, last_error_code = $3, updated_at = now()
       WHERE id = $1 AND status = 'processing' AND locked_by = $4`,
      [row.id, delay, safeCode, workerId],
    );
    logger?.warn('email delivery retry scheduled', { deliveryId: row.id, reason: safeCode, attempts: row.attempts, retryInMs: delay });
  }

  async function tick() {
    if (stopping) return;
    if (Date.now() - lastCleanupAt > 60 * 60_000) {
      await pool.query("UPDATE email_deliveries SET status = 'dead', last_error_code = 'expired', updated_at = now() WHERE status = 'queued' AND expires_at <= now()");
      await pool.query("UPDATE email_deliveries SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error_code = 'expired', updated_at = now() WHERE status = 'processing' AND expires_at <= now() AND locked_at < now() - interval '60 seconds'");
      await pool.query("DELETE FROM email_deliveries WHERE status IN ('sent', 'dead') AND updated_at < now() - interval '30 days'");
      lastCleanupAt = Date.now();
    }
    const rows = await claimBatch();
    for (const row of rows) {
      try {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          await pool.query("UPDATE email_deliveries SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error_code = 'expired', updated_at = now() WHERE id = $1 AND status = 'processing' AND locked_by = $2", [row.id, workerId]);
          continue;
        }
        const message = decryptPayload(row, key);
        const result = await smtpMailer.send(message);
        await updateSent(row, result?.messageId ?? null);
        logger?.info('email delivery sent', { deliveryId: row.id, attempts: row.attempts });
      } catch (error) {
        if (error?.message === 'Unsupported state or unable to authenticate data' || error instanceof SyntaxError) {
          await pool.query(
            `UPDATE email_deliveries SET status = 'dead', locked_at = NULL, locked_by = NULL,
              last_error_code = 'payload_integrity', updated_at = now()
             WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
            [row.id, workerId],
          );
          logger?.error('email payload rejected', { deliveryId: row.id, reason: 'payload_integrity' });
        } else {
          await updateFailure(row, error);
        }
      }
    }
  }

  function scheduleTick() {
    if (stopping || activeTick) return activeTick;
    activeTick = tick().catch((error) => {
      logger?.error('email queue worker failed', { reason: 'queue_error', errorCode: typeof error?.code === 'string' ? error.code : 'unknown' });
    }).finally(() => { activeTick = null; });
    return activeTick;
  }

  async function enqueue(queryable, { to, subject, text, idempotencyKey, templateId, variables, locale = 'ru', expiresAt }) {
    if (stopping) throw new Error('email delivery is stopping');
    if (typeof to !== 'string' || to.length < 3 || to.length > 320 || /[\\r\\n]/.test(to)) throw new Error('invalid email recipient');
    const rendered = templateId ? renderEmailTemplate(templateId, variables ?? {}, locale) : { subject, text, ttlMs: 24 * 60 * 60_000 };
    if (typeof rendered.subject !== 'string' || rendered.subject.length < 1 || rendered.subject.length > 998 || /[\\r\\n]/.test(rendered.subject)) throw new Error('invalid email subject');
    if (typeof rendered.text !== 'string' || rendered.text.length > MAX_PAYLOAD_BYTES) throw new Error('invalid email body');
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 256) throw new Error('email idempotencyKey is required');
    const nowMs = Date.now();
    const expiryMs = expiresAt === undefined ? nowMs + rendered.ttlMs : Number(expiresAt);
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs || expiryMs > nowMs + 30 * 24 * 60 * 60_000) throw new Error('invalid email expiry');
    const idempotencyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    const payload = {
      to, subject: rendered.subject, text: rendered.text,
      templateId: templateId ?? 'legacy', templateVersion: rendered.templateVersion ?? 1, locale: rendered.locale ?? locale,
    };
    const fingerprint = createHmac('sha256', fingerprintKey).update(JSON.stringify(payload)).digest('hex');
    const encrypted = encryptPayload(payload, key, idempotencyHash);
    const { rows } = await queryable.query(
      `INSERT INTO email_deliveries
         (idempotency_key, payload_fingerprint, payload_ciphertext, payload_iv, payload_tag, expires_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, status`,
      [idempotencyHash, fingerprint, encrypted.ciphertext, encrypted.iv, encrypted.tag, expiryMs],
    );
    if (rows[0]) return { queued: true, duplicate: false, deliveryId: rows[0].id };
    const existing = await queryable.query('SELECT id, status, payload_fingerprint FROM email_deliveries WHERE idempotency_key = $1', [idempotencyHash]);
    if (!existing.rows[0]) throw new Error('email idempotency conflict could not be resolved');
    const expected = Buffer.from(existing.rows[0].payload_fingerprint, 'hex');
    const actual = Buffer.from(fingerprint, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('email idempotency key was reused with a different payload');
    return { queued: existing.rows[0].status !== 'dead', duplicate: true, deliveryId: existing.rows[0].id, status: existing.rows[0].status };
  }

  return {
    send(message) {
      return enqueue(pool, message);
    },
    sendInTransaction(client, message) {
      if (!client || typeof client.query !== 'function') throw new Error('transaction client is required');
      return enqueue(client, message);
    },
    start() {
      if (stopping) throw new Error('email delivery cannot restart after stop');
      if (timer) return;
      timer = setInterval(scheduleTick, pollIntervalMs);
      timer.unref?.();
      scheduleTick();
    },
    async stop() {
      if (stopping) {
        if (activeTick) await activeTick;
        return;
      }
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (activeTick) await activeTick;
      smtpMailer.close?.();
      masterKey.fill(0);
      payloadKey.fill(0);
      fingerprintKey.fill(0);
    },
    async stats() {
      const { rows } = await pool.query(
        `SELECT status, count(*)::bigint AS count FROM email_deliveries GROUP BY status`,
      );
      return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    },
  };
}
