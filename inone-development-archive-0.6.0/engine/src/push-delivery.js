import { randomBytes, randomInt } from 'node:crypto';
import {
  decryptPushFid, decryptPushPayload, encryptPushFid, encryptPushPayload, encryptPushRegistrationId, parsePushEncryptionKey, pushIdempotencyHash,
} from './push-crypto.js';

const LEASE_MS = 120_000;
const SEND_GUARD_MS = 15_000;
const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60 * 60_000;
const DELIVERY_TTL_MS = 7 * 24 * 60 * 60_000;

function retryDelay(attempt) {
  const ceiling = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.min(attempt - 1, 16)));
  return randomInt(Math.max(1, Math.floor(ceiling / 2)), ceiling + 1);
}

export function createPushDelivery({
  pool, sender, encryptionKey, logger = null, workerId = randomBytes(12).toString('hex'),
  pollIntervalMs = 1_000, batchSize = 20, maxAttempts = 8,
  leaseMs = LEASE_MS, leaseRenewIntervalMs = Math.max(500, Math.floor(leaseMs / 3)),
} = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('push delivery requires a PostgreSQL pool');
  if (!sender || typeof sender.send !== 'function') throw new Error('push delivery requires an FCM sender');
  const masterKey = Buffer.isBuffer(encryptionKey) ? Buffer.from(encryptionKey) : parsePushEncryptionKey(encryptionKey);
  if (masterKey.length !== 32) throw new Error('push encryption key must be 32 bytes');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('push batchSize must be 1..100');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('push maxAttempts must be 1..20');
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) throw new Error('push pollIntervalMs must be 250..60000');
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000) throw new Error('push leaseMs must be 1000..86400000');
  if (!Number.isInteger(leaseRenewIntervalMs) || leaseRenewIntervalMs < 100 || leaseRenewIntervalMs >= leaseMs / 2) throw new Error('push lease renewal interval is invalid');

  let timer = null;
  let activeTick = null;
  let stopping = false;
  let lastCleanupAt = 0;

  function encryptRegistrationId(fid, deviceKey) {
    return encryptPushFid(fid, deviceKey, masterKey);
  }

  async function backfillLegacyRegistrations() {
    const client = await pool.connect();
    let migrated = 0;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT device_key, provider, token FROM push_tokens WHERE token IS NOT NULL ORDER BY device_key FOR UPDATE',
      );
      for (const row of rows) {
        const isFid = row.provider === 'fcm' && /^[A-Za-z0-9_-]{22}$/.test(row.token);
        const encrypted = isFid
          ? encryptPushFid(row.token, row.device_key, masterKey)
          : encryptPushRegistrationId(row.token, row.device_key, masterKey, 'legacy');
        await client.query(
          `UPDATE push_tokens
           SET token = NULL, token_ciphertext = $2, token_iv = $3, token_tag = $4, identifier_kind = $5
           WHERE device_key = $1 AND token IS NOT NULL`,
          [row.device_key, encrypted.tokenCiphertext, encrypted.tokenIv, encrypted.tokenTag, isFid ? 'fid' : 'legacy'],
        );
        migrated += 1;
      }
      const remaining = await client.query('SELECT count(*)::int AS count FROM push_tokens WHERE token IS NOT NULL');
      if (remaining.rows[0].count !== 0) throw new Error('legacy push registration backfill incomplete');
      await client.query('COMMIT');
      if (migrated) logger?.info('legacy push registrations encrypted', { count: migrated });
      return { migrated };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function enqueueRoomEvent(client, { roomId, eventId, excludeDeviceKey }) {
    if (stopping) throw new Error('push delivery is stopping');
    if (!client || typeof client.query !== 'function') throw new Error('push outbox requires the event transaction client');
    const { rows } = await client.query(
      `SELECT p.device_key
       FROM push_tokens p
       JOIN devices d ON d.device_key = p.device_key
       JOIN room_members m ON m.user_id = d.user_id
       WHERE m.room_id = $1 AND d.revoked = FALSE AND p.device_key <> $2
         AND p.provider = 'fcm' AND p.identifier_kind = 'fid'
         AND p.token_ciphertext IS NOT NULL`,
      [roomId, excludeDeviceKey],
    );
    const path = `/rooms/${encodeURIComponent(roomId)}/events/${encodeURIComponent(eventId)}`;
    let queued = 0;
    for (const target of rows) {
      const idempotencyKey = pushIdempotencyHash(masterKey, roomId, eventId, target.device_key);
      const encrypted = encryptPushPayload({ type: 'message', event_id: eventId, path }, idempotencyKey, masterKey);
      const result = await client.query(
        `INSERT INTO push_deliveries
           (idempotency_key, device_key, payload_ciphertext, payload_iv, payload_tag, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + ($6::double precision * interval '1 millisecond'))
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [idempotencyKey, target.device_key, encrypted.payloadCiphertext, encrypted.payloadIv, encrypted.payloadTag, DELIVERY_TTL_MS],
      );
      queued += result.rowCount;
    }
    return { queued };
  }

  async function claimBatch() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `WITH candidates AS (
           SELECT id FROM push_deliveries
           WHERE ((status IN ('queued', 'failed') AND available_at <= now())
              OR (status = 'processing' AND locked_at < now() - ($2::double precision * interval '1 millisecond')))
             AND expires_at > now() + ($4::double precision * interval '1 millisecond')
           ORDER BY available_at, id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE push_deliveries AS p
         SET status = 'processing', attempts = p.attempts + 1,
             locked_at = now(), locked_by = $3, updated_at = now()
         FROM candidates
         WHERE p.id = candidates.id
         RETURNING p.id, p.idempotency_key, p.device_key, p.payload_ciphertext, p.payload_iv, p.payload_tag, p.attempts, p.expires_at`,
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
      `UPDATE push_deliveries SET locked_at = now(), updated_at = now()
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
      `UPDATE push_deliveries SET status = 'queued', attempts = GREATEST(attempts - 1, 0),
       available_at = now(), locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
      [row.id, workerId],
    );
  }

  async function finish(row, status, { messageId = null, errorCode = null, delayMs = null } = {}) {
    await pool.query(
      `UPDATE push_deliveries
       SET status = $2,
           provider_message_id = COALESCE($3, provider_message_id),
           last_error_code = $4,
           available_at = CASE WHEN $5::double precision IS NULL THEN available_at
             ELSE now() + ($5::double precision * interval '1 millisecond') END,
           locked_at = NULL, locked_by = NULL,
           provider_accepted_at = CASE WHEN $2 = 'provider_accepted' THEN now() ELSE provider_accepted_at END,
           updated_at = now()
       WHERE id = $1 AND status = 'processing' AND locked_by = $6`,
      [row.id, status, messageId, errorCode, delayMs, workerId],
    );
  }

  async function currentRegistration(deviceKey) {
    const { rows } = await pool.query(
      `SELECT p.device_key, p.token_ciphertext, p.token_iv, p.token_tag
       FROM push_tokens p JOIN devices d ON d.device_key = p.device_key
       WHERE p.device_key = $1 AND d.revoked = FALSE
         AND p.provider = 'fcm' AND p.identifier_kind = 'fid'`,
      [deviceKey],
    );
    return rows[0] ?? null;
  }

  async function processRow(row) {
    if (!(await renewClaim(row))) {
      logger?.warn('push delivery lease lost before send', { deliveryId: row.id });
      return;
    }
    if (new Date(row.expires_at).getTime() <= Date.now() + SEND_GUARD_MS) {
      await finish(row, 'dead', { errorCode: 'expired' });
      return;
    }

    let payload;
    try {
      payload = decryptPushPayload(row, masterKey);
    } catch {
      await finish(row, 'dead', { errorCode: 'payload_integrity' });
      logger?.error('push payload rejected', { deliveryId: row.id, reason: 'payload_integrity' });
      return;
    }

    const registration = await currentRegistration(row.device_key);
    if (!registration) {
      await finish(row, 'cancelled', { errorCode: 'registration_missing' });
      return;
    }

    let fid;
    try {
      fid = decryptPushFid(registration, row.device_key, masterKey);
    } catch {
      await finish(row, 'dead', { errorCode: 'registration_integrity' });
      logger?.error('push registration rejected', { deliveryId: row.id, reason: 'registration_integrity' });
      return;
    }

    let leaseLost = false;
    let renewal = null;
    const renew = () => {
      if (renewal) return renewal;
      renewal = renewClaim(row).then((valid) => { if (!valid) leaseLost = true; })
        .catch(() => { leaseLost = true; }).finally(() => { renewal = null; });
      return renewal;
    };
    const renewalTimer = setInterval(renew, leaseRenewIntervalMs);
    renewalTimer.unref?.();
    try {
      const result = await sender.send({ fid, payload });
      if (leaseLost) return;
      await finish(row, 'provider_accepted', { messageId: result.messageId });
      logger?.info('push provider accepted delivery', { deliveryId: row.id, attempts: row.attempts });
    } catch (error) {
      if (leaseLost) return;
      const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,48}$/.test(error.code) ? error.code : 'provider_unknown';
      if (code === 'invalid_target') {
        await pool.query(
          'DELETE FROM push_tokens WHERE device_key = $1 AND token_ciphertext = $2',
          [row.device_key, registration.token_ciphertext],
        );
        await pool.query(
          `UPDATE push_deliveries SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
           last_error_code = 'invalid_target', updated_at = now()
           WHERE device_key = $1 AND status IN ('queued', 'failed')`,
          [row.device_key],
        );
        await finish(row, 'cancelled', { errorCode: 'invalid_target' });
        logger?.warn('invalid FCM installation removed', { deliveryId: row.id });
      } else if (error?.retryable === false) {
        await finish(row, 'dead', { errorCode: code });
        logger?.warn('push delivery permanently rejected', { deliveryId: row.id, reason: code });
      } else if (row.attempts >= maxAttempts) {
        await finish(row, 'dead', { errorCode: code });
        logger?.warn('push delivery exhausted retries', { deliveryId: row.id, reason: code, attempts: row.attempts });
      } else {
        const delayMs = retryDelay(row.attempts);
        await finish(row, 'failed', { errorCode: code, delayMs });
        logger?.warn('push delivery retry scheduled', { deliveryId: row.id, reason: code, attempts: row.attempts, retryInMs: delayMs });
      }
    } finally {
      clearInterval(renewalTimer);
    }
  }

  async function tick() {
    if (stopping) return;
    if (Date.now() - lastCleanupAt > 60 * 60_000) {
      await pool.query(
        `UPDATE push_deliveries SET status = 'dead', locked_at = NULL, locked_by = NULL,
         last_error_code = 'expired', updated_at = now()
         WHERE status IN ('queued', 'failed') AND expires_at <= now() + interval '15 seconds'`,
      );
      await pool.query("DELETE FROM push_deliveries WHERE status IN ('provider_accepted', 'dead', 'cancelled') AND updated_at < now() - interval '30 days'");
      lastCleanupAt = Date.now();
    }
    const rows = await claimBatch();
    for (const row of rows) {
      if (stopping) {
        await releaseClaim(row);
        continue;
      }
      await processRow(row);
    }
  }

  function start() {
    if (timer || stopping) return;
    timer = setInterval(() => {
      if (activeTick) return;
      activeTick = tick()
        .catch((error) => logger?.error('push worker tick failed', { reason: 'worker_error' }))
        .finally(() => { activeTick = null; });
    }, pollIntervalMs);
    timer.unref?.();
  }

  async function stop() {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (activeTick) await activeTick;
    masterKey.fill(0);
  }

  return {
    encryptRegistrationId,
    backfillLegacyRegistrations,
    enqueueRoomEvent,
    start,
    stop,
    tick,
  };
}
