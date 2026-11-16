import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { renderEmailTemplate } from './email-templates.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;
const LEASE_MS = 60_000;
const SEND_GUARD_MS = 15_000;
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
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('INONE_EMAIL_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

function deriveSubkey(masterKey, purpose) {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('inone-email-delivery-v1'), Buffer.from(purpose), 32));
}

function encryptPayload(payload, payloadKey, idempotencyHash) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', payloadKey, iv);
  cipher.setAAD(Buffer.from(idempotencyHash, 'hex'));
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  try {
    if (plain.length > MAX_PAYLOAD_BYTES) throw new Error('email payload exceeds size limit');
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  } finally {
    plain.fill(0);
  }
}

function decryptPayload(row, payloadKey) {
  const decipher = createDecipheriv('aes-256-gcm', payloadKey, row.payload_iv);
  decipher.setAAD(Buffer.from(row.idempotency_key, 'hex'));
  decipher.setAuthTag(row.payload_tag);
  const plain = Buffer.concat([decipher.update(row.payload_ciphertext), decipher.final()]);
  try {
    const payload = JSON.parse(plain.toString('utf8'));
    if (!payload || typeof payload.to !== 'string' || typeof payload.subject !== 'string' || typeof payload.text !== 'string' || typeof payload.html !== 'string') {
      throw new Error('invalid encrypted email payload');
    }
    return payload;
  } finally {
    plain.fill(0);
  }
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
  leaseMs = LEASE_MS, leaseRenewIntervalMs = Math.max(100, Math.floor(leaseMs / 3)),
} = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('email delivery requires a PostgreSQL pool');
  if (!smtpMailer || typeof smtpMailer.send !== 'function') throw new Error('email delivery requires an SMTP sender');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('email batchSize must be 1..100');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('email maxAttempts must be 1..20');
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) throw new Error('email pollIntervalMs must be 250..60000');
  if (!Number.isInteger(leaseMs) || leaseMs < 300 || leaseMs > 24 * 60 * 60_000) throw new Error('email leaseMs must be 300..86400000');
  if (!Number.isInteger(leaseRenewIntervalMs) || leaseRenewIntervalMs < 100 || leaseRenewIntervalMs >= leaseMs / 2) throw new Error('email leaseRenewIntervalMs must be >= 100 and less than half the lease');
  if (!Number.isInteger(retryBaseMs) || retryBaseMs < 100 || retryBaseMs > 60_000) throw new Error('email retryBaseMs must be 100..60000');
  if (!Number.isInteger(retryMaxMs) || retryMaxMs < retryBaseMs || retryMaxMs > 24 * 60 * 60_000) throw new Error('email retryMaxMs must be >= retryBaseMs and <= 24h');
  const masterKey = Buffer.isBuffer(encryptionKey) ? Buffer.from(encryptionKey) : parseEmailEncryptionKey(encryptionKey);
  if (masterKey.length !== 32) {
    masterKey.fill(0);
    throw new Error('email encryption key must be 32 bytes');
  }
  const payloadKey = deriveSubkey(masterKey, 'payload-encryption');
  const fingerprintKey = deriveSubkey(masterKey, 'payload-fingerprint');
  const idempotencyKeyHashKey = deriveSubkey(masterKey, 'idempotency-key-hash');

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
           WHERE (status = 'queued' AND available_at <= now() AND expires_at > now() + ($4::double precision * interval '1 millisecond'))
              OR (status = 'processing' AND locked_at < now() - ($2::double precision * interval '1 millisecond') AND expires_at > now() + ($4::double precision * interval '1 millisecond'))
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
        [batchSize, leaseMs, workerId, SEND_GUARD_MS],
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

  async function renewClaim(row) {
    const { rows } = await pool.query(
      `UPDATE email_deliveries
       SET locked_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'processing' AND locked_by = $2
         AND locked_at >= now() - ($3::double precision * interval '1 millisecond')
         AND expires_at > now() + ($4::double precision * interval '1 millisecond')
       RETURNING id`,
      [row.id, workerId, leaseMs, SEND_GUARD_MS],
    );
    return rows.length === 1;
  }

  async function releaseClaim(row) {
    await pool.query(
      `UPDATE email_deliveries
       SET status = 'queued', available_at = now(), locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
      [row.id, workerId],
    );
  }

  async function updateSent(row, messageId) {
    const result = await pool.query(
      `UPDATE email_deliveries
       SET status = 'sent', provider_message_id = $2, sent_at = now(),
           locked_at = NULL, locked_by = NULL, last_error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'processing' AND locked_by = $3`,
      [row.id, messageId ?? null, workerId],
    );
    return result.rowCount === 1;
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
      await pool.query("UPDATE email_deliveries SET status = 'dead', last_error_code = 'expired', updated_at = now() WHERE status = 'queued' AND expires_at <= now() + interval '15 seconds'");
      await pool.query(
        `UPDATE email_deliveries SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error_code = 'expired', updated_at = now()
         WHERE status = 'processing' AND expires_at <= now() + interval '15 seconds'
           AND locked_at < now() - ($1::double precision * interval '1 millisecond')`,
        [leaseMs],
      );
      await pool.query("DELETE FROM email_deliveries WHERE status IN ('sent', 'dead') AND updated_at < now() - interval '30 days'");
      lastCleanupAt = Date.now();
    }
    const rows = await claimBatch();
    for (const row of rows) {
      if (stopping) {
        await releaseClaim(row);
        continue;
      }
      if (!(await renewClaim(row))) {
        logger?.warn('email delivery lease lost before send', { deliveryId: row.id });
        continue;
      }
      if (new Date(row.expires_at).getTime() <= Date.now() + SEND_GUARD_MS) {
        await pool.query("UPDATE email_deliveries SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error_code = 'expired', updated_at = now() WHERE id = $1 AND status = 'processing' AND locked_by = $2", [row.id, workerId]);
        continue;
      }
      let message;
      try {
        message = decryptPayload(row, payloadKey);
      } catch {
        await pool.query(
          `UPDATE email_deliveries SET status = 'dead', locked_at = NULL, locked_by = NULL,
            last_error_code = 'payload_integrity', updated_at = now()
           WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
          [row.id, workerId],
        );
        logger?.error('email payload rejected', { deliveryId: row.id, reason: 'payload_integrity' });
        continue;
      }
      let leaseLost = false;
      let renewalInFlight = null;
      const renewLease = () => {
        if (renewalInFlight) return renewalInFlight;
        renewalInFlight = renewClaim(row)
          .then((owned) => { if (!owned) leaseLost = true; })
          .catch((error) => {
            logger?.warn('email delivery lease renewal failed', {
              deliveryId: row.id,
              errorCode: typeof error?.code === 'string' ? error.code : 'unknown',
            });
          })
          .finally(() => { renewalInFlight = null; });
        return renewalInFlight;
      };
      const leaseTimer = setInterval(renewLease, leaseRenewIntervalMs);
      leaseTimer.unref?.();
      try {
        const result = await smtpMailer.send(message);
        if (renewalInFlight) await renewalInFlight;
        if (leaseLost) {
          logger?.warn('email delivery lease lost during SMTP send', { deliveryId: row.id });
          continue;
        }
        const markedSent = await updateSent(row, result?.messageId ?? null);
        if (markedSent) logger?.info('email delivery sent', { deliveryId: row.id, attempts: row.attempts });
        else logger?.warn('email sent after delivery lease was lost', { deliveryId: row.id });
      } catch (error) {
        if (leaseLost) logger?.warn('SMTP result ignored after delivery lease loss', { deliveryId: row.id });
        else await updateFailure(row, error);
      } finally {
        clearInterval(leaseTimer);
        if (renewalInFlight) await renewalInFlight;
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

  async function queueQuery(queryable, sql, params) {
    try { return await queryable.query(sql, params); }
    catch {
      const error = new Error('email queue temporarily unavailable');
      error.code = 'EMAIL_QUEUE_UNAVAILABLE';
      throw error;
    }
  }

  async function enqueue(queryable, { to, subject, text, html, idempotencyKey, templateId, variables, locale, expiresAt }) {
    if (stopping) throw new Error('email delivery is stopping');
    if (typeof to !== 'string' || to.length < 3 || to.length > 320 || /[\r\n]/.test(to)) throw new Error('invalid email recipient');
    if (typeof templateId !== 'string' || templateId.length === 0) throw new Error('email templateId is required');
    if (locale === undefined) throw new Error('email locale is required');
    const rendered = renderEmailTemplate(templateId, variables ?? {}, locale);
    if (typeof rendered.subject !== 'string' || rendered.subject.length < 1 || rendered.subject.length > 998 || /[\r\n]/.test(rendered.subject)) throw new Error('invalid email subject');
    if (typeof rendered.text !== 'string' || rendered.text.length > MAX_PAYLOAD_BYTES) throw new Error('invalid email body');
    if (typeof rendered.html !== 'string' || rendered.html.length > 128 * 1024) throw new Error('invalid email HTML body');
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 256) throw new Error('email idempotencyKey is required');
    const nowMs = Date.now();
    const expiryMs = expiresAt === undefined ? nowMs + rendered.ttlMs : Number(expiresAt);
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs || expiryMs > nowMs + 30 * 24 * 60 * 60_000) throw new Error('invalid email expiry');
    const idempotencyHash = createHmac('sha256', idempotencyKeyHashKey).update(idempotencyKey).digest('hex');
    const payload = {
      to, subject: rendered.subject, text: rendered.text, html: rendered.html,
      templateId: templateId ?? 'legacy', templateVersion: rendered.templateVersion ?? 1, locale: rendered.locale ?? locale,
    };
    const fingerprint = createHmac('sha256', fingerprintKey).update(JSON.stringify(payload)).digest('hex');
    const encrypted = encryptPayload(payload, payloadKey, idempotencyHash);
    const { rows } = await queueQuery(queryable,
      `INSERT INTO email_deliveries
         (idempotency_key, payload_fingerprint, payload_ciphertext, payload_iv, payload_tag, expires_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, status`,
      [idempotencyHash, fingerprint, encrypted.ciphertext, encrypted.iv, encrypted.tag, expiryMs],
    );
    if (rows[0]) return { queued: true, duplicate: false, deliveryId: rows[0].id };
    const existing = await queueQuery(queryable, 'SELECT id, status, payload_fingerprint FROM email_deliveries WHERE idempotency_key = $1', [idempotencyHash]);
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
      try { smtpMailer.close?.(); } catch { /* transport close is best-effort during shutdown */ }
      if (activeTick) await activeTick;
      masterKey.fill(0);
      payloadKey.fill(0);
      fingerprintKey.fill(0);
      idempotencyKeyHashKey.fill(0);
    },
    async stats() {
      const { rows } = await pool.query(
        `SELECT status, count(*)::bigint AS count FROM email_deliveries GROUP BY status`,
      );
      return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    },
  };
}
