// ============================================================================
// Хранилище PoC на PostgreSQL (версия 0.6.0-alpha.1).
// Сервер пока работает в памяти; эти операции — фундамент порта маршрутов.
// Там, где возможна гонка, защита либо блокировка строки (PIN, одноразовые ключи),
// либо уникальный ключ (дедупликация отправок, одна запись на пользователя в очереди).
// Каждая защита проверяется тестами на реальной базе: test/db.test.js.
// ============================================================================
import { channelNameKey } from './room-names.js';
import { MLS_REGULAR_MAX_AGE_MS, MLS_LAST_RESORT_MAX_AGE_MS } from './mls-rules.js';
import { DEFAULT_ADMIN_CAPABILITIES, DEFAULT_MEMBER_CAPABILITIES } from './room-permissions.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { decideLogin } from './login-throttle.js';
import { freshRecovery } from './recovery-rules.js';
import { freshPhone } from './phone-rules.js';
import { applyHit } from './rate-limit.js';

const SEND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // повтор отправки с тем же номером отбрасывается 7 дней (C-05)

/** Ключевой хэш: без секретного перца значение из базы не проверить и не подобрать. */
const keyed = (pepper, label, value) => createHmac('sha256', pepper).update(`${label}|${value}`).digest('hex');

/** Сравнение хэшей в hex за постоянное время. */
const sameHex = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export function createStore({ pool, pinPepper, testHooks = {} }) {
  if (!pinPepper || pinPepper.length < 32) {
    throw new Error('PIN_PEPPER обязателен и не короче 32 символов');
  }

  /** Выполняет fn в одной транзакции: либо всё, либо ничего. */
  async function inTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Lock organization membership/link before the room_members row. Revocation uses the
  // same order (link -> room_members), so an in-flight write either commits before revoke
  // or observes the revoked relationship and is rejected.
  async function lockRoomWriteAccess(client, roomId, userId) {
    // Do not lock the room row before the organization link. Link revocation locks
    // the link first and then the affected rooms/memberships. This function follows
    // the same order to avoid a room->link / link->room deadlock.
    const { rows: roomLookup } = await client.query(
      'SELECT org_id, kind FROM rooms WHERE room_id = $1',
      [roomId],
    );
    if (!roomLookup[0]) return 'room_not_found';
    if (roomLookup[0].kind === 'direct') {
      const { rows: pairAccounts } = await client.query(
        'SELECT user_id FROM accounts WHERE user_id IN (SELECT user_a FROM direct_conversations WHERE room_id = $1 UNION SELECT user_b FROM direct_conversations WHERE room_id = $1) ORDER BY user_id FOR SHARE',
        [roomId],
      );
      if (pairAccounts.length !== 2) return 'not_member';
      const { rows: conversations } = await client.query(
        'SELECT user_a, user_b, status FROM direct_conversations WHERE room_id = $1 FOR SHARE',
        [roomId],
      );
      const conversation = conversations[0];
      if (!conversation || conversation.status !== 'active') return 'direct_not_active';
      if (conversation.user_a !== userId && conversation.user_b !== userId) return 'not_member';
      const { rows: lockedDirectRoom } = await client.query(
        'SELECT kind FROM rooms WHERE room_id = $1 FOR SHARE',
        [roomId],
      );
      if (!lockedDirectRoom[0] || lockedDirectRoom[0].kind !== 'direct') return 'room_changed';
      const { rows: directMembership } = await client.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 FOR SHARE',
        [roomId, userId],
      );
      if (!directMembership.length) return 'not_member';
      const peerUserId = conversation.user_a === userId ? conversation.user_b : conversation.user_a;
      const { rows: blocked } = await client.query(
        'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) FOR SHARE',
        [userId, peerUserId],
      );
      return blocked.length ? 'user_blocked' : null;
    }
    const orgId = roomLookup[0].org_id;
    const { rows: orgRows } = await client.query(
      'SELECT status FROM organizations WHERE org_id = $1 FOR SHARE',
      [orgId],
    );
    if (!orgRows[0] || orgRows[0].status !== 'approved') return 'org_not_approved';

    const { rows: directMembership } = await client.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2 FOR SHARE',
      [orgId, userId],
    );
    if (!directMembership.length) {
      const { rows: candidates } = await client.query(
        `SELECT member.org_id
           FROM org_members member
           JOIN organizations member_org ON member_org.org_id = member.org_id
          WHERE member.user_id = $1
            AND member.org_id <> $2
            AND member_org.status = 'approved'
          ORDER BY member.org_id`,
        [userId, orgId],
      );
      let authorized = false;
      for (const candidate of candidates) {
        const orgA = candidate.org_id < orgId ? candidate.org_id : orgId;
        const orgB = candidate.org_id < orgId ? orgId : candidate.org_id;
        const { rows: links } = await client.query(
          `SELECT link_id FROM org_links
            WHERE org_a = $1 AND org_b = $2 AND status = 'active'
            FOR SHARE`,
          [orgA, orgB],
        );
        if (!links.length) continue;
        const { rows: linkedMembership } = await client.query(
          `SELECT 1
             FROM org_members member
             JOIN organizations member_org ON member_org.org_id = member.org_id
            WHERE member.org_id = $1 AND member.user_id = $2
              AND member_org.status = 'approved'
            FOR SHARE OF member, member_org`,
          [candidate.org_id, userId],
        );
        if (linkedMembership.length) {
          authorized = true;
          break;
        }
      }
      if (!authorized) return 'org_not_member';
    }

    const { rows: lockedRoom } = await client.query(
      'SELECT org_id FROM rooms WHERE room_id = $1 FOR SHARE',
      [roomId],
    );
    if (!lockedRoom[0]) return 'room_not_found';
    if (lockedRoom[0].org_id !== orgId) return 'room_changed';
    const { rows: roomMembership } = await client.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 FOR SHARE',
      [roomId, userId],
    );
    return roomMembership.length ? null : 'not_member';
  }

  async function createIncomingContactRequest(client, roomId, senderId, createdAt) {
    const { rows } = await client.query(
      'SELECT user_a, user_b FROM direct_conversations WHERE room_id = $1 FOR SHARE',
      [roomId],
    );
    const conversation = rows[0];
    if (!conversation) return;
    const recipientId = conversation.user_a === senderId
      ? conversation.user_b
      : conversation.user_b === senderId ? conversation.user_a : null;
    if (!recipientId) return;
    const { rows: blocked } = await client.query(
      'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) FOR SHARE',
      [senderId, recipientId],
    );
    if (blocked.length) return;
    const { rows: contact } = await client.query(
      'SELECT 1 FROM contacts WHERE owner_id = $1 AND contact_user_id = $2',
      [recipientId, senderId],
    );
    if (contact.length) return;
    await client.query(
      "INSERT INTO contact_requests (requester_id, recipient_id, room_id, status, created_at, decided_at) VALUES ($1, $2, $3, 'pending', $4, NULL) ON CONFLICT (requester_id, recipient_id) DO NOTHING",
      [senderId, recipientId, roomId, createdAt],
    );
  }

  async function lockUserOrgAccess(client, userId, orgId) {
    const { rows: direct } = await client.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2 FOR SHARE',
      [orgId, userId],
    );
    if (direct.length) return true;
    const { rows: candidates } = await client.query(
      `SELECT member.org_id
         FROM org_members member
         JOIN organizations member_org ON member_org.org_id = member.org_id
        WHERE member.user_id = $1
          AND member.org_id <> $2
          AND member_org.status = 'approved'
        ORDER BY member.org_id`,
      [userId, orgId],
    );
    for (const candidate of candidates) {
      const orgA = candidate.org_id < orgId ? candidate.org_id : orgId;
      const orgB = candidate.org_id < orgId ? orgId : candidate.org_id;
      const { rows: links } = await client.query(
        `SELECT link_id FROM org_links
          WHERE org_a = $1 AND org_b = $2 AND status = 'active'
          FOR SHARE`,
        [orgA, orgB],
      );
      if (!links.length) continue;
      const { rows: linked } = await client.query(
        `SELECT 1
           FROM org_members member
           JOIN organizations member_org ON member_org.org_id = member.org_id
          WHERE member.org_id = $1 AND member.user_id = $2
            AND member_org.status = 'approved'
          FOR SHARE OF member, member_org`,
        [candidate.org_id, userId],
      );
      if (linked.length) return true;
    }
    return false;
  }

  async function lockUsersShareOrgOrLink(client, userA, userB) {
    if (userA === userB) return true;
    const { rows: sameOrg } = await client.query(
      `SELECT 1
         FROM org_members a
         JOIN organizations org_a ON org_a.org_id = a.org_id
         JOIN org_members b ON b.org_id = a.org_id AND b.user_id = $2
         JOIN organizations org_b ON org_b.org_id = b.org_id
        WHERE a.user_id = $1 AND org_a.status = 'approved' AND org_b.status = 'approved'
        LIMIT 1 FOR SHARE OF a, org_a, b, org_b`,
      [userA, userB],
    );
    if (sameOrg.length) return true;
    const { rows: linked } = await client.query(
      `SELECT 1
         FROM org_members a
         JOIN organizations org_a ON org_a.org_id = a.org_id
         JOIN org_members b ON b.user_id = $2
         JOIN organizations org_b ON org_b.org_id = b.org_id
         JOIN org_links link
           ON link.status = 'active'
          AND ((link.org_a = a.org_id AND link.org_b = b.org_id)
            OR (link.org_b = a.org_id AND link.org_a = b.org_id))
        WHERE a.user_id = $1 AND org_a.status = 'approved' AND org_b.status = 'approved'
        LIMIT 1 FOR SHARE OF a, org_a, b, org_b, link`,
      [userA, userB],
    );
    return linked.length > 0;
  }

  return {
    /** Регистрация: false, если логин уже занят. Гонка двух регистраций решается уникальным ключом. */
    async addAccount(userId, passwordHash, opts = {}) {
      const { rowCount } = await pool.query(
        'INSERT INTO accounts (user_id, password_hash) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
        [userId, passwordHash],
      );
      if (rowCount === 1 && opts.joinDefaultOrg) await pool.query("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ('org-default', $1, 'member', $2) ON CONFLICT DO NOTHING", [userId, Date.now()]);
      return rowCount === 1;
    },

    async addDevice(userId, deviceId, label = null, createdAt = 0) {
      const deviceKey = `${userId}|${deviceId}`;
      await pool.query(
        'INSERT INTO devices (device_key, user_id, device_id, label, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (device_key) DO NOTHING',
        [deviceKey, userId, deviceId, label, createdAt],
      );
      return deviceKey;
    },

    async setPin(userId, pinHash) {
      await pool.query(
        `INSERT INTO pins (user_id, pin_hash, failed, locked_until) VALUES ($1, $2, 0, NULL)
         ON CONFLICT (user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed = 0, locked_until = NULL`,
        [userId, pinHash],
      );
    },

    /**
     * Проверка PIN с блокировкой (правила те же, что в server.js: verifyPin).
     * Строка пользователя блокируется до конца проверки, поэтому попытки идут по одной:
     * число реальных проверок не зависит от того, сколько запросов пришло параллельно.
     */
    async verifyPin(userId, pin, { now, free, lockDuration, check }) {
      return inTransaction(async (c) => {
        const { rows } = await c.query(
          'SELECT failed, locked_until, pin_hash FROM pins WHERE user_id = $1 FOR UPDATE',
          [userId],
        );
        if (rows.length === 0) return { ok: false, reason: 'no-pin' };
        let failed = rows[0].failed;
        let lockedUntil = rows[0].locked_until === null ? null : Number(rows[0].locked_until);
        const save = (f, l) => c.query('UPDATE pins SET failed = $2, locked_until = $3 WHERE user_id = $1', [userId, f, l]);

        if (lockedUntil && now < lockedUntil) return { ok: false, reason: 'locked', retryAt: lockedUntil };
        const expiredLockCleared = !!lockedUntil && now >= lockedUntil;
        if (expiredLockCleared) lockedUntil = null;
        failed += 1;
        if (failed > free && !expiredLockCleared) {
          lockedUntil = now + lockDuration(failed);
          await save(failed, lockedUntil);
          return { ok: false, reason: 'locked', retryAt: lockedUntil };
        }
        if (check(pin, rows[0].pin_hash)) {
          await save(0, null);
          return { ok: true };
        }
        if (failed >= free) lockedUntil = now + lockDuration(failed);
        await save(failed, lockedUntil);
        return { ok: false, reason: 'wrong' };
      });
    },

    /** Дедупликация отправки: отправка от одного устройства с одним номером принимается один раз. */
    async recordSend(senderKey, type, txn, nowMs, windowMs = SEND_WINDOW_MS) {
      // Новая запись или запись старше окна: отправка новая (true). Повтор внутри окна: false.
      const { rowCount } = await pool.query(
        `INSERT INTO sends (sender_key, type, txn, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (sender_key, type, txn) DO UPDATE SET created_at = EXCLUDED.created_at
         WHERE sends.created_at <= $4::bigint - $5::bigint`,
        [senderKey, type, txn, nowMs, windowMs],
      );
      return rowCount === 1;
    },
    async releaseSend(senderKey, type, txn) {
      await pool.query('DELETE FROM sends WHERE sender_key = $1 AND type = $2 AND txn = $3', [senderKey, type, txn]);
    },

    async addOneTimeKeys(deviceKey, keys) {
      for (const [name, value] of Object.entries(keys)) {
        await pool.query(
          `INSERT INTO one_time_keys (device_key, name, value) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (device_key, name) DO NOTHING`,
          [deviceKey, name, JSON.stringify(value)],
        );
      }
    },

    /**
     * Выдача одноразового ключа. Строка блокируется в транзакции, занятые строки пропускаются:
     * один ключ выдаётся только одному запросу.
     */
    async claimOneTimeKey(deviceKey, requesterId, targetUserId) {
      return inTransaction(async (c) => {
        const { rows: deviceRows } = await c.query(
          'SELECT user_id, revoked FROM devices WHERE device_key = $1 FOR SHARE',
          [deviceKey],
        );
        if (!deviceRows[0] || deviceRows[0].revoked || deviceRows[0].user_id !== targetUserId) return null;
        if (requesterId !== targetUserId) {
          const { rows: sameOrg } = await c.query(
            `SELECT 1
               FROM org_members sender
               JOIN organizations sender_org ON sender_org.org_id = sender.org_id
               JOIN org_members recipient ON recipient.org_id = sender.org_id AND recipient.user_id = $2
               JOIN organizations recipient_org ON recipient_org.org_id = recipient.org_id
              WHERE sender.user_id = $1
                AND sender_org.status = 'approved'
                AND recipient_org.status = 'approved'
              LIMIT 1 FOR SHARE OF sender, sender_org, recipient, recipient_org`,
            [requesterId, targetUserId],
          );
          if (!sameOrg.length) {
            const { rows: linked } = await c.query(
              `SELECT 1
                 FROM org_members sender
                 JOIN organizations sender_org ON sender_org.org_id = sender.org_id
                 JOIN org_members recipient ON recipient.user_id = $2
                 JOIN organizations recipient_org ON recipient_org.org_id = recipient.org_id
                 JOIN org_links link
                   ON link.status = 'active'
                  AND ((link.org_a = sender.org_id AND link.org_b = recipient.org_id)
                    OR (link.org_b = sender.org_id AND link.org_a = recipient.org_id))
                WHERE sender.user_id = $1
                  AND sender_org.status = 'approved'
                  AND recipient_org.status = 'approved'
                LIMIT 1 FOR SHARE OF sender, sender_org, recipient, recipient_org, link`,
              [requesterId, targetUserId],
            );
            if (!linked.length) return null;
          }
        }
        const { rows } = await c.query(
          `SELECT name, value FROM one_time_keys WHERE device_key = $1
           ORDER BY name LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [deviceKey],
        );
        if (rows.length === 0) return null;
        await c.query('DELETE FROM one_time_keys WHERE device_key = $1 AND name = $2', [deviceKey, rows[0].name]);
        return { [rows[0].name]: rows[0].value };
      });
    },

    /**
     * Положить запись в очередь устройства. Если задан dedupe_key (состав устройств, беседа),
     * прежняя неподтверждённая запись с тем же ключом заменяется новой: очередь не растёт.
     */
    async enqueue(deviceKey, stream, body, dedupeKey, expiresAt) {
      await pool.query(
        `INSERT INTO inbox (device_key, stream, dedupe_key, body, expires_at) VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (device_key, stream, dedupe_key)
         DO UPDATE SET id = nextval('inbox_seq'), body = EXCLUDED.body, expires_at = EXCLUDED.expires_at`,
        [deviceKey, stream, dedupeKey ?? null, JSON.stringify(body), expiresAt],
      );
    },
    // Atomic bounded enqueue for user-to-device traffic. The device row serializes concurrent senders.
    async enqueueToDevice(deviceKey, body, dedupeKey, expiresAt, nowMs, maxPending, senderUserId, recipientUserId) {
      return inTransaction(async (c) => {
        if (senderUserId !== recipientUserId) {
          const { rows: sameOrg } = await c.query(
            `SELECT 1
               FROM org_members sender
               JOIN organizations sender_org ON sender_org.org_id = sender.org_id
               JOIN org_members recipient ON recipient.org_id = sender.org_id AND recipient.user_id = $2
               JOIN organizations recipient_org ON recipient_org.org_id = recipient.org_id
              WHERE sender.user_id = $1
                AND sender_org.status = 'approved'
                AND recipient_org.status = 'approved'
              LIMIT 1 FOR SHARE OF sender, sender_org, recipient, recipient_org`,
            [senderUserId, recipientUserId],
          );
          if (!sameOrg.length) {
            const { rows: linked } = await c.query(
              `SELECT 1
                 FROM org_members sender
                 JOIN organizations sender_org ON sender_org.org_id = sender.org_id
                 JOIN org_members recipient ON recipient.user_id = $2
                 JOIN organizations recipient_org ON recipient_org.org_id = recipient.org_id
                 JOIN org_links link
                   ON link.status = 'active'
                  AND ((link.org_a = sender.org_id AND link.org_b = recipient.org_id)
                    OR (link.org_b = sender.org_id AND link.org_a = recipient.org_id))
                WHERE sender.user_id = $1
                  AND sender_org.status = 'approved'
                  AND recipient_org.status = 'approved'
                LIMIT 1 FOR SHARE OF sender, sender_org, recipient, recipient_org, link`,
              [senderUserId, recipientUserId],
            );
            if (!linked.length) return { ok: false, reason: 'not_authorized' };
          }
        }
        const { rows: accounts } = await c.query('SELECT user_id FROM accounts WHERE user_id = $1 FOR UPDATE', [recipientUserId]);
        if (!accounts[0]) return { ok: false, reason: 'recipient_not_found' };
        const { rows: devices } = await c.query('SELECT user_id, revoked FROM devices WHERE device_key = $1 FOR UPDATE', [deviceKey]);
        if (!devices[0] || devices[0].revoked) return { ok: false, reason: 'device_revoked' };
        if (devices[0].user_id !== recipientUserId) return { ok: false, reason: 'device_mismatch' };
        await c.query(
          `DELETE FROM inbox i USING devices d
            WHERE i.device_key = d.device_key AND d.user_id = $1
              AND i.stream = 'to_device' AND i.expires_at <= $2`,
          [recipientUserId, nowMs],
        );
        const { rows: existing } = await c.query(
          "SELECT 1 FROM inbox WHERE device_key = $1 AND stream = 'to_device' AND dedupe_key = $2",
          [deviceKey, dedupeKey],
        );
        if (!existing[0]) {
          const { rows: counts } = await c.query(
            `SELECT COUNT(*)::int AS n
               FROM inbox i JOIN devices d ON d.device_key = i.device_key
              WHERE d.user_id = $1 AND NOT d.revoked
                AND i.stream = 'to_device' AND i.expires_at > $2`,
            [recipientUserId, nowMs],
          );
          if (counts[0].n >= maxPending) return { ok: false, reason: 'queue_full' };
        }
        await c.query(
          `INSERT INTO inbox (device_key, stream, dedupe_key, body, expires_at)
           VALUES ($1, 'to_device', $2, $3::jsonb, $4)
           ON CONFLICT (device_key, stream, dedupe_key)
           DO UPDATE SET id = nextval('inbox_seq'), body = EXCLUDED.body, expires_at = EXCLUDED.expires_at`,
          [deviceKey, dedupeKey, JSON.stringify(body), expiresAt],
        );
        return { ok: true };
      });
    },

    /**
     * Подтверждение очереди (C-05, C-20): события доставки удаляются по своему номеру,
     * сигналы по своему; истёкшее удаляется всегда. Остальное возвращается по порядку номеров.
     */
    async deliveredMax(deviceKey, stream) {
      const { rows } = await pool.query('SELECT delivered FROM delivery_marks WHERE device_key = $1 AND stream = $2', [deviceKey, stream]);
      return rows[0] ? Number(rows[0].delivered) : 0;
    },
    async markDelivered(deviceKey, stream, id) {
      if (!(id > 0)) return;
      await pool.query('INSERT INTO delivery_marks (device_key, stream, delivered) VALUES ($1, $2, $3) ON CONFLICT (device_key, stream) DO UPDATE SET delivered = GREATEST(delivery_marks.delivered, EXCLUDED.delivered)', [deviceKey, stream, id]);
    },
    async purgeExpired(nowMs) {
      const run = async (sql) => (await pool.query(sql, [nowMs])).rowCount;
      const batchDelete = async (table, predicate, params) => {
        const result = await pool.query(
          `WITH expired AS (
             SELECT ctid FROM ${table}
             WHERE ${predicate}
             ORDER BY window_start
             LIMIT 500
           )
           DELETE FROM ${table} target USING expired
           WHERE target.ctid = expired.ctid`,
          params,
        );
        return result.rowCount;
      };
      const rateLimits = await batchDelete('rate_limits', 'window_start <= $1::bigint - $2::bigint', [nowMs, 24 * 60 * 60_000]);
      const loginThrottle = await batchDelete(
        'login_throttle',
        'window_start <= $1::bigint - $2::bigint AND blocked_until <= $1::bigint',
        [nowMs, 15 * 60_000],
      );
      return {
        inbox: await run('DELETE FROM inbox WHERE expires_at <= $1'),
        tokens: await run('DELETE FROM tokens WHERE expires_at <= $1'),
        refreshTokens: await run('DELETE FROM refresh_tokens WHERE expires_at <= $1'),
        authTokens: await run('DELETE FROM auth_tokens WHERE expires_at < $1'),
        recoveryCancelCodes: await run('DELETE FROM recovery_cancel_codes WHERE expires_at <= $1'),
        rateLimits,
        loginThrottle,
      };
    },
    async clearExpiredCodes(nowMs) {
      const run = async (sql) => (await pool.query(sql, [nowMs])).rowCount;
      const phoneCodes = await run("UPDATE phones SET code_hash = NULL, code_attempts = 0, code_expires_at = 0 WHERE code_expires_at > 0 AND code_expires_at <= $1");
      const emailCodes = (await run("UPDATE email_codes SET code_hash = NULL, code_attempts = 0, code_expires_at = 0 WHERE code_expires_at > 0 AND code_expires_at <= $1"))
        + (await run("UPDATE email_codes SET token_hash = NULL, token_expires_at = 0 WHERE token_expires_at > 0 AND token_expires_at <= $1"));
      const emailRows = (await pool.query("DELETE FROM email_codes WHERE code_hash IS NULL AND token_hash IS NULL")).rowCount;
      const recoveryRequests = await run("UPDATE recovery SET req_code_hash = NULL, req_link_hash = NULL WHERE req_expires_at > 0 AND req_expires_at <= $1");
      return { phoneCodes, emailCodes, emailRows, recoveryRequests };
    },
    async purgeRetired(nowMs) {
      const retention = 30 * 24 * 3600_000;
      const approvals = (await pool.query('DELETE FROM approvals WHERE expires_at + $2 <= $1', [nowMs, retention])).rowCount;
      const invites = (await pool.query('DELETE FROM invites WHERE expires_at + $2 <= $1', [nowMs, retention])).rowCount;
      return { approvals, invites };
    },
    async createOrganization({ orgId, name, status, createdBy, createdAt }) {
      await pool.query('INSERT INTO organizations (org_id, name, status, created_by, created_at) VALUES ($1, $2, $3, $4, $5)', [orgId, name, status, createdBy ?? null, createdAt]);
    },
    async addOrgMember(orgId, userId, role, joinedAt) {
      const { rowCount } = await pool.query('INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, user_id) DO NOTHING', [orgId, userId, role, joinedAt]);
      return rowCount === 1;
    },
    async orgRoleOf(orgId, userId) {
      const { rows } = await pool.query('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
      return rows[0]?.role ?? null;
    },
    async listUserOrgs(userId) {
      const { rows } = await pool.query('SELECT o.org_id, o.name, o.status, m.role FROM org_members m JOIN organizations o ON o.org_id = m.org_id WHERE m.user_id = $1 ORDER BY o.org_id', [userId]);
      return rows.map((r) => ({ orgId: r.org_id, name: r.name, status: r.status, role: r.role }));
    },
    async orgStatus(orgId) {
      const { rows } = await pool.query('SELECT status FROM organizations WHERE org_id = $1', [orgId]);
      return rows[0]?.status ?? null;
    },
    async roomOrg(roomId) {
      const { rows } = await pool.query('SELECT org_id FROM rooms WHERE room_id = $1', [roomId]);
      return rows[0]?.org_id ?? null;
    },
    async setPlatformRole(userId, role) {
      await pool.query('INSERT INTO platform_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role', [userId, role]);
    },
    async platformRoleOf(userId) {
      const { rows } = await pool.query('SELECT role FROM platform_roles WHERE user_id = $1', [userId]);
      return rows[0]?.role ?? null;
    },
    async createOrgRequest({ requestId, applicantId, name, createdAt }) {
      await pool.query('INSERT INTO org_requests (request_id, applicant_id, name, status, created_at) VALUES ($1, $2, $3, $4, $5)', [requestId, applicantId, name, 'pending', createdAt]);
      await pool.query("INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, 'created', $3)", [requestId, applicantId, createdAt]);
    },
    async getOrgRequest(requestId) {
      const { rows } = await pool.query('SELECT request_id, applicant_id, name, status, org_id, created_at, decided_at, decided_by FROM org_requests WHERE request_id = $1', [requestId]);
      const r = rows[0];
      if (!r) return null;
      return { requestId: r.request_id, applicantId: r.applicant_id, name: r.name, status: r.status, orgId: r.org_id, createdAt: Number(r.created_at), decidedAt: r.decided_at === null ? null : Number(r.decided_at), decidedBy: r.decided_by };
    },
    async listOrgRequests({ userId, all }) {
      const { rows } = all
        ? await pool.query('SELECT request_id, applicant_id, name, status, created_at FROM org_requests ORDER BY created_at')
        : await pool.query('SELECT request_id, applicant_id, name, status, created_at FROM org_requests WHERE applicant_id = $1 ORDER BY created_at', [userId]);
      return rows.map((r) => ({ requestId: r.request_id, applicantId: r.applicant_id, name: r.name, status: r.status, createdAt: Number(r.created_at) }));
    },
    async addOrgRequestDocument({ docId, requestId, kind, size, sha256, filename, mimeType, objectKey, uploadedBy, createdAt }) {
      return inTransaction(async (client) => {
        const { rows } = await client.query(
          'SELECT status FROM org_requests WHERE request_id = $1 FOR UPDATE',
          [requestId],
        );
        if (!rows[0] || rows[0].status !== 'pending') return false;
        await client.query(
          'INSERT INTO org_request_documents (doc_id, request_id, kind, size, sha256, filename, mime_type, object_key, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [docId, requestId, kind, size, sha256, filename, mimeType, objectKey, uploadedBy, createdAt],
        );
        await client.query(
          "INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, 'document', $3)",
          [requestId, uploadedBy, createdAt],
        );
        return true;
      });
    },
    async listOrgRequestDocuments(requestId) {
      const { rows } = await pool.query('SELECT doc_id, kind, size, sha256, filename, mime_type, created_at FROM org_request_documents WHERE request_id = $1 ORDER BY created_at', [requestId]);
      return rows.map((r) => ({ docId: r.doc_id, kind: r.kind, size: Number(r.size), sha256: r.sha256, filename: r.filename, mimeType: r.mime_type, createdAt: Number(r.created_at) }));
    },
    async getOrgRequestDocument(docId) {
      const { rows } = await pool.query('SELECT doc_id, request_id, kind, size, sha256, filename, mime_type, object_key FROM org_request_documents WHERE doc_id = $1', [docId]);
      const r = rows[0];
      if (!r) return null;
      return { docId: r.doc_id, requestId: r.request_id, kind: r.kind, size: Number(r.size), sha256: r.sha256, filename: r.filename, mimeType: r.mime_type, objectKey: r.object_key };
    },
    async decideOrgRequest({ requestId, decision, decidedBy, decidedAt }) {
      return inTransaction(async (client) => {
        const { rows } = await client.query(
          'SELECT applicant_id, name, status, org_id FROM org_requests WHERE request_id = $1 FOR UPDATE',
          [requestId],
        );
        const request = rows[0];
        if (!request) return null;
        if (request.status !== 'pending') {
          return { conflict: true, status: request.status, orgId: request.org_id };
        }

        const status = decision === 'approve' ? 'approved' : 'rejected';
        const orgId = decision === 'approve' ? `org-${requestId}` : null;
        if (orgId) {
          await client.query(
            'INSERT INTO organizations (org_id, name, status, created_by, created_at) VALUES ($1, $2, $3, $4, $5)',
            [orgId, request.name, 'approved', request.applicant_id, decidedAt],
          );
          await client.query(
            "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', $3)",
            [orgId, request.applicant_id, decidedAt],
          );
        }
        const updated = await client.query(
          "UPDATE org_requests SET status = $2, decided_by = $3, decided_at = $4, org_id = $5 WHERE request_id = $1 AND status = 'pending'",
          [requestId, status, decidedBy, decidedAt, orgId],
        );
        if (updated.rowCount !== 1) throw new Error('organization request decision lost pending lock');
        await client.query(
          'INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, $3, $4)',
          [requestId, decidedBy, decision, decidedAt],
        );
        return { status, orgId };
      });
    },
    async logOrgRequest(requestId, actor, action, at) {
      await pool.query('INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, $3, $4)', [requestId, actor, action, at]);
    },
    async listOrgRequestLog(requestId) {
      const { rows } = await pool.query('SELECT actor, action, at FROM org_request_log WHERE request_id = $1 ORDER BY id', [requestId]);
      return rows.map((r) => ({ actor: r.actor, action: r.action, at: Number(r.at) }));
    },
    async listOrgMembers(orgId) {
      const { rows } = await pool.query('SELECT user_id, role FROM org_members WHERE org_id = $1 ORDER BY user_id', [orgId]);
      return rows.map((r) => ({ userId: r.user_id, role: r.role }));
    },
    async setOrgMemberRole(orgId, userId, role) {
      await pool.query('UPDATE org_members SET role = $3 WHERE org_id = $1 AND user_id = $2', [orgId, userId, role]);
    },
    async addOrgMemberAtomic({ orgId, actor, target, role, at }) {
      return inTransaction(async (client) => {
        const { rows: orgRows } = await client.query('SELECT status FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (!orgRows[0]) return { ok: false, reason: 'not_found' };
        if (orgRows[0].status !== 'approved') return { ok: false, reason: 'org_not_approved' };
        const { rows: actorRows } = await client.query(
          'SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE',
          [orgId, actor],
        );
        const actorRole = actorRows[0]?.role;
        if (actorRole !== 'owner' && actorRole !== 'admin') return { ok: false, reason: 'forbidden' };
        if (actorRole === 'admin' && role !== 'member') return { ok: false, reason: 'forbidden' };
        const { rows: accountRows } = await client.query('SELECT user_id FROM accounts WHERE user_id = $1', [target]);
        if (!accountRows[0]) return { ok: false, reason: 'unknown_user' };
        const inserted = await client.query(
          'INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING user_id',
          [orgId, target, role, at],
        );
        if (!inserted.rowCount) return { ok: false, reason: 'already_member' };
        await client.query(
          'INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)',
          [orgId, actor, 'member_add', target, role, at],
        );
        return { ok: true };
      });
    },
    async changeOrgMemberRoleAtomic({ orgId, actor, target, role, at }) {
      return inTransaction(async (client) => {
        const { rows: orgRows } = await client.query('SELECT org_id FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (!orgRows[0]) return { ok: false, reason: 'not_found' };
        const { rows } = await client.query(
          'SELECT user_id, role FROM org_members WHERE org_id = $1 AND user_id = ANY($2::text[]) ORDER BY user_id FOR UPDATE',
          [orgId, [...new Set([actor, target])]],
        );
        const roles = new Map(rows.map((row) => [row.user_id, row.role]));
        if (roles.get(actor) !== 'owner') return { ok: false, reason: 'forbidden' };
        const current = roles.get(target);
        if (!current) return { ok: false, reason: 'not_found' };
        if (current === 'owner' && role !== 'owner') {
          const { rows: owners } = await client.query(
            "SELECT COUNT(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner'",
            [orgId],
          );
          if (owners[0].n <= 1) return { ok: false, reason: 'last_owner' };
        }
        await client.query('UPDATE org_members SET role = $3 WHERE org_id = $1 AND user_id = $2', [orgId, target, role]);
        testHooks.beforeAdminActionInsert?.({ orgId, actor, action: 'role_change', target });
        await client.query(
          'INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)',
          [orgId, actor, 'role_change', target, current + '->' + role, at],
        );
        return { ok: true, current };
      });
    },
    async removeOrgMemberAtomic({ orgId, actor, target, action, at }) {
      return inTransaction(async (client) => {
        const { rows: orgRows } = await client.query('SELECT org_id FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (!orgRows[0]) return { ok: false, reason: 'not_found' };
        const { rows } = await client.query(
          'SELECT user_id, role FROM org_members WHERE org_id = $1 AND user_id = ANY($2::text[]) ORDER BY user_id FOR UPDATE',
          [orgId, [...new Set([actor, target])]],
        );
        const roles = new Map(rows.map((row) => [row.user_id, row.role]));
        const actorRole = roles.get(actor);
        const targetRole = roles.get(target);
        if (!targetRole) return { ok: false, reason: 'not_found' };
        if (action === 'member_leave') {
          if (actor !== target || !actorRole) return { ok: false, reason: 'not_found' };
        } else if (actorRole !== 'owner' && !(actorRole === 'admin' && targetRole === 'member')) {
          return { ok: false, reason: 'forbidden' };
        }
        if (targetRole === 'owner') {
          const { rows: owners } = await client.query(
            "SELECT COUNT(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner'",
            [orgId],
          );
          if (owners[0].n <= 1) return { ok: false, reason: 'last_owner' };
        }
        const { rows: ownedRooms } = await client.query(
          `SELECT r.room_id FROM rooms r WHERE r.owner = $2 AND (r.org_id = $1 OR (EXISTS (SELECT 1 FROM org_links l WHERE l.status = 'active' AND ((l.org_a = $1 AND l.org_b = r.org_id) OR (l.org_b = $1 AND l.org_a = r.org_id))) AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = r.org_id AND own.user_id = $2))) ORDER BY r.room_id`,
          [orgId, target],
        );
        if (ownedRooms.length) return { ok: false, reason: 'owns_rooms' };
        const { rows: roomMemberships } = await client.query(
          `SELECT rm.room_id FROM room_members rm JOIN rooms r ON r.room_id = rm.room_id WHERE rm.user_id = $2 AND (r.org_id = $1 OR (EXISTS (SELECT 1 FROM org_links l WHERE l.status = 'active' AND ((l.org_a = $1 AND l.org_b = r.org_id) OR (l.org_b = $1 AND l.org_a = r.org_id))) AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = r.org_id AND own.user_id = rm.user_id))) ORDER BY rm.room_id FOR UPDATE OF rm`,
          [orgId, target],
        );
        if (roomMemberships.length) {
          return { ok: false, reason: 'mls_removal_required', roomIds: roomMemberships.map((row) => row.room_id) };
        }
        await client.query(`DELETE FROM join_requests jr USING rooms r WHERE jr.room_id = r.room_id AND jr.user_id = $2 AND (r.org_id = $1 OR (EXISTS (SELECT 1 FROM org_links l WHERE l.status = 'active' AND ((l.org_a = $1 AND l.org_b = r.org_id) OR (l.org_b = $1 AND l.org_a = r.org_id))) AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = r.org_id AND own.user_id = jr.user_id)))`, [orgId, target]);
        await client.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, target]);
        testHooks.beforeAdminActionInsert?.({ orgId, actor, action, target });
        await client.query(
          'INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)',
          [orgId, actor, action, target, targetRole, at],
        );
        return { ok: true, role: targetRole };
      });
    },
    async countOrgOwners(orgId) {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner'", [orgId]);
      return rows[0].n;
    },
    async countOwnedRoomsInOrg(orgId, userId) {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM rooms WHERE org_id = $1 AND owner = $2', [orgId, userId]);
      return rows[0].n;
    },
    async removeOrgMember(orgId, userId) {
      return inTransaction(async (c) => {
        await c.query('SELECT user_id FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, userId]);
        const { rows: ownedRooms } = await c.query(
          `SELECT r.room_id FROM rooms r WHERE r.owner = $2 AND (r.org_id = $1 OR (EXISTS (SELECT 1 FROM org_links l WHERE l.status = 'active' AND ((l.org_a = $1 AND l.org_b = r.org_id) OR (l.org_b = $1 AND l.org_a = r.org_id))) AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = r.org_id AND own.user_id = $2))) ORDER BY r.room_id`,
          [orgId, userId],
        );
        if (ownedRooms.length) return { ok: false, reason: 'owns_rooms' };
        const { rows } = await c.query(
          `SELECT rm.room_id FROM room_members rm JOIN rooms r ON r.room_id = rm.room_id WHERE rm.user_id = $2 AND (r.org_id = $1 OR (EXISTS (SELECT 1 FROM org_links l WHERE l.status = 'active' AND ((l.org_a = $1 AND l.org_b = r.org_id) OR (l.org_b = $1 AND l.org_a = r.org_id))) AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = r.org_id AND own.user_id = rm.user_id))) ORDER BY rm.room_id FOR UPDATE OF rm`,
          [orgId, userId],
        );
        if (rows.length) return { ok: false, reason: 'mls_removal_required', roomIds: rows.map((row) => row.room_id) };
        await c.query(`DELETE FROM join_requests jr USING rooms r WHERE jr.room_id = r.room_id AND jr.user_id = $2 AND (r.org_id = $1 OR (EXISTS (SELECT 1 FROM org_links l WHERE l.status = 'active' AND ((l.org_a = $1 AND l.org_b = r.org_id) OR (l.org_b = $1 AND l.org_a = r.org_id))) AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = r.org_id AND own.user_id = jr.user_id)))`, [orgId, userId]);
        await c.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
        return { ok: true };
      });
    },
    async purgeRejectedOrgRequests(cutoffMs) {
      const { rows } = await pool.query("SELECT d.object_key FROM org_request_documents d JOIN org_requests r ON r.request_id = d.request_id WHERE r.status = 'rejected' AND r.decided_at <= $1", [cutoffMs]);
      await pool.query("DELETE FROM org_requests WHERE status = 'rejected' AND decided_at <= $1", [cutoffMs]);
      return rows.map((r) => r.object_key);
    },
    async orgSettings(orgId) {
      const { rows } = await pool.query('SELECT max_group_members, channels_enabled, file_quota_bytes FROM org_settings WHERE org_id = $1', [orgId]);
      const r = rows[0];
      if (!r) return { maxGroupMembers: null, channelsEnabled: true, fileQuotaBytes: null };
      return { maxGroupMembers: r.max_group_members, channelsEnabled: r.channels_enabled, fileQuotaBytes: r.file_quota_bytes === null ? null : Number(r.file_quota_bytes) };
    },
    async setOrgSetting({ orgId, field, value, actor, at }) {
      const column = { maxGroupMembers: 'max_group_members', channelsEnabled: 'channels_enabled', fileQuotaBytes: 'file_quota_bytes' }[field];
      const { rows } = await pool.query('SELECT max_group_members, channels_enabled, file_quota_bytes FROM org_settings WHERE org_id = $1', [orgId]);
      const r = rows[0];
      const old = !r ? { maxGroupMembers: null, channelsEnabled: true, fileQuotaBytes: null }[field] : { maxGroupMembers: r.max_group_members, channelsEnabled: r.channels_enabled, fileQuotaBytes: r.file_quota_bytes === null ? null : Number(r.file_quota_bytes) }[field];
      await pool.query(`INSERT INTO org_settings (org_id, ${column}) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET ${column} = EXCLUDED.${column}`, [orgId, value]);
      await pool.query('INSERT INTO org_settings_log (org_id, actor, field, old_value, new_value, at) VALUES ($1, $2, $3, $4, $5, $6)', [orgId, actor, field, JSON.stringify(old), JSON.stringify(value), at]);
    },
    async setOrgSettingAtomic({ orgId, field, value, actor, at }) {
      const column = { maxGroupMembers: 'max_group_members', channelsEnabled: 'channels_enabled', fileQuotaBytes: 'file_quota_bytes' }[field];
      if (!column) throw new Error('invalid organization setting field');
      return inTransaction(async (client) => {
        const { rows: orgRows } = await client.query('SELECT status FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (!orgRows[0]) return { ok: false, reason: 'not_found' };
        if (orgRows[0].status !== 'approved') return { ok: false, reason: 'org_not_approved' };
        const { rows: actorRows } = await client.query(
          'SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE',
          [orgId, actor],
        );
        if (!['owner', 'admin'].includes(actorRows[0]?.role)) return { ok: false, reason: 'forbidden' };
        const { rows } = await client.query('SELECT max_group_members, channels_enabled, file_quota_bytes FROM org_settings WHERE org_id = $1 FOR UPDATE', [orgId]);
        const row = rows[0];
        const old = !row
          ? { maxGroupMembers: null, channelsEnabled: true, fileQuotaBytes: null }[field]
          : { maxGroupMembers: row.max_group_members, channelsEnabled: row.channels_enabled, fileQuotaBytes: row.file_quota_bytes === null ? null : Number(row.file_quota_bytes) }[field];
        await client.query(
          `INSERT INTO org_settings (org_id, ${column}) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET ${column} = EXCLUDED.${column}`,
          [orgId, value],
        );
        await client.query(
          'INSERT INTO org_settings_log (org_id, actor, field, old_value, new_value, at) VALUES ($1, $2, $3, $4, $5, $6)',
          [orgId, actor, field, JSON.stringify(old), JSON.stringify(value), at],
        );
        testHooks.beforeAdminActionInsert?.({ orgId, actor, action: 'setting_change', target: field });
        await client.query(
          'INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)',
          [orgId, actor, 'setting_change', field, JSON.stringify(value), at],
        );
        return { ok: true };
      });
    },
    async listOrgSettingsLog(orgId) {
      const { rows } = await pool.query('SELECT actor, field, old_value, new_value, at FROM org_settings_log WHERE org_id = $1 ORDER BY id', [orgId]);
      return rows.map((x) => ({ actor: x.actor, field: x.field, old: JSON.parse(x.old_value), new: JSON.parse(x.new_value), at: Number(x.at) }));
    },
    async bytesForOrg(orgId) {
      const { rows } = await pool.query('SELECT COALESCE(SUM(f.size), 0)::bigint AS n FROM files f JOIN rooms r ON r.room_id = f.room_id WHERE r.org_id = $1', [orgId]);
      return Number(rows[0].n);
    },
    async createOrgLink({ linkId, proposingOrg, otherOrg, proposedBy, createdAt }) {
      const a = proposingOrg < otherOrg ? proposingOrg : otherOrg;
      const b = proposingOrg < otherOrg ? otherOrg : proposingOrg;
      const existing = await pool.query('SELECT status FROM org_links WHERE org_a = $1 AND org_b = $2', [a, b]);
      if (existing.rows[0] && existing.rows[0].status !== 'revoked') return false;
      if (existing.rows[0]) await pool.query('DELETE FROM org_links WHERE org_a = $1 AND org_b = $2', [a, b]);
      await pool.query("INSERT INTO org_links (link_id, org_a, org_b, proposed_by_org, status, proposed_by, created_at) VALUES ($1, $2, $3, $4, 'proposed', $5, $6)", [linkId, a, b, proposingOrg, proposedBy, createdAt]);
      return true;
    },
    async getOrgLink(linkId) {
      const { rows } = await pool.query('SELECT link_id, org_a, org_b, status, proposed_by_org FROM org_links WHERE link_id = $1', [linkId]);
      const r = rows[0];
      return r ? { linkId: r.link_id, orgA: r.org_a, orgB: r.org_b, status: r.status, proposingOrg: r.proposed_by_org } : null;
    },
    async setOrgLinkStatus({ linkId, status, decidedBy, decidedAt }) {
      await pool.query('UPDATE org_links SET status = $2, decided_by = $3, decided_at = $4 WHERE link_id = $1', [linkId, status, decidedBy, decidedAt]);
    },
    async transitionOrgLinkStatus({ linkId, fromStatus, status, decidedBy, decidedAt }) {
      const { rowCount } = await pool.query(
        'UPDATE org_links SET status = $3, decided_by = $4, decided_at = $5 WHERE link_id = $1 AND status = $2',
        [linkId, fromStatus, status, decidedBy, decidedAt],
      );
      return rowCount === 1;
    },
    async activeLinkBetween(x, y) {
      const a = x < y ? x : y;
      const b = x < y ? y : x;
      const { rows } = await pool.query("SELECT 1 FROM org_links WHERE org_a = $1 AND org_b = $2 AND status = 'active'", [a, b]);
      return rows.length > 0;
    },
    async orgLinksFor(orgId) {
      const { rows } = await pool.query('SELECT link_id, org_a, org_b, status, proposed_by_org FROM org_links WHERE org_a = $1 OR org_b = $1 ORDER BY link_id', [orgId]);
      return rows.map((r) => ({ linkId: r.link_id, orgA: r.org_a, orgB: r.org_b, status: r.status, proposingOrg: r.proposed_by_org }));
    },
    async removeCrossOrgMemberships(orgX, orgY) {
      const { rows } = await pool.query(
        `SELECT r.room_id, rm.user_id
           FROM room_members rm
           JOIN rooms r ON r.room_id = rm.room_id
          WHERE (r.org_id = $1 AND EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = $2 AND om.user_id = rm.user_id)
                              AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = $1 AND own.user_id = rm.user_id))
             OR (r.org_id = $2 AND EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = $1 AND om.user_id = rm.user_id)
                              AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = $2 AND own.user_id = rm.user_id))
          ORDER BY r.room_id, rm.user_id`,
        [orgX, orgY],
      );
      return rows.length
        ? { ok: false, reason: 'mls_removal_required', memberships: rows.map((row) => ({ roomId: row.room_id, userId: row.user_id })) }
        : { ok: true };
    },
    // Revoke the cross-organization link only after all inherited room memberships have been
    // removed through MLS Remove Commit. The link-row lock serializes with MLS Add Commit.
    async revokeOrgLink({ linkId, fromStatus, actor, at }) {
      return inTransaction(async (c) => {
        // Lock the active link first. MLS Add Commit transactions take FOR SHARE
        // on this row, so no new cross-org membership can appear after this point.
        const { rows } = await c.query(
          'SELECT org_a, org_b FROM org_links WHERE link_id = $1 AND status = $2 FOR UPDATE',
          [linkId, fromStatus],
        );
        if (!rows[0]) return { ok: false, reason: 'state_changed' };
        const { org_a: orgA, org_b: orgB } = rows[0];
        const { rows: memberships } = await c.query(
          `SELECT r.room_id, rm.user_id, r.owner
             FROM room_members rm
             JOIN rooms r ON r.room_id = rm.room_id
            WHERE (r.org_id = $1
                   AND EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = $2 AND om.user_id = rm.user_id)
                   AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = $1 AND own.user_id = rm.user_id))
               OR (r.org_id = $2
                   AND EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = $1 AND om.user_id = rm.user_id)
                   AND NOT EXISTS (SELECT 1 FROM org_members own WHERE own.org_id = $2 AND own.user_id = rm.user_id))
            ORDER BY r.room_id, rm.user_id
            FOR UPDATE OF rm`,
          [orgA, orgB],
        );
        if (memberships.length) {
          return {
            ok: false,
            reason: 'mls_removal_required',
            memberships: memberships.map((row) => ({ roomId: row.room_id, userId: row.user_id, owner: row.owner === row.user_id })),
          };
        }
        await c.query(
          "UPDATE org_links SET status = 'revoked', decided_by = $3, decided_at = $4 WHERE link_id = $1 AND status = $2",
          [linkId, fromStatus, actor, at],
        );
        await c.query(`DELETE FROM join_requests jr USING rooms r
          WHERE jr.room_id = r.room_id AND r.org_id = $1
            AND jr.user_id IN (SELECT user_id FROM org_members WHERE org_id = $2)
            AND jr.user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = $1)`, [orgA, orgB]);
        await c.query(`DELETE FROM join_requests jr USING rooms r
          WHERE jr.room_id = r.room_id AND r.org_id = $2
            AND jr.user_id IN (SELECT user_id FROM org_members WHERE org_id = $1)
            AND jr.user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = $2)`, [orgA, orgB]);
        await c.query(
          'INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6), ($4, $2, $3, $1, $5, $6)',
          [orgA, actor, 'link_revoke', orgB, linkId, at],
        );
        return { ok: true };
      });
    },
    async logAdminAction({ orgId, actor, action, target, detail, at }) {
      await pool.query('INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)', [orgId ?? null, actor, action, target ?? null, detail ?? null, at]);
    },
    async listAdminActions(orgId) {
      const { rows } = await pool.query('SELECT actor, action, target, detail, at FROM admin_action_log WHERE org_id IS NOT DISTINCT FROM $1 ORDER BY id', [orgId ?? null]);
      return rows.map((r) => ({ actor: r.actor, action: r.action, target: r.target, detail: r.detail, at: Number(r.at) }));
    },
    async removePlatformRole(userId) {
      await pool.query('DELETE FROM platform_roles WHERE user_id = $1', [userId]);
    },
    async listPlatformRoles() {
      const { rows } = await pool.query('SELECT user_id, role FROM platform_roles ORDER BY user_id');
      return rows.map((r) => ({ userId: r.user_id, role: r.role }));
    },
    // Только для тестов: задать ник уже созданному аккаунту (по HTTP этот метод недоступен).
    async setNicknameForTests(userId, nickname) {
      await pool.query('INSERT INTO profiles (user_id, email, email_verified, nickname, created_at) VALUES ($1, $2, TRUE, $3, 0) ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname', [userId, `${userId.replace(/[^a-z0-9]/gi, '')}@test.invalid`, nickname]);
    },
    async drainQueue(deviceKey, acked, signalAcked, nowMs) {
      return inTransaction(async (c) => {
        await c.query(
          `DELETE FROM inbox WHERE device_key = $1 AND (
             (stream = 'to_device' AND id <= $2) OR (stream <> 'to_device' AND id <= $3) OR expires_at <= $4)`,
          [deviceKey, acked, signalAcked, nowMs],
        );
        const { rows } = await c.query(
          'SELECT id, stream, dedupe_key, body FROM inbox WHERE device_key = $1 ORDER BY id',
          [deviceKey],
        );
        return rows.map((r) => ({ id: Number(r.id), stream: r.stream, dedupeKey: r.dedupe_key, body: r.body }));
      });
    },

    /** Выдаёт токен входа. В базе лежит только ключевой хэш (C-08); сам токен отдаётся клиенту один раз. */
    /** Выдаёт пару: токен доступа (короткий срок) и одноразовый токен обновления. В базе только ключевые хэши. */
    async issueSession(deviceKey, nowMs, accessTtlMs, refreshTtlMs) {
      const accessToken = randomBytes(16).toString('hex');
      const refreshToken = randomBytes(16).toString('hex');
      const accessExpiresAt = nowMs + accessTtlMs;
      const refreshExpiresAt = nowMs + refreshTtlMs;
      await inTransaction(async (c) => {
        await c.query('INSERT INTO tokens (token_hash, device_key, expires_at) VALUES ($1, $2, $3)', [keyed(pinPepper, 'token', accessToken), deviceKey, accessExpiresAt]);
        await c.query('INSERT INTO refresh_tokens (token_hash, device_key, expires_at, used_at) VALUES ($1, $2, $3, NULL)', [keyed(pinPepper, 'refresh', refreshToken), deviceKey, refreshExpiresAt]);
      });
      return { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt };
    },

    /** Устройство по токену доступа, если токен ещё действует; иначе null. */
    async deviceKeyForToken(raw, nowMs) {
      const { rows } = await pool.query('SELECT device_key FROM tokens WHERE token_hash = $1 AND expires_at > $2', [keyed(pinPepper, 'token', raw), nowMs]);
      return rows[0]?.device_key ?? null;
    },

    /** Состояние токена доступа: 'valid', 'expired' или 'unknown'. */
    async accessTokenState(raw, nowMs) {
      const { rows } = await pool.query('SELECT expires_at FROM tokens WHERE token_hash = $1', [keyed(pinPepper, 'token', raw)]);
      if (rows.length === 0) return 'unknown';
      return Number(rows[0].expires_at) > nowMs ? 'valid' : 'expired';
    },

    /** Погашает токен обновления: 'ok' (он был одноразовым), 'reused', 'expired' или 'unknown'. */
    async consumeRefreshToken(raw, nowMs) {
      const hash = keyed(pinPepper, 'refresh', raw);
      const { rows } = await pool.query('SELECT device_key, expires_at, used_at FROM refresh_tokens WHERE token_hash = $1', [hash]);
      if (rows.length === 0) return { state: 'unknown' };
      const row = rows[0];
      if (row.used_at !== null) return { state: 'reused', deviceKey: row.device_key };
      if (Number(row.expires_at) <= nowMs) return { state: 'expired' };
      const { rowCount } = await pool.query('UPDATE refresh_tokens SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL', [hash, nowMs]);
      if (rowCount === 0) return { state: 'reused', deviceKey: row.device_key };
      return { state: 'ok', deviceKey: row.device_key };
    },

    /** Завершает сессии устройства: токены доступа и обновления удаляются. Само устройство остаётся. */
    async endSession(deviceKey) {
      await inTransaction(async (c) => {
        await c.query('DELETE FROM tokens WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM refresh_tokens WHERE device_key = $1', [deviceKey]);
      });
    },


    /** Код восстановления: в базе только ключевой хэш (C-08). Сам код уходит в письмо. */
    async storeRecoveryCode(userId, code, notBefore) {
      await pool.query(
        `INSERT INTO recoveries (user_id, code_hash, not_before, status, attempts) VALUES ($1, $2, $3, 'pending', 0)
         ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, not_before = EXCLUDED.not_before,
           status = 'pending', attempts = 0`,
        [userId, keyed(pinPepper, `recovery:${userId}`, code), notBefore],
      );
    },

    /** Проверка кода восстановления: сравнение хэшей за постоянное время. */
    async checkRecoveryCode(userId, code) {
      const { rows } = await pool.query('SELECT code_hash FROM recoveries WHERE user_id = $1', [userId]);
      if (rows.length === 0) return false;
      const expected = Buffer.from(rows[0].code_hash, 'hex');
      const actual = Buffer.from(keyed(pinPepper, `recovery:${userId}`, String(code)), 'hex');
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
    async hasAccount(userId) {
      const { rowCount } = await pool.query('SELECT 1 FROM accounts WHERE user_id = $1', [userId]);
      return rowCount === 1;
    },

    async accountHash(userId) {
      const { rows } = await pool.query('SELECT password_hash FROM accounts WHERE user_id = $1', [userId]);
      return rows[0]?.password_hash ?? null;
    },

    async hasPin(userId) {
      const { rowCount } = await pool.query('SELECT 1 FROM pins WHERE user_id = $1', [userId]);
      return rowCount === 1;
    },

    async pinHash(userId) {
      const { rows } = await pool.query('SELECT pin_hash FROM pins WHERE user_id = $1', [userId]);
      return rows[0]?.pin_hash ?? null;
    },

    async removePin(userId) {
      await pool.query('DELETE FROM pins WHERE user_id = $1', [userId]);
    },

    async deviceRecord(deviceKey) {
      const { rows } = await pool.query('SELECT user_id, device_id, label, revoked, created_at FROM devices WHERE device_key = $1', [deviceKey]);
      return rows[0] ? { userId: rows[0].user_id, deviceId: rows[0].device_id, label: rows[0].label, revoked: rows[0].revoked, createdAt: Number(rows[0].created_at) } : null;
    },

    async activeDeviceCount(userId) {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM devices WHERE user_id = $1 AND NOT revoked', [userId]);
      return rows[0].n;
    },

    async activeDevices() {
      const { rows } = await pool.query('SELECT user_id, device_id, label, revoked, created_at FROM devices WHERE NOT revoked');
      return rows.map((r) => ({ userId: r.user_id, deviceId: r.device_id, label: r.label, revoked: r.revoked, createdAt: Number(r.created_at) }));
    },

    async devicesOfUser(userId) {
      const { rows } = await pool.query('SELECT user_id, device_id, label, revoked, created_at FROM devices WHERE user_id = $1', [userId]);
      return rows.map((r) => ({ userId: r.user_id, deviceId: r.device_id, label: r.label, revoked: r.revoked, createdAt: Number(r.created_at) }));
    },

    async reserveFile({ fileId, ownerId, ownerDeviceId = '', roomId, orgId = null, kind, size, sha256, createdAt, ownerQuotaBytes = null, orgQuotaBytes = null, pendingLimit }) {
      return inTransaction(async (c) => {
        // Advisory transaction locks serialize all quota/pending reservations for the same owner
        // and organization. Acquire in lexical order to avoid cross-scope lock inversion.
        const lockKeys = [`inone-file-owner:${ownerId}`];
        if (orgId && orgQuotaBytes !== null) lockKeys.push(`inone-file-org:${orgId}`);
        for (const lockKey of lockKeys.sort()) {
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
        }
        const { rows: pendingRows } = await c.query(
          "SELECT COUNT(*)::int AS n FROM files WHERE owner_id = $1 AND status IN ('pending', 'uploading', 'uploaded')",
          [ownerId],
        );
        if (pendingRows[0].n >= pendingLimit) return { ok: false, reason: 'pending_limit' };
        if (ownerQuotaBytes !== null) {
          const { rows } = await c.query(
            "SELECT COALESCE(SUM(size), 0)::bigint AS n FROM files WHERE owner_id = $1 AND status IN ('pending', 'uploading', 'uploaded', 'ready', 'deleting')",
            [ownerId],
          );
          if (Number(rows[0].n) + size > ownerQuotaBytes) return { ok: false, reason: 'owner_quota' };
        }
        if (orgId && orgQuotaBytes !== null) {
          const { rows } = await c.query(
            "SELECT COALESCE(SUM(f.size), 0)::bigint AS n FROM files f JOIN rooms r ON r.room_id = f.room_id WHERE r.org_id = $1 AND f.status IN ('pending', 'uploading', 'uploaded', 'ready', 'deleting')",
            [orgId],
          );
          if (Number(rows[0].n) + size > orgQuotaBytes) return { ok: false, reason: 'org_quota' };
        }
        await c.query(
          'INSERT INTO files (file_id, owner_id, owner_device_id, room_id, kind, size, sha256, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [fileId, ownerId, ownerDeviceId, roomId, kind, size, sha256, 'pending', createdAt],
        );
        return { ok: true };
      });
    },
    async createFile({ fileId, ownerId, ownerDeviceId = '', roomId, kind, size, sha256, createdAt }) {
      await pool.query('INSERT INTO files (file_id, owner_id, owner_device_id, room_id, kind, size, sha256, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [fileId, ownerId, ownerDeviceId, roomId, kind, size, sha256, 'pending', createdAt]);
    },
    async getFile(fileId) {
      const { rows } = await pool.query('SELECT file_id, owner_id, owner_device_id, room_id, kind, size, sha256, status, created_at, completed_at FROM files WHERE file_id = $1', [fileId]);
      const r = rows[0];
      if (!r) return null;
      return { fileId: r.file_id, ownerId: r.owner_id, ownerDeviceId: r.owner_device_id, roomId: r.room_id, kind: r.kind, size: Number(r.size), sha256: r.sha256, status: r.status, createdAt: Number(r.created_at), completedAt: r.completed_at === null ? null : Number(r.completed_at) };
    },
    async claimFileUpload(fileId, ownerId, ownerDeviceId) {
      const { rowCount } = await pool.query(
        "UPDATE files SET status = 'uploading' WHERE file_id = $1 AND owner_id = $2 AND owner_device_id = $3 AND status = 'pending'",
        [fileId, ownerId, ownerDeviceId],
      );
      return rowCount === 1;
    },
    async markFileUploaded(fileId) {
      const { rowCount } = await pool.query("UPDATE files SET status = 'uploaded' WHERE file_id = $1 AND status = 'uploading'", [fileId]);
      return rowCount === 1;
    },
    async markFileReady(fileId, nowMs, ownerId, ownerDeviceId) {
      return inTransaction(async (c) => {
        const { rows: files } = await c.query(
          "SELECT owner_id, owner_device_id, room_id FROM files WHERE file_id = $1 AND status = 'uploaded' FOR UPDATE",
          [fileId],
        );
        const file = files[0];
        if (!file || file.owner_id !== ownerId || file.owner_device_id !== ownerDeviceId) return false;
        const { rows: devices } = await c.query(
          'SELECT revoked FROM devices WHERE user_id = $1 AND device_id = $2 FOR SHARE',
          [ownerId, ownerDeviceId],
        );
        if (!devices[0] || devices[0].revoked) return false;
        if (file.room_id) {
          const access = await lockRoomWriteAccess(c, file.room_id, ownerId);
          if (access) return false;
          const { rows: permissions } = await c.query(
            `SELECT r.owner, rm.capabilities
               FROM rooms r JOIN room_members rm ON rm.room_id = r.room_id
              WHERE r.room_id = $1 AND rm.user_id = $2
              FOR SHARE OF r, rm`,
            [file.room_id, ownerId],
          );
          if (!permissions[0] || (permissions[0].owner !== ownerId && !permissions[0].capabilities.includes('send_messages'))) return false;
        }
        const { rowCount } = await c.query(
          "UPDATE files SET status = 'ready', completed_at = $2 WHERE file_id = $1 AND status = 'uploaded'",
          [fileId, nowMs],
        );
        return rowCount === 1;
      });
    },
    async countPendingFiles(ownerId) {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM files WHERE owner_id = $1 AND status IN ('pending', 'uploading', 'uploaded')", [ownerId]);
      return rows[0].n;
    },
    async bytesForOwner(ownerId) {
      const { rows } = await pool.query("SELECT COALESCE(SUM(size), 0)::bigint AS n FROM files WHERE owner_id = $1 AND status IN ('pending', 'uploading', 'uploaded', 'ready', 'deleting')", [ownerId]);
      return Number(rows[0].n);
    },
    async purgeStaleFiles(cutoffMs) {
      return inTransaction(async (c) => {
        const { rows } = await c.query(
          `WITH candidates AS (
             SELECT file_id FROM files
              WHERE (status IN ('pending', 'uploading', 'uploaded') AND created_at < $1) OR status = 'deleting'
              ORDER BY created_at, file_id
              FOR UPDATE SKIP LOCKED
              LIMIT 100
           )
           UPDATE files f SET status = 'deleting'
             FROM candidates c WHERE f.file_id = c.file_id
           RETURNING f.file_id`,
          [cutoffMs],
        );
        return rows.map((r) => r.file_id);
      });
    },
    async markFileDeleting(fileId) {
      const { rowCount } = await pool.query(
        "UPDATE files SET status = 'deleting' WHERE file_id = $1 AND status IN ('pending', 'uploading', 'uploaded')",
        [fileId],
      );
      return rowCount === 1;
    },
    async finalizeFileDeletion(fileId) {
      const { rowCount } = await pool.query("DELETE FROM files WHERE file_id = $1 AND status = 'deleting'", [fileId]);
      return rowCount === 1;
    },
    async setPushToken(deviceKey, provider, registration, nowMs) {
      if (!registration || !Buffer.isBuffer(registration.tokenCiphertext) || !Buffer.isBuffer(registration.tokenIv) || !Buffer.isBuffer(registration.tokenTag)) {
        throw new Error('encrypted push registration is required');
      }
      await pool.query(
        `INSERT INTO push_tokens
         (device_key, provider, token, token_ciphertext, token_iv, token_tag, identifier_kind, updated_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)
         ON CONFLICT (device_key) DO UPDATE SET provider = EXCLUDED.provider, token = NULL,
           token_ciphertext = EXCLUDED.token_ciphertext, token_iv = EXCLUDED.token_iv,
           token_tag = EXCLUDED.token_tag, identifier_kind = EXCLUDED.identifier_kind, updated_at = EXCLUDED.updated_at`,
        [deviceKey, provider, registration.tokenCiphertext, registration.tokenIv, registration.tokenTag, registration.identifierKind, nowMs],
      );
    },
    async deletePushToken(deviceKey) {
      await inTransaction(async (c) => {
        await c.query('DELETE FROM push_tokens WHERE device_key = $1', [deviceKey]);
        await c.query(
          `UPDATE push_deliveries SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
           last_error_code = 'registration_removed', updated_at = now()
           WHERE device_key = $1 AND status IN ('queued', 'failed', 'processing')`,
          [deviceKey],
        );
      });
    },
    async devicesToNotify(roomId, excludeDeviceKey) {
      const { rows } = await pool.query(
        `SELECT d.device_key, p.provider, p.identifier_kind
         FROM push_tokens p JOIN devices d ON d.device_key = p.device_key
         JOIN room_members m ON m.user_id = d.user_id
         WHERE m.room_id = $1 AND d.revoked = FALSE AND p.device_key <> $2
           AND p.provider = 'fcm' AND p.identifier_kind = 'fid'`,
        [roomId, excludeDeviceKey],
      );
      return rows.map((r) => ({ deviceKey: r.device_key, provider: r.provider, identifierKind: r.identifier_kind }));
    },
    async listDevicesFor(userId) {
      const { rows } = await pool.query(`SELECT d.device_id, d.label, d.revoked, (p.device_key IS NOT NULL) AS push FROM devices d LEFT JOIN push_tokens p ON p.device_key = d.device_key AND p.provider = 'fcm' AND p.identifier_kind = 'fid' AND p.token_ciphertext IS NOT NULL WHERE d.user_id = $1 ORDER BY d.device_id`, [userId]);
      return rows.map((r) => ({ deviceId: r.device_id, label: r.label, revoked: r.revoked, pushRegistered: r.push }));
    },
    async flagOverrides() {
      const { rows } = await pool.query('SELECT key, value FROM feature_flags');
      return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    },
    async flagVersion() {
      const { rows } = await pool.query('SELECT COALESCE(MAX(updated_at), 0)::bigint AS v FROM feature_flags');
      return Number(rows[0].v);
    },
    async setFlag(key, value, actor, reason, nowMs) {
      const old = await pool.query('SELECT value FROM feature_flags WHERE key = $1', [key]);
      const oldValue = old.rows[0]?.value ?? null;
      await pool.query('INSERT INTO feature_flags (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at', [key, JSON.stringify(value), nowMs]);
      await pool.query('INSERT INTO flag_changes (key, old_value, new_value, actor, reason, changed_at) VALUES ($1, $2, $3, $4, $5, $6)', [key, oldValue, JSON.stringify(value), actor, reason, nowMs]);
    },
    async flagHistory(key) {
      const { rows } = await pool.query('SELECT old_value, new_value, actor, reason, changed_at FROM flag_changes WHERE key = $1 ORDER BY id', [key]);
      return rows; // имена столбцов как в таблице: так читает журнал команда scripts/set-flag.mjs
    },
    async revokeDevice(deviceKey) {
      // Отключённое устройство теряет все ключи, незавершённые MLS packages и очередь доставки.
      await inTransaction(async (c) => {
        const { rows: deviceRows } = await c.query(
          'SELECT user_id, device_id FROM devices WHERE device_key = $1 FOR UPDATE',
          [deviceKey],
        );
        await c.query('UPDATE devices SET revoked = TRUE WHERE device_key = $1', [deviceKey]);
        if (deviceRows[0]) {
          await c.query('DELETE FROM mls_key_packages WHERE user_id = $1 AND device_id = $2', [deviceRows[0].user_id, deviceRows[0].device_id]);
          await c.query(
            `UPDATE mls_key_package_claims c
                SET result = COALESCE((
                  SELECT jsonb_agg(items.item)
                    FROM jsonb_array_elements(c.result) AS items(item)
                   WHERE items.item->>'deviceId' <> $2
                ), '[]'::jsonb)
              WHERE c.target_user_id = $1 AND c.result IS NOT NULL`,
            [deviceRows[0].user_id, deviceRows[0].device_id],
          );
        }
        if (deviceRows[0]) {
          await c.query('DELETE FROM mls_welcomes WHERE user_id = $1 AND device_id = $2 AND acked_at IS NULL', [deviceRows[0].user_id, deviceRows[0].device_id]);
        }
        await c.query('DELETE FROM device_keys WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM one_time_keys WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM inbox WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM push_tokens WHERE device_key = $1', [deviceKey]);
        await c.query(
          `UPDATE push_deliveries SET status = 'cancelled', locked_at = NULL, locked_by = NULL,
           last_error_code = 'device_revoked', updated_at = now()
           WHERE device_key = $1 AND status IN ('queued', 'failed', 'processing')`,
          [deviceKey],
        );
      });
    },

    async tokenHashes() {
      const { rows } = await pool.query('SELECT token_hash FROM tokens');
      return rows.map((r) => r.token_hash);
    },

    /**
     * Защита входа (D7): счётчики пары, адреса и логина меняются под блокировкой строк, в порядке ключей.
     * Жёсткой блокировки логина нет: владелец с другого адреса входит всегда.
     */
    async throttledLogin({ pairKey, sourceKey, loginKey, now: nowMs, verify, policy, notify }) {
      return inTransaction(async (c) => {
        const keys = [...new Set([pairKey, sourceKey, loginKey])].sort();
        for (const k of keys) {
          await c.query('INSERT INTO login_throttle (key) VALUES ($1) ON CONFLICT (key) DO NOTHING', [k]);
        }
        const locked = {};
        for (const k of keys) {
          const { rows } = await c.query('SELECT failed, window_start, blocked_until FROM login_throttle WHERE key = $1 FOR UPDATE', [k]);
          locked[k] = { failed: rows[0].failed, windowStart: Number(rows[0].window_start), blockedUntil: Number(rows[0].blocked_until) };
        }
        const r = decideLogin({ pair: locked[pairKey], source: locked[sourceKey], login: locked[loginKey], nowMs, verify, notify, policy });
        for (const [k, rec] of [[pairKey, r.pair], [sourceKey, r.source], [loginKey, r.login]]) {
          await c.query('UPDATE login_throttle SET failed = $2, window_start = $3, blocked_until = $4 WHERE key = $1',
            [k, rec.failed, rec.windowStart, rec.blockedUntil]);
        }
        return { status: r.status, retryAt: r.retryAt, notify: r.notify };
      });
    },

    /** Новый запрос подтверждения. Проверка лимита активных запросов и вставка идут под блокировкой аккаунта. */
    async createApproval(row, { max, now: nowMs }) {
      return inTransaction(async (c) => {
        await c.query('SELECT 1 FROM accounts WHERE user_id = $1 FOR UPDATE', [row.userId]);
        const { rows } = await c.query(
          `SELECT count(*)::int AS n FROM approvals WHERE user_id = $1 AND status = 'pending' AND expires_at > $2`,
          [row.userId, nowMs],
        );
        if (rows[0].n >= max) return false;
        await c.query(
          `INSERT INTO approvals (id, user_id, device_id, label, platform, code_hash, poll_hash, status, attempts, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, $8, $9)`,
          [row.id, row.userId, row.deviceId, row.label, row.platform, row.codeHash, row.pollHash, row.createdAt, row.expiresAt],
        );
        return true;
      });
    },

    async listPendingApprovals(userId, nowMs) {
      const { rows } = await pool.query(
        `SELECT id, label, platform, created_at, expires_at FROM approvals
         WHERE user_id = $1 AND status = 'pending' AND expires_at > $2 ORDER BY created_at`,
        [userId, nowMs],
      );
      return rows.map((r) => ({ id: r.id, label: r.label, platform: r.platform, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at) }));
    },

    /** Состояние запроса для нового устройства. Ничего не выдаёт: выдача — в consumeApproval. */
    async readApprovalForClaim(id, pollHash, nowMs) {
      return inTransaction(async (c) => {
        const { rows } = await c.query(
          'SELECT user_id, device_id, label, poll_hash, status, expires_at FROM approvals WHERE id = $1 FOR UPDATE',
          [id],
        );
        const a = rows[0];
        if (!a || !sameHex(a.poll_hash, pollHash) || a.status === 'consumed') return { status: 'unknown' };
        if (a.status === 'denied') return { status: 'denied' };
        if (a.status === 'pending' && nowMs >= Number(a.expires_at)) {
          await c.query(`UPDATE approvals SET status = 'expired' WHERE id = $1`, [id]);
          return { status: 'expired' };
        }
        if (a.status === 'expired') return { status: 'expired' };
        if (a.status === 'pending') return { status: 'pending' };
        return { status: 'approved', userId: a.user_id, deviceId: a.device_id, label: a.label };
      });
    },

    /** Выдача результата один раз: условное обновление, побеждает только один запрос. */
    async consumeApproval(id) {
      const { rowCount } = await pool.query(`UPDATE approvals SET status = 'consumed' WHERE id = $1 AND status = 'approved'`, [id]);
      return rowCount === 1;
    },

    /** Подтверждение или отказ владельцем. Проверка кода и счётчик попыток идут под блокировкой запроса. */
    async decideApproval(id, userId, action, { now: nowMs, codeMatches, max }) {
      return inTransaction(async (c) => {
        const { rows } = await c.query(
          'SELECT user_id, label, code_hash, status, attempts, expires_at FROM approvals WHERE id = $1 FOR UPDATE',
          [id],
        );
        const a = rows[0];
        if (!a || a.user_id !== userId || a.status !== 'pending' || nowMs >= Number(a.expires_at)) return { status: 'unknown' };
        if (action === 'deny') {
          await c.query(`UPDATE approvals SET status = 'denied' WHERE id = $1`, [id]);
          return { status: 'denied', label: a.label };
        }
        if (!codeMatches(a.code_hash)) {
          const attempts = a.attempts + 1;
          const denied = attempts >= max;
          await c.query('UPDATE approvals SET attempts = $2, status = $3 WHERE id = $1', [id, attempts, denied ? 'denied' : 'pending']);
          return { status: 'wrong', denied, label: a.label };
        }
        await c.query(`UPDATE approvals SET status = 'approved' WHERE id = $1`, [id]);
        return { status: 'approved', label: a.label };
      });
    },

    /** Новый пароль после восстановления (D1). */
    async setPasswordHash(userId, passwordHash) {
      await pool.query('UPDATE accounts SET password_hash = $2 WHERE user_id = $1', [userId, passwordHash]);
    },

    /** Состояние восстановления пользователя. Меняется только через recoveryUpdate. */
    async recoveryGet(userId) {
      const { rows } = await pool.query('SELECT * FROM recovery WHERE user_id = $1', [userId]);
      return rows[0] ? fromRecoveryRow(rows[0]) : freshRecovery();
    },

    /** Изменение состояния под блокировкой строки: change(current) -> { next, result }. */
    async recoveryUpdate(userId, change) {
      return inTransaction(async (c) => {
        const acc = await c.query('SELECT 1 FROM accounts WHERE user_id = $1', [userId]);
        if (acc.rows.length === 0) return change(freshRecovery()).result;
        await c.query('INSERT INTO recovery (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        const { rows } = await c.query('SELECT * FROM recovery WHERE user_id = $1 FOR UPDATE', [userId]);
        const { next, result } = change(fromRecoveryRow(rows[0]));
        await c.query(
          `UPDATE recovery SET req_status = $2, req_started_at = $3, req_expires_at = $4, req_code_hash = $5,
             req_attempts = $6, window_started_at = $7, window_key_reset_at = $8, window_previous_hash = $9,
             identity_check = $10, identity_code_hash = $11, identity_attempts = $12, locked_until = $13, starts = $14, req_link_hash = $15, req_link_confirmed = $16
           WHERE user_id = $1`,
          [userId, next.reqStatus, next.reqStartedAt, next.reqExpiresAt, next.reqCodeHash, next.reqAttempts,
           next.windowStartedAt, next.windowKeyResetAt, next.windowPreviousHash, next.identityCheck,
           next.identityCodeHash, next.identityAttempts, next.lockedUntil, JSON.stringify(next.starts), next.reqLinkHash, next.reqLinkConfirmed],
        );
        return result;
      });
    },

    async recoveryUpdateWithOutbox(userId, change, enqueue) {
      return inTransaction(async (c) => {
        const acc = await c.query('SELECT 1 FROM accounts WHERE user_id = $1', [userId]);
        if (acc.rows.length === 0) return change(freshRecovery()).result;
        await c.query('INSERT INTO recovery (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        const { rows } = await c.query('SELECT * FROM recovery WHERE user_id = $1 FOR UPDATE', [userId]);
        const { next, result } = change(fromRecoveryRow(rows[0]));
        await c.query(
          `UPDATE recovery SET req_status = $2, req_started_at = $3, req_expires_at = $4, req_code_hash = $5,
             req_attempts = $6, window_started_at = $7, window_key_reset_at = $8, window_previous_hash = $9,
             identity_check = $10, identity_code_hash = $11, identity_attempts = $12, locked_until = $13, starts = $14, req_link_hash = $15, req_link_confirmed = $16
           WHERE user_id = $1`,
          [userId, next.reqStatus, next.reqStartedAt, next.reqExpiresAt, next.reqCodeHash, next.reqAttempts,
           next.windowStartedAt, next.windowKeyResetAt, next.windowPreviousHash, next.identityCheck,
           next.identityCodeHash, next.identityAttempts, next.lockedUntil, JSON.stringify(next.starts), next.reqLinkHash, next.reqLinkConfirmed],
        );
        if (enqueue) await enqueue(c, result);
        return result;
      });
    },

    async recoveryCancelWithOutbox(userId, passwordHash, change, enqueue) {
      return inTransaction(async (client) => {
        const account = await client.query('SELECT 1 FROM accounts WHERE user_id = $1', [userId]);
        if (account.rows.length === 0) return change(freshRecovery()).result;
        if (passwordHash) await client.query('UPDATE accounts SET password_hash = $2 WHERE user_id = $1', [userId, passwordHash]);
        await client.query('INSERT INTO recovery (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        const { rows } = await client.query('SELECT * FROM recovery WHERE user_id = $1 FOR UPDATE', [userId]);
        const { next, result } = change(fromRecoveryRow(rows[0]));
        await client.query(
          `UPDATE recovery SET req_status = $2, req_started_at = $3, req_expires_at = $4, req_code_hash = $5,
             req_attempts = $6, window_started_at = $7, window_key_reset_at = $8, window_previous_hash = $9,
             identity_check = $10, identity_code_hash = $11, identity_attempts = $12, locked_until = $13, starts = $14, req_link_hash = $15, req_link_confirmed = $16
           WHERE user_id = $1`,
          [userId, next.reqStatus, next.reqStartedAt, next.reqExpiresAt, next.reqCodeHash, next.reqAttempts,
           next.windowStartedAt, next.windowKeyResetAt, next.windowPreviousHash, next.identityCheck,
           next.identityCodeHash, next.identityAttempts, next.lockedUntil, JSON.stringify(next.starts), next.reqLinkHash, next.reqLinkConfirmed],
        );
        await client.query('DELETE FROM recovery_cancel_codes WHERE user_id = $1', [userId]);
        if (enqueue) await enqueue(client, result);
        return result;
      });
    },

    async recoveryCompleteWithOutbox(userId, passwordHash, change, cancelCodeHash, enqueue) {
      return inTransaction(async (client) => {
        await client.query('UPDATE accounts SET password_hash = $2 WHERE user_id = $1', [userId, passwordHash]);
        await client.query('INSERT INTO recovery (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        const { rows } = await client.query('SELECT * FROM recovery WHERE user_id = $1 FOR UPDATE', [userId]);
        if (rows.length === 0) throw new Error('recovery account not found');
        const { next, result } = change(fromRecoveryRow(rows[0]));
        await client.query(
          `UPDATE recovery SET req_status = $2, req_started_at = $3, req_expires_at = $4, req_code_hash = $5,
             req_attempts = $6, window_started_at = $7, window_key_reset_at = $8, window_previous_hash = $9,
             identity_check = $10, identity_code_hash = $11, identity_attempts = $12, locked_until = $13, starts = $14, req_link_hash = $15, req_link_confirmed = $16
           WHERE user_id = $1`,
          [userId, next.reqStatus, next.reqStartedAt, next.reqExpiresAt, next.reqCodeHash, next.reqAttempts,
           next.windowStartedAt, next.windowKeyResetAt, next.windowPreviousHash, next.identityCheck,
           next.identityCodeHash, next.identityAttempts, next.lockedUntil, JSON.stringify(next.starts), next.reqLinkHash, next.reqLinkConfirmed],
        );
        await client.query(
          `INSERT INTO recovery_cancel_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at`,
          [userId, cancelCodeHash, result],
        );
        if (enqueue) await enqueue(client, result);
        return result;
      });
    },

    /** Только хэши кодов и статусы: для снимка состояния в тестах. */
    async recoveryHashes() {
      const { rows } = await pool.query('SELECT user_id, req_status, req_code_hash FROM recovery WHERE req_code_hash IS NOT NULL');
      return Object.fromEntries(rows.map((r) => [r.user_id, { status: r.req_status, codeHash: r.req_code_hash }]));
    },

    // ---- ключи устройств ----
    async putDeviceKeys(deviceKey, keys) {
      await pool.query(
        `INSERT INTO device_keys (device_key, body) VALUES ($1, $2::jsonb)
         ON CONFLICT (device_key) DO UPDATE SET body = EXCLUDED.body`,
        [deviceKey, JSON.stringify(keys)],
      );
    },

    async queryDeviceKeys(userId) {
      const { rows } = await pool.query(
        `SELECT d.device_id, k.body FROM device_keys k JOIN devices d ON d.device_key = k.device_key
         WHERE d.user_id = $1 AND NOT d.revoked`,
        [userId],
      );
      return Object.fromEntries(rows.map((r) => [r.device_id, r.body]));
    },
    async queryDeviceKeysForUser(requesterId, targetUserId) {
      return inTransaction(async (c) => {
        if (requesterId !== targetUserId) {
          const { rows: sameOrg } = await c.query(
            `SELECT 1
               FROM org_members sender
               JOIN organizations sender_org ON sender_org.org_id = sender.org_id
               JOIN org_members recipient ON recipient.org_id = sender.org_id AND recipient.user_id = $2
               JOIN organizations recipient_org ON recipient_org.org_id = recipient.org_id
              WHERE sender.user_id = $1
                AND sender_org.status = 'approved'
                AND recipient_org.status = 'approved'
              LIMIT 1 FOR SHARE OF sender, sender_org, recipient, recipient_org`,
            [requesterId, targetUserId],
          );
          if (!sameOrg.length) {
            const { rows: linked } = await c.query(
              `SELECT 1
                 FROM org_members sender
                 JOIN organizations sender_org ON sender_org.org_id = sender.org_id
                 JOIN org_members recipient ON recipient.user_id = $2
                 JOIN organizations recipient_org ON recipient_org.org_id = recipient.org_id
                 JOIN org_links link
                   ON link.status = 'active'
                  AND ((link.org_a = sender.org_id AND link.org_b = recipient.org_id)
                    OR (link.org_b = sender.org_id AND link.org_a = recipient.org_id))
                WHERE sender.user_id = $1
                  AND sender_org.status = 'approved'
                  AND recipient_org.status = 'approved'
                LIMIT 1 FOR SHARE OF sender, sender_org, recipient, recipient_org, link`,
              [requesterId, targetUserId],
            );
            if (!linked.length) return null;
          }
        }
        const { rows } = await c.query(
          `SELECT d.device_id, k.body FROM device_keys k JOIN devices d ON d.device_key = k.device_key
           WHERE d.user_id = $1 AND NOT d.revoked FOR SHARE OF d`,
          [targetUserId],
        );
        return Object.fromEntries(rows.map((r) => [r.device_id, r.body]));
      });
    },

    async countOneTimeKeys(deviceKey, prefix) {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM one_time_keys WHERE device_key = $1 AND left(name, char_length($2)) = $2',
        [deviceKey, prefix],
      );
      return rows[0].n;
    },

    // ---- беседы ----
    async createRoom(roomId, owner, memberIds, opts = {}) {
      if ([...new Set(memberIds)].some((userId) => userId !== owner)) return { status: 'mls_commit_required' };
      return inTransaction(async (c) => {
        const orgId = opts.orgId ?? 'org-default';
        const { rows: orgRows } = await c.query(
          'SELECT status FROM organizations WHERE org_id = $1 FOR SHARE',
          [orgId],
        );
        if (!orgRows[0] || orgRows[0].status !== 'approved') return { status: 'org_not_approved' };
        for (const userId of [...new Set(memberIds)].sort()) {
          const { rows: directMembership } = await c.query(
            'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2 FOR SHARE',
            [orgId, userId],
          );
          if (directMembership.length) continue;
          const { rows: linkedMembership } = await c.query(
            `SELECT 1
               FROM org_members member
               JOIN organizations member_org ON member_org.org_id = member.org_id
               JOIN org_links link
                 ON link.status = 'active'
                AND ((link.org_a = member.org_id AND link.org_b = $1)
                  OR (link.org_b = member.org_id AND link.org_a = $1))
              WHERE member.user_id = $2 AND member_org.status = 'approved'
              LIMIT 1 FOR SHARE OF member, member_org, link`,
            [orgId, userId],
          );
          if (!linkedMembership.length) return { status: 'org_not_member', userId };
        }
        const ins = await c.query(
          'INSERT INTO rooms (room_id, owner, kind, name, org_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (room_id) DO NOTHING',
          [roomId, owner, opts.kind ?? 'group', opts.name ?? null, orgId],
        );
        if (ins.rowCount === 0) return false;
        const { rows } = await c.query("SELECT value FROM counters WHERE name = 'event_seq' FOR UPDATE");
        const seq = Number(rows[0].value);
        for (const m of [...new Set(memberIds)]) {
          await c.query('INSERT INTO room_members (room_id, user_id, is_admin, joined_seq, capabilities) VALUES ($1, $2, FALSE, $3, $4::text[])', [roomId, m, seq, [...DEFAULT_MEMBER_CAPABILITIES]]);
        }
        return true;
      });
    },

    async createOrOpenDirectConversation({ requester, target, roomId, createdAt }) {
      const requesterFirst = Buffer.compare(Buffer.from(requester, 'utf8'), Buffer.from(target, 'utf8')) < 0;
      const userA = requesterFirst ? requester : target;
      const userB = requesterFirst ? target : requester;
      return inTransaction(async (c) => {
        const { rows: lockedAccounts } = await c.query(
          'SELECT user_id FROM accounts WHERE user_id = ANY($1::text[]) ORDER BY user_id FOR SHARE',
          [[userA, userB]],
        );
        if (lockedAccounts.length !== 2) return { status: 'unknown_user' };
        const { rows: blocked } = await c.query(
          'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) FOR SHARE',
          [userA, userB],
        );
        if (blocked.length) return { status: 'blocked' };
        const roomInsert = await c.query(
          "INSERT INTO rooms (room_id, owner, kind, name, org_id) VALUES ($1, $2, 'direct', NULL, NULL) ON CONFLICT (room_id) DO NOTHING",
          [roomId, requester],
        );
        if (roomInsert.rowCount !== 1) return { status: 'room_id_conflict' };
        const directInsert = await c.query(
          "INSERT INTO direct_conversations (room_id, user_a, user_b, created_by, status, created_at) VALUES ($1, $2, $3, $4, 'provisioning', $5) ON CONFLICT (user_a, user_b) DO NOTHING RETURNING room_id",
          [roomId, userA, userB, requester, createdAt],
        );
        if (directInsert.rowCount !== 1) {
          const { rows } = await c.query(
            'SELECT room_id, user_a, user_b, created_by, status, created_at FROM direct_conversations WHERE user_a = $1 AND user_b = $2',
            [userA, userB],
          );
          await c.query('DELETE FROM rooms WHERE room_id = $1', [roomId]);
          if (!rows[0]) return { status: 'retry' };
          const row = rows[0];
          return {
            status: row.status,
            roomId: row.room_id,
            userA: row.user_a,
            userB: row.user_b,
            createdBy: row.created_by,
            createdAt: Number(row.created_at),
            isCreator: row.created_by === requester,
            created: false,
          };
        }
        const { rows: counterRows } = await c.query("SELECT value FROM counters WHERE name = 'event_seq' FOR UPDATE");
        await c.query(
          'INSERT INTO room_members (room_id, user_id, is_admin, joined_seq, capabilities) VALUES ($1, $2, FALSE, $3, $4::text[])',
          [roomId, requester, Number(counterRows[0].value), [...DEFAULT_MEMBER_CAPABILITIES]],
        );
        return { status: 'provisioning', roomId, userA, userB, createdBy: requester, createdAt, isCreator: true, created: true };
      });
    },

    async directConversation(roomId) {
      const { rows } = await pool.query(
        'SELECT room_id, user_a, user_b, created_by, status, created_at FROM direct_conversations WHERE room_id = $1',
        [roomId],
      );
      const row = rows[0];
      return row ? {
        roomId: row.room_id,
        userA: row.user_a,
        userB: row.user_b,
        createdBy: row.created_by,
        status: row.status,
        createdAt: Number(row.created_at),
      } : null;
    },

    async getRoom(roomId) {
      const head = await pool.query('SELECT owner, name, visibility, join_policy, description, background_color, avatar_asset_id, cover_asset_id, background_asset_id FROM rooms WHERE room_id = $1', [roomId]);
      if (head.rows.length === 0) return null;
      const { rows } = await pool.query('SELECT user_id, is_admin, joined_seq, capabilities, read_seq FROM room_members WHERE room_id = $1 ORDER BY id', [roomId]);
      return {
        owner: head.rows[0].owner,
        admins: rows.filter((r) => r.is_admin).map((r) => r.user_id),
        members: rows.map((r) => r.user_id),
        joinedSeq: Object.fromEntries(rows.map((r) => [r.user_id, Number(r.joined_seq)])),
        capabilities: Object.fromEntries(rows.map((r) => [r.user_id, r.capabilities ?? []])),
        name: head.rows[0].name, visibility: head.rows[0].visibility, joinPolicy: head.rows[0].join_policy,
        description: head.rows[0].description, backgroundColor: head.rows[0].background_color,
        avatarAssetId: head.rows[0].avatar_asset_id, coverAssetId: head.rows[0].cover_asset_id, backgroundAssetId: head.rows[0].background_asset_id,
        readUpTo: Object.fromEntries(rows.map((r) => [r.user_id, Number(r.read_seq)])),
      };
    },

    async transferRoomOwner(roomId, newOwner) {
      await inTransaction(async (c) => {
        const { rows: roomOrg } = await c.query('SELECT org_id FROM rooms WHERE room_id = $1', [roomId]);
        if (!roomOrg[0]) return;
        await c.query('SELECT org_id FROM organizations WHERE org_id = $1 FOR SHARE', [roomOrg[0].org_id]);
        const { rows } = await c.query('SELECT owner FROM rooms WHERE room_id = $1 FOR UPDATE', [roomId]);
        if (rows.length === 0) return false;
        const { rows: membership } = await c.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 FOR SHARE',
          [roomId, newOwner],
        );
        if (!membership.length) return false;
        const previous = rows[0].owner;
        await c.query('UPDATE rooms SET owner = $2 WHERE room_id = $1', [roomId, newOwner]);
        await c.query('UPDATE room_members SET is_admin = FALSE WHERE room_id = $1 AND user_id IN ($2, $3)', [roomId, newOwner, previous]);
        return true;
      });
    },
    async channelNameTaken(name, exceptRoomId) {
      const { rows } = await pool.query(
        "SELECT 1 FROM rooms WHERE kind = 'channel' AND lower(regexp_replace(name, '\\s+', ' ', 'g')) = $1 AND room_id IS DISTINCT FROM $2 LIMIT 1",
        [channelNameKey(name), exceptRoomId ?? null],
      );
      return rows.length > 0;
    },

    // Room-list projection: encrypted last activity and unread count only; never project plaintext.
    async roomsOfUser(userId) {
      const { rows } = await pool.query(
        `SELECT r.room_id, r.kind,
                COALESCE(r.name, NULLIF(peer.nickname, '')) AS name,
                CASE WHEN dc.room_id IS NULL THEN NULL
                     WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END AS peer_user_id,
                (peer_contact.owner_id IS NOT NULL) AS is_peer_contact,
                (incoming.status = 'pending') AS incoming_contact_request,
                EXISTS (
                  SELECT 1 FROM user_blocks b
                   WHERE (b.blocker_id = $1 AND b.blocked_id = CASE WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END)
                      OR (b.blocker_id = CASE WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END AND b.blocked_id = $1)
                ) AS is_blocked,
                r.owner, m.is_admin,
                last_message.seq AS last_event_seq,
                last_message.origin_ts AS last_event_at,
                COALESCE(unread.unread_count, 0)::integer AS unread_count
           FROM room_members m
           JOIN rooms r ON r.room_id = m.room_id
           LEFT JOIN direct_conversations dc ON dc.room_id = r.room_id
           LEFT JOIN profiles peer
             ON peer.user_id = CASE WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END
           LEFT JOIN contacts peer_contact
             ON peer_contact.owner_id = $1
            AND peer_contact.contact_user_id = CASE WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END
           LEFT JOIN contact_requests incoming
             ON incoming.requester_id = CASE WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END
            AND incoming.recipient_id = $1 AND incoming.status = 'pending'

           LEFT JOIN LATERAL (
             SELECT e.seq, e.origin_ts
               FROM room_events e
              WHERE e.room_id = r.room_id
                AND e.type = 'm.room.encrypted'
                AND e.seq > m.joined_seq
              ORDER BY e.seq DESC
              LIMIT 1
           ) last_message ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::integer AS unread_count
               FROM room_events e
              WHERE e.room_id = r.room_id
                AND e.type = 'm.room.encrypted'
                AND e.seq > GREATEST(m.read_seq, m.joined_seq)
                AND e.sender <> $1
           ) unread ON TRUE
          WHERE m.user_id = $1
          ORDER BY COALESCE(last_message.seq, 0) DESC, r.room_id`,
        [userId],
      );
      return rows.map((r) => ({
        roomId: r.room_id,
        kind: r.kind,
        name: r.name,
        peerUserId: r.peer_user_id ?? null,
        isPeerContact: !!r.is_peer_contact,
        incomingContactRequest: !!r.incoming_contact_request,
        isBlocked: !!r.is_blocked,
        owner: r.owner,
        isAdmin: r.is_admin,
        lastEventSeq: r.last_event_seq === null ? null : Number(r.last_event_seq),
        lastEventAt: r.last_event_at === null ? null : Number(r.last_event_at),
        unreadCount: Number(r.unread_count ?? 0),
      }));
    },

    async listContacts(userId) {
      const [contacts, requests] = await Promise.all([
        pool.query(
          `SELECT c.contact_user_id AS user_id, NULLIF(p.nickname, '') AS display_name, c.created_at
             FROM contacts c LEFT JOIN profiles p ON p.user_id = c.contact_user_id
            WHERE c.owner_id = $1 ORDER BY display_name, c.contact_user_id`,
          [userId],
        ),
        pool.query(
          `SELECT r.requester_id AS user_id, COALESCE(NULLIF(p.nickname, ''), r.requester_id) AS display_name,
                  r.room_id, r.created_at
             FROM contact_requests r LEFT JOIN profiles p ON p.user_id = r.requester_id
            WHERE r.recipient_id = $1 AND r.status = 'pending'
            ORDER BY r.created_at, r.requester_id`,
          [userId],
        ),
      ]);
      return {
        contacts: contacts.rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, createdAt: Number(r.created_at) })),
        incomingRequests: requests.rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, roomId: r.room_id, createdAt: Number(r.created_at) })),
      };
    },

    async acceptContactRequest(recipientId, requesterId, nowMs) {
      return inTransaction(async (c) => {
        const { rows: requestRows } = await c.query(
          'SELECT status FROM contact_requests WHERE requester_id = $1 AND recipient_id = $2 FOR UPDATE',
          [requesterId, recipientId],
        );
        if (!requestRows[0]) return { status: 'not_found' };
        if (requestRows[0].status === 'blocked') return { status: 'blocked' };
        if (requestRows[0].status === 'accepted') return { status: 'accepted' };
        const { rows: blocks } = await c.query(
          'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) FOR SHARE',
          [recipientId, requesterId],
        );
        if (blocks.length) return { status: 'blocked' };
        await c.query(
          'INSERT INTO contacts (owner_id, contact_user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [recipientId, requesterId, nowMs],
        );
        await c.query(
          "UPDATE contact_requests SET status = 'accepted', decided_at = $3 WHERE requester_id = $1 AND recipient_id = $2 AND status = 'pending'",
          [requesterId, recipientId, nowMs],
        );
        return { status: 'accepted' };
      });
    },

    async blockUser(blockerId, blockedId, nowMs) {
      return inTransaction(async (c) => {
        const { rows: accounts } = await c.query(
          'SELECT user_id FROM accounts WHERE user_id = ANY($1::text[]) ORDER BY user_id FOR UPDATE',
          [[blockerId, blockedId]],
        );
        if (accounts.length !== 2) return { status: 'unknown_user' };
        await c.query(
          'SELECT room_id FROM direct_conversations WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1) ORDER BY room_id FOR UPDATE',
          [blockerId, blockedId],
        );
        await c.query(
          'INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [blockerId, blockedId, nowMs],
        );
        await c.query(
          'DELETE FROM contacts WHERE (owner_id = $1 AND contact_user_id = $2) OR (owner_id = $2 AND contact_user_id = $1)',
          [blockerId, blockedId],
        );
        await c.query(
          "UPDATE contact_requests SET status = 'blocked', decided_at = $3 WHERE ((requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1)) AND status = 'pending'",
          [blockerId, blockedId, nowMs],
        );
        return { status: 'blocked' };
      });
    },

  async roomKind(roomId) {
      const { rows } = await pool.query('SELECT kind FROM rooms WHERE room_id = $1', [roomId]);
      return rows[0]?.kind ?? null;
    },

    async setRoomName(roomId, name) {
      const { rowCount } = await pool.query('UPDATE rooms SET name = $2 WHERE room_id = $1', [roomId, name]);
      return rowCount === 1;
    },

    async mlsRecordDeviceRemovals(userId, deviceId, nowMs) {
      await pool.query(
        "INSERT INTO mls_device_removals (room_id, user_id, device_id, created_at) SELECT g.room_id, $1, $2, $3 FROM mls_groups g JOIN room_members m ON m.room_id = g.room_id WHERE m.user_id = $1 AND g.epoch > 0 ON CONFLICT (room_id, user_id, device_id) DO NOTHING",
        [userId, deviceId, nowMs],
      );
    },

    async findClientMessage(roomId, userId, clientId) {
      const { rows } = await pool.query('SELECT seq FROM mls_client_messages WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3 AND seq IS NOT NULL', [roomId, userId, clientId]);
      return rows[0] ? Number(rows[0].seq) : null;
    },

    /**
     * Atomically reserves a client message ID, appends its room event and records
     * the resulting sequence. Concurrent retries serialize on the unique key;
     * a failed transaction leaves neither a pending reservation nor an event.
     */
    async appendClientMessageEvent(roomId, userId, clientId, sender, type, content, nowMs, afterAppend = null) {
      return inTransaction(async (c) => {
        const previous = await c.query(
          'SELECT seq FROM mls_client_messages WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3 FOR UPDATE',
          [roomId, userId, clientId],
        );
        if (previous.rows[0]) {
          if (previous.rows[0].seq === null) return { state: 'pending' };
          return { state: 'done', seq: Number(previous.rows[0].seq) };
        }
        const access = await lockRoomWriteAccess(c, roomId, sender);
        if (access) return { state: access };
        const inserted = await c.query(
          'INSERT INTO mls_client_messages (room_id, user_id, client_message_id, seq) VALUES ($1, $2, $3, NULL) ON CONFLICT DO NOTHING RETURNING client_message_id',
          [roomId, userId, clientId],
        );
        if (inserted.rowCount !== 1) {
          const existing = await c.query(
            'SELECT seq FROM mls_client_messages WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3 FOR UPDATE',
            [roomId, userId, clientId],
          );
          if (existing.rows.length === 0 || existing.rows[0].seq === null) return { state: 'pending' };
          return { state: 'done', seq: Number(existing.rows[0].seq) };
        }

        const counter = await c.query("UPDATE counters SET value = value + 1 WHERE name = 'event_seq' RETURNING value");
        const seq = Number(counter.rows[0].value);
        await c.query(
          'INSERT INTO room_events (seq, room_id, sender, origin_ts, type, content) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
          [seq, roomId, sender, nowMs, type, JSON.stringify(content ?? null)],
        );
        if (afterAppend) await afterAppend(c, { seq, roomId, eventId: `${seq}` });
        if (type === 'm.room.encrypted') await createIncomingContactRequest(c, roomId, sender, nowMs);

        // A deterministic fault-injection seam used only by PostgreSQL tests.
        // It runs before the idempotency row is completed, inside the transaction.
        await testHooks.afterClientMessageEventInsert?.({ roomId, userId, clientId, seq });

        await c.query(
          'UPDATE mls_client_messages SET seq = $4 WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3',
          [roomId, userId, clientId, seq],
        );
        return { state: 'created', seq };
      });
    },

    async reserveClientMessage(roomId, userId, clientId) {
      const { rowCount } = await pool.query('INSERT INTO mls_client_messages (room_id, user_id, client_message_id, seq) VALUES ($1, $2, $3, NULL) ON CONFLICT DO NOTHING', [roomId, userId, clientId]);
      if (rowCount === 1) return { state: 'new' };
      const { rows } = await pool.query('SELECT seq FROM mls_client_messages WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3', [roomId, userId, clientId]);
      if (rows.length === 0 || rows[0].seq === null) return { state: 'pending' };
      return { state: 'done', seq: Number(rows[0].seq) };
    },
    async completeClientMessage(roomId, userId, clientId, seq) {
      await pool.query('UPDATE mls_client_messages SET seq = $4 WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3', [roomId, userId, clientId, seq]);
    },
    async releaseClientMessage(roomId, userId, clientId) {
      await pool.query('DELETE FROM mls_client_messages WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3 AND seq IS NULL', [roomId, userId, clientId]);
    },
async mlsPendingRemovalsFor(userId) {
      const { rows } = await pool.query('SELECT room_id, device_id FROM mls_device_removals WHERE user_id = $1 AND done_at IS NULL ORDER BY id', [userId]);
      return rows.map((r) => ({ roomId: r.room_id, deviceId: r.device_id }));
    },

    async mlsPendingRemovalDevices(roomId) {
      const { rows } = await pool.query('SELECT device_id FROM mls_device_removals WHERE room_id = $1 AND done_at IS NULL', [roomId]);
      return rows.map((r) => r.device_id);
    },
    async setRoomAdmin(roomId, userId, isAdmin) {
      if (isAdmin) {
        await pool.query(
          'UPDATE room_members SET is_admin = TRUE, capabilities = ARRAY(SELECT DISTINCT unnest(capabilities || $3::text[])) WHERE room_id = $1 AND user_id = $2',
          [roomId, userId, [...DEFAULT_ADMIN_CAPABILITIES]],
        );
      } else {
        await pool.query(
          'UPDATE room_members SET is_admin = FALSE, capabilities = $3::text[] WHERE room_id = $1 AND user_id = $2',
          [roomId, userId, [...DEFAULT_MEMBER_CAPABILITIES]],
        );
      }
    },

    async setRoomCapabilities(roomId, userId, list) {
      await pool.query('UPDATE room_members SET capabilities = $3::text[] WHERE room_id = $1 AND user_id = $2', [roomId, userId, list]);
    },

    async setRoomAppearance(roomId, patch) {
      const columns = { description: 'description', backgroundColor: 'background_color', avatarAssetId: 'avatar_asset_id', coverAssetId: 'cover_asset_id', backgroundAssetId: 'background_asset_id' };
      const sets = [];
      const params = [roomId];
      for (const [key, column] of Object.entries(columns)) {
        if (patch[key] !== undefined) {
          params.push(patch[key]);
          sets.push(`${column} = $${params.length}`);
        }
      }
      if (sets.length > 0) await pool.query(`UPDATE rooms SET ${sets.join(', ')} WHERE room_id = $1`, params);
    },

    async addRoomAsset(roomId, a) {
      await pool.query(
        'INSERT INTO group_assets (asset_id, room_id, kind, content_type, encrypted, size_bytes, data, shortcode, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [a.assetId, roomId, a.kind, a.contentType, a.encrypted, a.data.length, a.data, a.shortcode, a.createdBy, a.createdAt],
      );
    },

    async getRoomAsset(roomId, assetId) {
      const { rows } = await pool.query('SELECT asset_id, kind, content_type, encrypted, data, shortcode FROM group_assets WHERE room_id = $1 AND asset_id = $2', [roomId, assetId]);
      if (rows.length === 0) return null;
      const r = rows[0];
      return { assetId: r.asset_id, kind: r.kind, contentType: r.content_type, encrypted: r.encrypted, data: r.data, shortcode: r.shortcode };
    },

    /** Удаление файла; ссылки на него в оформлении сбрасываются внешним ключом. */
    async deleteRoomAsset(roomId, assetId) {
      const { rowCount } = await pool.query('DELETE FROM group_assets WHERE room_id = $1 AND asset_id = $2', [roomId, assetId]);
      return rowCount === 1;
    },

    async listRoomStickers(roomId) {
      const { rows } = await pool.query("SELECT asset_id, shortcode, encrypted FROM group_assets WHERE room_id = $1 AND kind = 'sticker' ORDER BY created_at, asset_id", [roomId]);
      return rows.map((r) => ({ assetId: r.asset_id, shortcode: r.shortcode, encrypted: r.encrypted }));
    },

    async listRoomAssets(roomId) {
      const { rows } = await pool.query('SELECT asset_id, kind, encrypted, shortcode FROM group_assets WHERE room_id = $1 ORDER BY created_at, asset_id', [roomId]);
      return rows.map((r) => ({ assetId: r.asset_id, kind: r.kind, encrypted: r.encrypted, shortcode: r.shortcode }));
    },

    /** Замена содержимого файла тем же идентификатором: ссылки на него остаются действительными. */
    async replaceRoomAsset(roomId, assetId, patch) {
      const { rowCount } = await pool.query(
        'UPDATE group_assets SET content_type = $3, encrypted = $4, size_bytes = $5, data = $6 WHERE room_id = $1 AND asset_id = $2',
        [roomId, assetId, patch.contentType, patch.encrypted, patch.data.length, patch.data],
      );
      return rowCount === 1;
    },

    async mlsAvailableCount(userId, deviceId, nowMs) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM mls_key_packages kp
           JOIN devices d ON d.user_id = kp.user_id AND d.device_id = kp.device_id
          WHERE kp.user_id = $1 AND kp.device_id = $2 AND NOT d.revoked
            AND kp.consumed_at IS NULL AND kp.last_resort = FALSE AND kp.created_at >= $3`,
        [userId, deviceId, nowMs - MLS_REGULAR_MAX_AGE_MS],
      );
      return rows[0].n;
    },
    async mlsStoreLastResort(userId, deviceId, bytes, createdAt) {
      return inTransaction(async (c) => {
        const { rows: devices } = await c.query(
          'SELECT revoked FROM devices WHERE user_id = $1 AND device_id = $2 FOR UPDATE',
          [userId, deviceId],
        );
        if (!devices[0] || devices[0].revoked) return false;
        await c.query('DELETE FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND last_resort = TRUE', [userId, deviceId]);
        await c.query('INSERT INTO mls_key_packages (user_id, device_id, package, created_at, last_resort) VALUES ($1, $2, $3, $4, TRUE)', [userId, deviceId, bytes, createdAt]);
        return true;
      });
    },

    async mlsStoreKeyPackages(userId, deviceId, packages, createdAt, maxUnused) {
      return inTransaction(async (c) => {
        const { rows: devices } = await c.query(
          'SELECT revoked FROM devices WHERE user_id = $1 AND device_id = $2 FOR UPDATE',
          [userId, deviceId],
        );
        if (!devices[0] || devices[0].revoked) return { ok: false, reason: 'device_revoked' };
        const { rows: counts } = await c.query(
          'SELECT COUNT(*)::int AS n FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND consumed_at IS NULL AND last_resort = FALSE AND created_at >= $3',
          [userId, deviceId, createdAt - MLS_REGULAR_MAX_AGE_MS],
        );
        if (counts[0].n + packages.length > maxUnused) return { ok: false, reason: 'package_limit' };
        for (const bytes of packages) {
          await c.query('INSERT INTO mls_key_packages (user_id, device_id, package, created_at) VALUES ($1, $2, $3, $4)', [userId, deviceId, bytes, createdAt]);
        }
        return { ok: true };
      });
    },

    /** Durable KeyPackage reservation. Repeated claim IDs return the exact same package set. */
    async mlsClaimKeyPackages(targetUserId, requesterUserId, requesterDeviceId, claimId, roomId, nowMs) {
      return inTransaction(async (c) => {
        if (roomId) {
          // Direct conversations are personal and are authorized by their canonical pair.
          // Group/channel claims lock the cross-org link before the room row, matching revokeOrgLink.
          const { rows: roomLookup } = await c.query(
            'SELECT org_id, owner, kind FROM rooms WHERE room_id = $1',
            [roomId],
          );
          if (!roomLookup[0]) return { ok: false, reason: 'room_not_found' };
          if (roomLookup[0].kind === 'direct') {
            const { rows: pairAccounts } = await c.query(
              'SELECT user_id FROM accounts WHERE user_id = ANY($1::text[]) ORDER BY user_id FOR SHARE',
              [[requesterUserId, targetUserId]],
            );
            if (pairAccounts.length !== 2) return { ok: false, reason: 'not_authorized' };
            const { rows: conversations } = await c.query(
              'SELECT user_a, user_b, created_by, status FROM direct_conversations WHERE room_id = $1 FOR SHARE',
              [roomId],
            );
            const conversation = conversations[0];
            const counterpart = conversation?.user_a === requesterUserId
              ? conversation.user_b
              : conversation?.user_b === requesterUserId ? conversation.user_a : null;
            if (!conversation || conversation.status !== 'provisioning'
              || conversation.created_by !== requesterUserId || roomLookup[0].owner !== requesterUserId
              || counterpart !== targetUserId) {
              return { ok: false, reason: 'not_authorized' };
            }
            const { rows: blocked } = await c.query(
              'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) FOR SHARE',
              [requesterUserId, targetUserId],
            );
            if (blocked.length) return { ok: false, reason: 'user_blocked' };
            const { rows: lockedRoom } = await c.query(
              "SELECT kind FROM rooms WHERE room_id = $1 FOR SHARE",
              [roomId],
            );
            if (!lockedRoom[0] || lockedRoom[0].kind !== 'direct') return { ok: false, reason: 'room_not_found' };
            const { rows: inviterMembership } = await c.query(
              'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2 FOR SHARE',
              [roomId, requesterUserId],
            );
            if (!inviterMembership.length) return { ok: false, reason: 'invite_capability_required' };
          } else {
            const roomOrgId = roomLookup[0].org_id;
            const { rows: orgRows } = await c.query(
              'SELECT status FROM organizations WHERE org_id = $1 FOR SHARE',
              [roomOrgId],
            );
            if (!orgRows[0] || orgRows[0].status !== 'approved') return { ok: false, reason: 'org_not_approved' };
            const requesterAllowed = await lockUserOrgAccess(c, requesterUserId, roomOrgId);
            const targetAllowed = await lockUserOrgAccess(c, targetUserId, roomOrgId);
            if (!requesterAllowed || !targetAllowed) return { ok: false, reason: 'not_authorized' };
            const { rows: lockedRoom } = await c.query(
              'SELECT org_id, owner FROM rooms WHERE room_id = $1 FOR SHARE',
              [roomId],
            );
            if (!lockedRoom[0] || lockedRoom[0].org_id !== roomOrgId) return { ok: false, reason: 'room_not_found' };
            const { rows: inviterMembership } = await c.query(
              'SELECT capabilities FROM room_members WHERE room_id = $1 AND user_id = $2 FOR SHARE',
              [roomId, requesterUserId],
            );
            if (lockedRoom[0].owner !== requesterUserId
              && (!inviterMembership[0] || !inviterMembership[0].capabilities.includes('invite_members'))) {
              return { ok: false, reason: 'invite_capability_required' };
            }
          }
        } else if (!(await lockUsersShareOrgOrLink(c, requesterUserId, targetUserId))) {
          return { ok: false, reason: 'not_authorized' };
        }
        // Lock active target devices before the claim row so device revocation and package
        // reservation have a consistent lock order and cannot replay a revoked device package.
        const { rows: activeDeviceRows } = await c.query(
          'SELECT device_id FROM devices WHERE user_id = $1 AND NOT revoked ORDER BY device_id FOR SHARE',
          [targetUserId],
        );
        const activeDeviceIds = new Set(activeDeviceRows.map((row) => row.device_id));
        await c.query(
          'INSERT INTO mls_key_package_claims (target_user_id, requester_user_id, requester_device_id, claim_id, room_id, state, result, created_at) VALUES ($1, $2, $3, $4, $5, \'reserved\', NULL, $6) ON CONFLICT (target_user_id, requester_user_id, requester_device_id, claim_id) DO NOTHING',
          [targetUserId, requesterUserId, requesterDeviceId, claimId, roomId ?? null, nowMs],
        );
        const { rows: claimRows } = await c.query(
          'SELECT room_id, state, result FROM mls_key_package_claims WHERE target_user_id = $1 AND requester_user_id = $2 AND requester_device_id = $3 AND claim_id = $4 FOR UPDATE',
          [targetUserId, requesterUserId, requesterDeviceId, claimId],
        );
        const claim = claimRows[0];
        if (!claim) throw new Error('KeyPackage claim intent was not persisted');
        if (claim.state === 'released') return { ok: false, reason: 'claim_released' };
        if (claim.state === 'committed') return { ok: false, reason: 'claim_committed' };
        if (roomId && claim.room_id && claim.room_id !== roomId) return { ok: false, reason: 'claim_room_mismatch' };
        if (roomId && !claim.room_id) {
          await c.query(
            'UPDATE mls_key_package_claims SET room_id = $5 WHERE target_user_id = $1 AND requester_user_id = $2 AND requester_device_id = $3 AND claim_id = $4',
            [targetUserId, requesterUserId, requesterDeviceId, claimId, roomId],
          );
        }
        if (claim.result !== null) {
          return {
            ok: true,
            packages: claim.result.filter((item) => activeDeviceIds.has(item.deviceId)).map((item) => ({
              deviceId: item.deviceId,
              packageId: item.packageId ?? null,
              package: Buffer.from(item.package, 'base64'),
            })),
          };
        }

        const { rows: devices } = await c.query(
          `SELECT DISTINCT device_id FROM mls_key_packages
            WHERE user_id = $1 AND device_id = ANY($2::text[]) AND consumed_at IS NULL
            ORDER BY device_id`,
          [targetUserId, [...activeDeviceIds]],
        );
        const out = [];
        for (const { device_id: deviceId } of devices) {
          const { rows } = await c.query(
            `UPDATE mls_key_packages SET consumed_at = $3
              WHERE id = (
                SELECT kp.id FROM mls_key_packages kp
                JOIN devices d ON d.user_id = kp.user_id AND d.device_id = kp.device_id
                WHERE kp.user_id = $1 AND kp.device_id = $2 AND NOT d.revoked
                  AND kp.consumed_at IS NULL AND kp.last_resort = FALSE AND kp.created_at >= $4
                ORDER BY kp.id LIMIT 1 FOR UPDATE OF kp SKIP LOCKED
              ) RETURNING id, package`,
            [targetUserId, deviceId, nowMs, nowMs - MLS_REGULAR_MAX_AGE_MS],
          );
          if (rows[0]) { out.push({ deviceId, packageId: Number(rows[0].id), package: rows[0].package }); continue; }
          const { rows: fallback } = await c.query(
            `SELECT kp.id, kp.package
               FROM mls_key_packages kp
               JOIN devices d ON d.user_id = kp.user_id AND d.device_id = kp.device_id
              WHERE kp.user_id = $1 AND kp.device_id = $2 AND NOT d.revoked
                AND kp.last_resort = TRUE AND kp.created_at >= $3
              ORDER BY kp.id DESC LIMIT 1`,
            [targetUserId, deviceId, nowMs - MLS_LAST_RESORT_MAX_AGE_MS],
          );
          if (fallback[0]) out.push({ deviceId, packageId: Number(fallback[0].id), package: fallback[0].package });
        }
        const stored = out.map((item) => ({
          deviceId: item.deviceId,
          packageId: item.packageId,
          package: item.package.toString('base64'),
        }));
        await c.query(
          'UPDATE mls_key_package_claims SET result = $5::jsonb WHERE target_user_id = $1 AND requester_user_id = $2 AND requester_device_id = $3 AND claim_id = $4',
          [targetUserId, requesterUserId, requesterDeviceId, claimId, JSON.stringify(stored)],
        );
        return { ok: true, packages: out };
      });
    },

    async mlsReleaseKeyPackageClaim(requesterUserId, requesterDeviceId, claimId, nowMs) {
      return inTransaction(async (c) => {
        const { rows } = await c.query(
          'SELECT target_user_id, state, result FROM mls_key_package_claims WHERE requester_user_id = $1 AND requester_device_id = $2 AND claim_id = $3 FOR UPDATE',
          [requesterUserId, requesterDeviceId, claimId],
        );
        if (rows.length === 0) return { ok: true, released: false };
        if (rows.length > 1) return { ok: false, reason: 'claim_ambiguous' };
        const claim = rows[0];
        if (claim.state === 'committed') return { ok: false, reason: 'claim_committed' };
        if (claim.state === 'released') return { ok: true, released: true };
        for (const item of claim.result ?? []) {
          if (item.packageId !== undefined && item.packageId !== null) {
            await c.query(
              'UPDATE mls_key_packages SET consumed_at = NULL WHERE id = $1 AND user_id = $2 AND consumed_at IS NOT NULL',
              [item.packageId, claim.target_user_id],
            );
          }
        }
        await c.query(
          'UPDATE mls_key_package_claims SET state = \'released\', released_at = $4 WHERE target_user_id = $1 AND requester_user_id = $2 AND requester_device_id = $3 AND claim_id = $5',
          [claim.target_user_id, requesterUserId, requesterDeviceId, nowMs, claimId],
        );
        return { ok: true, released: true };
      });
    },

    async ping() {
      await pool.query('SELECT 1');
      return true;
    },

    async createInvite(roomId, invite) {
      await pool.query(
        'INSERT INTO invites (invite_id, room_id, token_hash, created_by, created_at, expires_at, max_uses, uses, requires_approval, revoked) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, FALSE)',
        [invite.inviteId, roomId, invite.tokenHash, invite.createdBy, invite.createdAt, invite.expiresAt, invite.maxUses, invite.requiresApproval],
      );
    },

    async listInvites(roomId) {
      const { rows } = await pool.query(
        'SELECT invite_id, created_by, created_at, expires_at, max_uses, uses, requires_approval, revoked FROM invites WHERE room_id = $1 ORDER BY created_at',
        [roomId],
      );
      return rows.map((r) => ({
        inviteId: r.invite_id, createdBy: r.created_by, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at),
        maxUses: r.max_uses, uses: r.uses, requiresApproval: r.requires_approval, revoked: r.revoked,
      }));
    },

    async revokeInvite(roomId, inviteId) {
      const { rowCount } = await pool.query('UPDATE invites SET revoked = TRUE WHERE room_id = $1 AND invite_id = $2', [roomId, inviteId]);
      return rowCount === 1;
    },

    async findInviteByTokenHash(tokenHash) {
      const { rows } = await pool.query(
        'SELECT invite_id, room_id, created_by, created_at, expires_at, max_uses, uses, requires_approval, revoked FROM invites WHERE token_hash = $1',
        [tokenHash],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        inviteId: r.invite_id, roomId: r.room_id, createdBy: r.created_by, createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at), maxUses: r.max_uses, uses: r.uses, requiresApproval: r.requires_approval, revoked: r.revoked,
      };
    },

    /** Атомарно: проверка и увеличение счётчика в одном запросе, чтобы лимит не обходился параллельными запросами. */
    async useInvite(inviteId, nowMs) {
      const { rowCount } = await pool.query(
        'UPDATE invites SET uses = uses + 1 WHERE invite_id = $1 AND revoked = FALSE AND expires_at > $2 AND (max_uses IS NULL OR uses < max_uses)',
        [inviteId, nowMs],
      );
      return rowCount === 1;
    },

    async hasJoinRequest(roomId, userId) {
      const { rowCount } = await pool.query('SELECT 1 FROM join_requests WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
      return rowCount === 1;
    },

    async createJoinRequest(roomId, userId, nowMs) {
      const ins = await pool.query('INSERT INTO join_requests (room_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING', [roomId, userId, nowMs]);
      return ins.rowCount === 1;
    },

    async listJoinRequests(roomId) {
      const { rows } = await pool.query('SELECT user_id, created_at FROM join_requests WHERE room_id = $1 ORDER BY created_at', [roomId]);
      return rows.map((r) => ({ userId: r.user_id, created_at: Number(r.created_at) }));
    },

    async deleteJoinRequest(roomId, userId) {
      const del = await pool.query('DELETE FROM join_requests WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
      return del.rowCount === 1;
    },

    async clearJoinRequests(roomId) {
      await pool.query('DELETE FROM join_requests WHERE room_id = $1', [roomId]);
    },

    async searchPublicRooms(query, limit) {
      const pattern = `%${query.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
      const { rows } = await pool.query(
        `SELECT r.room_id, r.name, r.join_policy, (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.room_id) AS members
           FROM rooms r WHERE r.visibility = 'public' AND r.name IS NOT NULL AND lower(r.name) LIKE $1 ORDER BY r.name LIMIT $2`,
        [pattern, limit],
      );
      return rows.map((r) => ({ roomId: r.room_id, name: r.name, join_policy: r.join_policy, members: Number(r.members) }));
    },

    async setRoomSettings(roomId, settings) {
      await pool.query(
        'UPDATE rooms SET name = COALESCE($2, name), visibility = COALESCE($3, visibility), join_policy = COALESCE($4, join_policy) WHERE room_id = $1',
        [roomId, settings.name ?? null, settings.visibility ?? null, settings.joinPolicy ?? null],
      );
    },

    async setReadUpTo(roomId, userId, seq) {
      await pool.query('UPDATE room_members SET read_seq = GREATEST(read_seq, $3) WHERE room_id = $1 AND user_id = $2', [roomId, userId, seq]);
    },

    async roomLastSeq(roomId) {
      const { rows } = await pool.query('SELECT COALESCE(MAX(seq), 0) AS seq FROM room_events WHERE room_id = $1', [roomId]);
      return Number(rows[0].seq);
    },

    async findRoomEvent(roomId, seq) {
      const { rows } = await pool.query('SELECT seq, sender, type, content, origin_ts FROM room_events WHERE room_id = $1 AND seq = $2', [roomId, seq]);
      if (rows.length === 0) return null;
      return { seq: Number(rows[0].seq), sender: rows[0].sender, type: rows[0].type, content: rows[0].content, origin_ts: Number(rows[0].origin_ts) };
    },

    /** Удаляет сообщение и все его правки: тип меняется, содержимое заменяется пометкой. */
    async redactRoomEvent(roomId, seq, actor, nowMs) {
      await pool.query(
        "UPDATE room_events SET type = 'm.room.redacted', content = $3::jsonb WHERE room_id = $1 AND (seq = $2 OR (type = 'm.room.encrypted.replace' AND content->>'replaces' = $4))",
        [roomId, seq, JSON.stringify({ redacted_by: actor, redacted_at: nowMs }), `$${seq}`],
      );
      return true;
    },

    async appendRoomEvent(roomId, sender, type, content, nowMs, afterAppend = null) {
      return inTransaction(async (c) => {
        const access = await lockRoomWriteAccess(c, roomId, sender);
        if (access) return { state: access };
        const { rows } = await c.query("UPDATE counters SET value = value + 1 WHERE name = 'event_seq' RETURNING value");
        const seq = Number(rows[0].value);
        await c.query(
          'INSERT INTO room_events (seq, room_id, sender, origin_ts, type, content) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
          [seq, roomId, sender, nowMs, type, JSON.stringify(content ?? null)],
        );
        if (afterAppend) await afterAppend(c, { seq, roomId, eventId: `${seq}` });
        if (type === 'm.room.encrypted') await createIncomingContactRequest(c, roomId, sender, nowMs);
        return seq;
      });
    },

    async roomEventRows(roomId, sinceSeq, limit = 200) {
      const { rows } = await pool.query(
        'SELECT seq, room_id, sender, origin_ts, type, content FROM room_events WHERE room_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
        [roomId, sinceSeq, limit],
      );
      return rows.map((r) => ({
        event_id: `$${r.seq}`, seq: Number(r.seq), room_id: r.room_id, sender: r.sender,
        origin_server_ts: Number(r.origin_ts), type: r.type, content: r.content,
      }));
    },

    /** Всё, что сервер хранит по беседам и очереди. Нужно тестам: проверить, что открытого текста нет. */
    async snapshot() {
      const rooms = {};
      const ev = await pool.query('SELECT room_id, seq, sender, origin_ts, type, content FROM room_events ORDER BY seq');
      for (const r of ev.rows) {
        (rooms[r.room_id] ??= []).push({
          event_id: `$${r.seq}`, seq: Number(r.seq), room_id: r.room_id, sender: r.sender,
          origin_server_ts: Number(r.origin_ts), type: r.type, content: r.content,
        });
      }
      const q = await pool.query('SELECT device_key, id, stream, dedupe_key, expires_at, body FROM inbox ORDER BY id');
      const inbox = {};
      for (const r of q.rows) {
        (inbox[r.device_key] ??= []).push({ id: Number(r.id), stream: r.stream, dedupeKey: r.dedupe_key, expiresAt: Number(r.expires_at), ...r.body });
      }
      const keys = await pool.query('SELECT device_key, body FROM device_keys');
      return { rooms, inbox, deviceKeys: Object.fromEntries(keys.rows.map((r) => [r.device_key, r.body])) };
    },

    /** Телефон аккаунта; пусто, если его нет. */
    async phoneGet(userId) {
      const { rows } = await pool.query('SELECT * FROM phones WHERE user_id = $1', [userId]);
      return rows[0] ? fromPhoneRow(rows[0]) : freshPhone();
    },

    /** Изменение телефона под блокировкой строки: change(current) -> { next, result }. */
    async phoneUpdate(userId, change) {
      return inTransaction(async (c) => {
        const acc = await c.query('SELECT 1 FROM accounts WHERE user_id = $1', [userId]);
        if (acc.rows.length === 0) return change(freshPhone()).result;
        await c.query('INSERT INTO phones (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        const { rows } = await c.query('SELECT * FROM phones WHERE user_id = $1 FOR UPDATE', [userId]);
        const { next, result } = change(fromPhoneRow(rows[0]));
        await c.query(
          `UPDATE phones SET phone = $2, verified = $3, code_hash = $4, code_attempts = $5, code_expires_at = $6, sends = $7
           WHERE user_id = $1`,
          [userId, next.phone, next.verified, next.codeHash, next.codeAttempts, next.codeExpiresAt, JSON.stringify(next.sends)],
        );
        return result;
      });
    },

    /** Кто уже подтвердил этот номер, или null. */
    async mlsGroupEpoch(roomId) {
      const { rows } = await pool.query('SELECT epoch FROM mls_groups WHERE room_id = $1', [roomId]);
      return rows[0] ? Number(rows[0].epoch) : 0;
    },

    /** Durable idempotency lookup, deliberately available before membership authorization on replay. */
    async mlsCommitOperation(roomId, senderId, deviceId, clientOperationId, requestFingerprint) {
      const { rows } = await pool.query(
        'SELECT request_fingerprint, resulting_epoch FROM mls_commit_operations WHERE room_id = $1 AND sender_id = $2 AND device_id = $3 AND client_operation_id = $4',
        [roomId, senderId, deviceId, clientOperationId],
      );
      if (!rows[0]) return null;
      if (rows[0].request_fingerprint !== requestFingerprint) return { ok: false, reason: 'operation_id_reused' };
      return { ok: true, epoch: Number(rows[0].resulting_epoch), replayed: true };
    },

    /** Применяет коммит и idempotency receipt в одной транзакции. */
    async mlsApplyCommit(roomId, baseEpoch, { senderId, deviceId, clientOperationId, requestFingerprint, keyPackageClaimId, joinRequestUserId, commit, welcomes, changes = { adds: [], removes: [] } }, nowMs) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO mls_groups (room_id, epoch) VALUES ($1, 0) ON CONFLICT (room_id) DO NOTHING', [roomId]);
        const { rows } = await client.query('SELECT epoch FROM mls_groups WHERE room_id = $1 FOR UPDATE', [roomId]);
        const current = Number(rows[0].epoch);
        if (clientOperationId) {
          const { rows: operationRows } = await client.query(
            'SELECT request_fingerprint, resulting_epoch FROM mls_commit_operations WHERE room_id = $1 AND sender_id = $2 AND device_id = $3 AND client_operation_id = $4 FOR UPDATE',
            [roomId, senderId, deviceId, clientOperationId],
          );
          if (operationRows[0]) {
            await client.query('COMMIT');
            if (operationRows[0].request_fingerprint !== requestFingerprint) {
              return { ok: false, reason: 'operation_id_reused', epoch: Number(operationRows[0].resulting_epoch) };
            }
            return { ok: true, epoch: Number(operationRows[0].resulting_epoch), replayed: true };
          }
        }
        if (current !== baseEpoch) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'epoch_outdated', epoch: current };
        }
        const { rows: roomKindRows } = await client.query(
          'SELECT kind, org_id FROM rooms WHERE room_id = $1',
          [roomId],
        );
        if (!roomKindRows[0]) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'room_not_found', epoch: current };
        }
        const roomKind = roomKindRows[0].kind;
        let directConversation = null;
        if (roomKind === 'direct' && (changes.removes?.length ?? 0) > 0) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'direct_membership_fixed', epoch: current };
        }
        if ((changes.adds ?? []).length > 0) {
          if (roomKind === 'direct') {
            const { rows: pairLookup } = await client.query(
              'SELECT user_a, user_b FROM direct_conversations WHERE room_id = $1',
              [roomId],
            );
            if (!pairLookup[0]) {
              await client.query('ROLLBACK');
              return { ok: false, reason: 'direct_add_not_authorized', epoch: current };
            }
            const { rows: pairAccounts } = await client.query(
              'SELECT user_id FROM accounts WHERE user_id = ANY($1::text[]) ORDER BY user_id FOR SHARE',
              [[pairLookup[0].user_a, pairLookup[0].user_b]],
            );
            if (pairAccounts.length !== 2) {
              await client.query('ROLLBACK');
              return { ok: false, reason: 'direct_add_not_authorized', epoch: current };
            }
            const { rows: conversations } = await client.query(
              'SELECT user_a, user_b, created_by, status FROM direct_conversations WHERE room_id = $1 FOR UPDATE',
              [roomId],
            );
            directConversation = conversations[0] ?? null;
            const counterpart = directConversation?.user_a === senderId
              ? directConversation.user_b
              : directConversation?.user_b === senderId ? directConversation.user_a : null;
            if (!directConversation || directConversation.status !== 'provisioning'
              || directConversation.created_by !== senderId
              || changes.adds.length !== 1 || changes.adds[0] !== counterpart
              || !keyPackageClaimId || joinRequestUserId) {
              await client.query('ROLLBACK');
              return { ok: false, reason: 'direct_add_not_authorized', epoch: current };
            }
            const { rows: blocked } = await client.query(
              'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) FOR SHARE',
              [senderId, counterpart],
            );
            if (blocked.length) {
              await client.query('ROLLBACK');
              return { ok: false, reason: 'user_blocked', epoch: current };
            }
          } else {
            // Lock order is intentional: active organization links are locked before
            // room/member rows. revokeOrgLink takes FOR UPDATE on the same link before
            // inspecting room_members. Acquiring the link here first prevents the
            // add-commit/revoke deadlock and gives the race one clear linearization point.
            const roomOrgId = roomKindRows[0].org_id;
            const { rows: roomStatusRows } = await client.query(
              'SELECT status FROM organizations WHERE org_id = $1 FOR SHARE',
              [roomOrgId],
            );
            if (!roomStatusRows[0] || roomStatusRows[0].status !== 'approved') {
              await client.query('ROLLBACK');
              return { ok: false, reason: 'org_not_approved', epoch: current };
            }

            for (const targetUserId of [...changes.adds].sort()) {
              const { rows: directMembership } = await client.query(
                'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2 FOR SHARE',
                [roomOrgId, targetUserId],
              );
              if (directMembership.length) continue;

              // Discover candidate organizations without taking row locks, then acquire
              // the active link lock first. The membership/org rows are locked only after
              // the link, matching revokeOrgLink's lock order.
              const { rows: candidates } = await client.query(
                `SELECT member.org_id
                   FROM org_members member
                   JOIN organizations member_org ON member_org.org_id = member.org_id
                  WHERE member.user_id = $1
                    AND member.org_id <> $2
                    AND member_org.status = 'approved'
                  ORDER BY member.org_id`,
                [targetUserId, roomOrgId],
              );
              let authorized = false;
              for (const candidate of candidates) {
                const orgA = candidate.org_id < roomOrgId ? candidate.org_id : roomOrgId;
                const orgB = candidate.org_id < roomOrgId ? roomOrgId : candidate.org_id;
                const { rows: links } = await client.query(
                  `SELECT link_id FROM org_links
                    WHERE org_a = $1 AND org_b = $2 AND status = 'active'
                    FOR SHARE`,
                  [orgA, orgB],
                );
                if (!links.length) continue;
                const { rows: memberRows } = await client.query(
                  `SELECT 1
                     FROM org_members member
                     JOIN organizations member_org ON member_org.org_id = member.org_id
                    WHERE member.org_id = $1 AND member.user_id = $2
                      AND member_org.status = 'approved'
                    FOR SHARE OF member, member_org`,
                  [candidate.org_id, targetUserId],
                );
                if (memberRows.length) {
                  authorized = true;
                  break;
                }
              }
              if (!authorized) {
                await client.query('ROLLBACK');
                return { ok: false, reason: 'org_not_member', epoch: current };
              }
            }
          }
        }
        const requiredDevices = new Map();
        requiredDevices.set(JSON.stringify([senderId, deviceId]), { userId: senderId, deviceId, sender: true });
        for (const welcome of welcomes) {
          requiredDevices.set(JSON.stringify([welcome.userId, welcome.deviceId]), { userId: welcome.userId, deviceId: welcome.deviceId, sender: false });
        }
        for (const entry of [...requiredDevices.values()].sort((a, b) =>
          `${a.userId}|${a.deviceId}`.localeCompare(`${b.userId}|${b.deviceId}`))) {
          const { rows: activeDevice } = await client.query(
            'SELECT revoked FROM devices WHERE user_id = $1 AND device_id = $2 FOR SHARE',
            [entry.userId, entry.deviceId],
          );
          if (!activeDevice[0] || activeDevice[0].revoked) {
            await client.query('ROLLBACK');
            return { ok: false, reason: entry.sender ? 'sender_device_revoked' : 'welcome_device_revoked', epoch: current };
          }
        }
        if (joinRequestUserId) {
          if (changes.adds?.length !== 1 || changes.adds[0] !== joinRequestUserId) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'join_request_mismatch', epoch: current };
          }
          const { rows: requestRows } = await client.query(
            'SELECT user_id FROM join_requests WHERE room_id = $1 AND user_id = $2 FOR UPDATE',
            [roomId, joinRequestUserId],
          );
          if (!requestRows[0]) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'join_request_not_pending', epoch: current };
          }
        }
        if (keyPackageClaimId) {
          const targetUserId = changes.adds?.length === 1 ? changes.adds[0] : null;
          if (!targetUserId) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'claim_mismatch', epoch: current };
          }
          const { rows: claimRows } = await client.query(
            'SELECT room_id, state, result FROM mls_key_package_claims WHERE target_user_id = $1 AND requester_user_id = $2 AND requester_device_id = $3 AND claim_id = $4 FOR UPDATE',
            [targetUserId, senderId, deviceId, keyPackageClaimId],
          );
          const claim = claimRows[0];
          if (!claim) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'claim_missing', epoch: current };
          }
          if (claim.room_id !== roomId) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'claim_room_mismatch', epoch: current };
          }
          if (claim.state === 'released') {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'claim_released', epoch: current };
          }
          if (claim.state === 'committed') {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'claim_committed', epoch: current };
          }
          if (claim.result === null) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'claim_pending', epoch: current };
          }
          const claimedDevices = claim.result.map((item) => item.deviceId).sort();
          const welcomeDevices = welcomes.filter((item) => item.userId === targetUserId).map((item) => item.deviceId).sort();
          if (JSON.stringify(claimedDevices) !== JSON.stringify(welcomeDevices)) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'claim_mismatch', epoch: current };
          }
        }
        for (const deviceId of changes.removeDevices ?? []) {
          await client.query('UPDATE mls_device_removals SET done_at = $3 WHERE room_id = $1 AND device_id = $2 AND done_at IS NULL', [roomId, deviceId, nowMs]);
        }
        for (const userId of changes.removes) {
          await client.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
        }
        for (const userId of changes.adds) {
          const seqRows = await client.query("SELECT value FROM counters WHERE name = 'event_seq' FOR UPDATE");
          const ins = await client.query(
            'INSERT INTO room_members (room_id, user_id, is_admin, joined_seq, capabilities) VALUES ($1, $2, FALSE, $3, $4::text[]) ON CONFLICT (room_id, user_id) DO NOTHING',
            [roomId, userId, Number(seqRows.rows[0].value), [...DEFAULT_MEMBER_CAPABILITIES]],
          );
          if (ins.rowCount === 0) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'already-member', epoch: current };
          }
        }
        if (directConversation) {
          const activated = await client.query(
            "UPDATE direct_conversations SET status = 'active' WHERE room_id = $1 AND status = 'provisioning'",
            [roomId],
          );
          if (activated.rowCount !== 1) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'direct_state_changed', epoch: current };
          }
        }
        const next = current + 1;
        await client.query('INSERT INTO mls_commits (room_id, epoch, sender_id, commit, changes, welcome_recipients, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)', [roomId, next, senderId, commit, JSON.stringify({ adds: changes.adds ?? [], removes: changes.removes ?? [], removeDevices: changes.removeDevices ?? [] }), JSON.stringify(welcomes.map((w) => ({ userId: w.userId, deviceId: w.deviceId }))), nowMs]);
        await client.query('UPDATE mls_groups SET epoch = $2 WHERE room_id = $1', [roomId, next]);
        for (const w of welcomes) {
          await client.query('INSERT INTO mls_welcomes (room_id, epoch, user_id, device_id, welcome, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [roomId, next, w.userId, w.deviceId, w.welcome, nowMs]);
        }
        if (clientOperationId) {
          await client.query(
            'INSERT INTO mls_commit_operations (room_id, sender_id, device_id, client_operation_id, request_fingerprint, resulting_epoch, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [roomId, senderId, deviceId, clientOperationId, requestFingerprint, next, nowMs],
          );
        }
        if (keyPackageClaimId) {
          const targetUserId = changes.adds[0];
          await client.query(
            'UPDATE mls_key_package_claims SET state = \'committed\', committed_at = $5 WHERE target_user_id = $1 AND requester_user_id = $2 AND requester_device_id = $3 AND claim_id = $4',
            [targetUserId, senderId, deviceId, keyPackageClaimId, nowMs],
          );
        }
        if (joinRequestUserId) {
          const removedRequest = await client.query(
            'DELETE FROM join_requests WHERE room_id = $1 AND user_id = $2',
            [roomId, joinRequestUserId],
          );
          if (removedRequest.rowCount !== 1) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'join_request_not_pending', epoch: current };
          }
        }
        await client.query('COMMIT');
        return { ok: true, epoch: next, replayed: false };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') return { ok: false, epoch: await this.mlsGroupEpoch(roomId) };
        if (error.code === '23503') return { ok: false, reason: 'recipient' };
        throw error;
      } finally {
        client.release();
      }
    },

    async mlsCommitsSince(roomId, since, limit) {
      const { rows } = await pool.query('SELECT epoch, sender_id, commit, changes, welcome_recipients FROM mls_commits WHERE room_id = $1 AND epoch > $2 ORDER BY epoch LIMIT $3', [roomId, since, limit]);
      return rows.map((r) => ({ epoch: Number(r.epoch), senderId: r.sender_id, commit: r.commit, changes: r.changes, welcomeRecipients: r.welcome_recipients }));
    },

    async mlsPendingWelcomes(userId, deviceId) {
      return inTransaction(async (c) => {
        const { rows: devices } = await c.query(
          'SELECT revoked FROM devices WHERE user_id = $1 AND device_id = $2 FOR SHARE',
          [userId, deviceId],
        );
        if (!devices[0] || devices[0].revoked) return [];
        const { rows } = await c.query(
          'SELECT id, room_id, epoch, welcome FROM mls_welcomes WHERE user_id = $1 AND device_id = $2 AND acked_at IS NULL ORDER BY id',
          [userId, deviceId],
        );
        return rows.map((r) => ({ id: Number(r.id), roomId: r.room_id, epoch: Number(r.epoch), welcome: r.welcome }));
      });
    },

    async mlsDropDevicePackages(userId, deviceId) {
      await pool.query('DELETE FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND consumed_at IS NULL', [userId, deviceId]);
      await pool.query('DELETE FROM mls_welcomes WHERE user_id = $1 AND device_id = $2 AND acked_at IS NULL', [userId, deviceId]);
    },

    async mlsAckWelcome(id, userId, deviceId, nowMs) {
      return inTransaction(async (c) => {
        const { rows: devices } = await c.query(
          'SELECT revoked FROM devices WHERE user_id = $1 AND device_id = $2 FOR SHARE',
          [userId, deviceId],
        );
        if (!devices[0] || devices[0].revoked) return false;
        const { rowCount } = await c.query(
          'UPDATE mls_welcomes SET acked_at = $4 WHERE id = $1 AND user_id = $2 AND device_id = $3 AND acked_at IS NULL',
          [id, userId, deviceId, nowMs],
        );
        return rowCount === 1;
      });
    },

    async phoneOwner(phone) {
      const { rows } = await pool.query('SELECT user_id FROM phones WHERE phone = $1', [phone]);
      return rows[0]?.user_id ?? null;
    },

    async verifiedPhoneOwner(phone) {
      const { rows } = await pool.query('SELECT user_id FROM phones WHERE phone = $1 AND verified', [phone]);
      return rows[0]?.user_id ?? null;
    },

    /** Один запрос в окне времени. allowed=false — лимит исчерпан; отклонённые попытки тоже считаются. */
    async rateHit(key, nowMs, windowMs, limit) {
      return inTransaction(async (c) => {
        await c.query('INSERT INTO rate_limits (key, window_start, hits) VALUES ($1, $2, 0) ON CONFLICT (key) DO NOTHING', [key, nowMs]);
        const { rows } = await c.query('SELECT window_start, hits FROM rate_limits WHERE key = $1 FOR UPDATE', [key]);
        const { next, allowed, retryAt } = applyHit({ windowStart: Number(rows[0].window_start), hits: rows[0].hits }, { nowMs, windowMs, limit });
        await c.query('UPDATE rate_limits SET window_start = $2, hits = $3 WHERE key = $1', [key, next.windowStart, next.hits]);
        return { allowed, retryAt };
      });
    },

    // ---- профиль аккаунта: почта и никнейм ----
    async profileGet(userId) {
      const { rows } = await pool.query('SELECT email, email_verified, nickname, created_at, locale FROM profiles WHERE user_id = $1', [userId]);
      return rows[0]
        ? { email: rows[0].email, emailVerified: rows[0].email_verified, nickname: rows[0].nickname, createdAt: Number(rows[0].created_at), locale: rows[0].locale ?? 'hy' }
        : null;
    },

    async profileLocaleSet(userId, locale) {
      const { rowCount } = await pool.query('UPDATE profiles SET locale = $2 WHERE user_id = $1', [userId, locale]);
      return rowCount > 0;
    },

    async userIdByEmail(email) {
      const { rows } = await pool.query('SELECT user_id FROM profiles WHERE email_verified AND lower(email) = lower($1)', [email]);
      return rows[0]?.user_id ?? null;
    },

    async searchNickname(nickname) {
      const { rows } = await pool.query('SELECT user_id, nickname FROM profiles WHERE lower(nickname) = lower($1)', [nickname]);
      return rows[0] ? { userId: rows[0].user_id, nickname: rows[0].nickname } : null;
    },

    /** Аккаунт с подтверждённой почтой и никнеймом одной транзакцией (и связью с провайдером, если задана).
     *  Возвращает ok | email | nickname | link | account. */
    async createVerifiedAccount({ userId, passwordHash, email, nickname, nowMs, provider = null, joinDefaultOrg = false, locale = 'hy' }) {
      try {
        return await inTransaction(async (c) => {
          await c.query('INSERT INTO accounts (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
          if (joinDefaultOrg) await c.query("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ('org-default', $1, 'member', $2) ON CONFLICT DO NOTHING", [userId, Date.now()]);
          await c.query(
            'INSERT INTO profiles (user_id, email, email_verified, nickname, created_at, locale) VALUES ($1, $2, TRUE, $3, $4, $5)',
            [userId, email, nickname, nowMs, locale],
          );
          if (provider) {
            await c.query(
              'INSERT INTO provider_links (provider, sub, user_id, email, linked_at) VALUES ($1, $2, $3, $4, $5)',
              [provider.provider, provider.sub, userId, email, nowMs],
            );
          }
          return 'ok';
        });
      } catch (e) {
        if (e.code !== '23505') throw e;
        if (e.constraint === 'profiles_email_verified') return 'email';
        if (e.constraint === 'profiles_nickname') return 'nickname';
        if (e.constraint === 'provider_links_pkey') return 'link';
        return 'account';
      }
    },

    /** Код подтверждения почты при регистрации под блокировкой строки: change(current) -> { next, result }. */
    async emailCodeUpdate(email, change) {
      return inTransaction(async (c) => {
        await c.query('INSERT INTO email_codes (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
        const { rows } = await c.query('SELECT * FROM email_codes WHERE email = $1 FOR UPDATE', [email]);
        const r = rows[0];
        const current = {
          codeHash: r.code_hash, codeAttempts: r.code_attempts, codeExpiresAt: Number(r.code_expires_at),
          tokenHash: r.token_hash, tokenExpiresAt: Number(r.token_expires_at), locale: r.locale ?? 'hy',
        };
        const { next, result } = change(current);
        await c.query(
          `UPDATE email_codes SET code_hash = $2, code_attempts = $3, code_expires_at = $4, token_hash = $5, token_expires_at = $6, locale = $7
           WHERE email = $1`,
          [email, next.codeHash, next.codeAttempts, next.codeExpiresAt, next.tokenHash, next.tokenExpiresAt, next.locale ?? current.locale ?? 'hy'],
        );
        return result;
      });
    },

    async emailCodeUpdateWithOutbox(email, change, enqueue, locale = 'hy') {
      return inTransaction(async (c) => {
        await c.query('INSERT INTO email_codes (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
        const { rows } = await c.query('SELECT * FROM email_codes WHERE email = $1 FOR UPDATE', [email]);
        const r = rows[0];
        const current = {
          codeHash: r.code_hash, codeAttempts: r.code_attempts, codeExpiresAt: Number(r.code_expires_at),
          tokenHash: r.token_hash, tokenExpiresAt: Number(r.token_expires_at), locale: r.locale ?? 'hy',
        };
        const { next, result } = change(current);
        await c.query(
          `UPDATE email_codes SET code_hash = $2, code_attempts = $3, code_expires_at = $4, token_hash = $5, token_expires_at = $6, locale = $7
           WHERE email = $1`,
          [email, next.codeHash, next.codeAttempts, next.codeExpiresAt, next.tokenHash, next.tokenExpiresAt, locale],
        );
        if (enqueue) await enqueue(c, result);
        return result;
      });
    },

    // ---- открытый ключ устройства для биометрического подтверждения (этап 2б) ----
    async signingKeyGet(deviceKey) {
      const { rows } = await pool.query('SELECT public_jwk FROM device_signing_keys WHERE device_key = $1', [deviceKey]);
      return rows[0] ? JSON.parse(rows[0].public_jwk) : null;
    },

    async signingKeySet(deviceKey, jwk, createdAt) {
      await pool.query(
        `INSERT INTO device_signing_keys (device_key, public_jwk, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (device_key) DO UPDATE SET public_jwk = EXCLUDED.public_jwk, created_at = EXCLUDED.created_at`,
        [deviceKey, JSON.stringify(jwk), createdAt],
      );
    },

    async signingKeyDelete(deviceKey) {
      const { rowCount } = await pool.query('DELETE FROM device_signing_keys WHERE device_key = $1', [deviceKey]);
      return rowCount > 0;
    },

    // ---- код отмены восстановления (окно 48 часов) ----
    async recoveryCancelSet(userId, codeHash, expiresAt) {
      await pool.query(
        `INSERT INTO recovery_cancel_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at`,
        [userId, codeHash, expiresAt],
      );
    },

    async recoveryCancelGet(userId) {
      const { rows } = await pool.query('SELECT code_hash, expires_at FROM recovery_cancel_codes WHERE user_id = $1', [userId]);
      return rows[0] ? { codeHash: rows[0].code_hash, expiresAt: Number(rows[0].expires_at) } : null;
    },

    async recoveryCancelClear(userId) {
      await pool.query('DELETE FROM recovery_cancel_codes WHERE user_id = $1', [userId]);
    },

    // ---- отложенный вход с нового устройства (аккаунт без активных устройств, только почта) ----
    async deviceWaitGet(userId, deviceId) {
      const { rows } = await pool.query('SELECT activate_at FROM device_waits WHERE user_id = $1 AND device_id = $2', [userId, deviceId]);
      return rows[0] ? { activateAt: Number(rows[0].activate_at) } : null;
    },

    async deviceWaitsOf(userId) {
      const { rows } = await pool.query('SELECT device_id, activate_at, cancel_hash FROM device_waits WHERE user_id = $1', [userId]);
      return rows.map((r) => ({ deviceId: r.device_id, activateAt: Number(r.activate_at), cancelHash: r.cancel_hash }));
    },

    /** ok | exists (ожидание для этого устройства уже есть). */
    async deviceWaitCreate({ userId, deviceId, label, platform, activateAt, cancelHash, createdAt }) {
      try {
        await pool.query(
          'INSERT INTO device_waits (user_id, device_id, label, platform, activate_at, cancel_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [userId, deviceId, label, platform, activateAt, cancelHash, createdAt],
        );
        return 'ok';
      } catch (e) {
        if (e.code !== '23505') throw e;
        return 'exists';
      }
    },

    async deviceWaitCreateWithOutbox({ userId, deviceId, label, platform, activateAt, cancelHash, createdAt }, enqueue) {
      try {
        return await inTransaction(async (client) => {
          await client.query(
            'INSERT INTO device_waits (user_id, device_id, label, platform, activate_at, cancel_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [userId, deviceId, label, platform, activateAt, cancelHash, createdAt],
          );
          if (enqueue) await enqueue(client);
          return 'ok';
        });
      } catch (error) {
        if (error.code !== '23505') throw error;
        return 'exists';
      }
    },

    async deviceWaitDelete(userId, deviceId) {
      const { rowCount } = await pool.query('DELETE FROM device_waits WHERE user_id = $1 AND device_id = $2', [userId, deviceId]);
      return rowCount > 0;
    },

    // ---- запасная почта: необязательна, подтверждённая; один адрес — один аккаунт ----
    async backupEmailGet(userId) {
      const { rows } = await pool.query('SELECT email FROM backup_emails WHERE user_id = $1', [userId]);
      return rows[0] ? { email: rows[0].email, verified: true } : null;
    },

    /** ok | taken (этот адрес уже запасной у другого аккаунта). */
    async backupEmailSave(userId, email, nowMs) {
      try {
        await pool.query(
          `INSERT INTO backup_emails (user_id, email, created_at) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, created_at = EXCLUDED.created_at`,
          [userId, email, nowMs],
        );
        return 'ok';
      } catch (e) {
        if (e.code !== '23505') throw e;
        return 'taken';
      }
    },

    async backupEmailSaveWithOutbox(userId, email, nowMs, enqueue) {
      try {
        return await inTransaction(async (client) => {
          await client.query(
            `INSERT INTO backup_emails (user_id, email, created_at) VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, created_at = EXCLUDED.created_at`,
            [userId, email, nowMs],
          );
          if (enqueue) await enqueue(client);
          return 'ok';
        });
      } catch (error) {
        if (error.code !== '23505') throw error;
        return 'taken';
      }
    },

    async backupEmailRemove(userId) {
      const { rowCount } = await pool.query('DELETE FROM backup_emails WHERE user_id = $1', [userId]);
      return rowCount > 0;
    },

    async backupEmailRemoveWithOutbox(userId, enqueue) {
      return inTransaction(async (client) => {
        const { rowCount } = await client.query('DELETE FROM backup_emails WHERE user_id = $1', [userId]);
        if (rowCount === 0) return false;
        if (enqueue) await enqueue(client);
        return true;
      });
    },

    // ---- одноразовые токены этапа 2 (nonce, билет регистрации, подтверждение входа) ----
    async issueAuthToken({ kind, tokenHash, userId, payload, expiresAt }) {
      await pool.query(
        'INSERT INTO auth_tokens (kind, token_hash, user_id, payload, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [kind, tokenHash, userId, payload, expiresAt],
      );
    },

    /** Погашает токен: удаляет его и возвращает { userId, payload }, либо null, если токена нет или он истёк. */
    async consumeAuthToken(kind, tokenHash, nowMs) {
      const { rows } = await pool.query(
        'DELETE FROM auth_tokens WHERE kind = $1 AND token_hash = $2 AND expires_at >= $3 RETURNING user_id, payload',
        [kind, tokenHash, nowMs],
      );
      return rows[0] ? { userId: rows[0].user_id, payload: rows[0].payload } : null;
    },

    // ---- связи с внешними аккаунтами ----
    async providerLinkFind(provider, sub) {
      const { rows } = await pool.query('SELECT user_id FROM provider_links WHERE provider = $1 AND sub = $2', [provider, sub]);
      return rows[0] ? { userId: rows[0].user_id } : null;
    },

    async providerLinksOf(userId) {
      const { rows } = await pool.query('SELECT provider FROM provider_links WHERE user_id = $1 ORDER BY provider', [userId]);
      return rows.map((r) => ({ provider: r.provider }));
    },

    /** ok | taken (этот внешний аккаунт привязан к другому аккаунту) | provider-set (этот провайдер уже привязан к аккаунту). */
    async linkProvider({ userId, provider, sub, email, nowMs }) {
      try {
        await pool.query(
          'INSERT INTO provider_links (provider, sub, user_id, email, linked_at) VALUES ($1, $2, $3, $4, $5)',
          [provider, sub, userId, email, nowMs],
        );
        return 'ok';
      } catch (e) {
        if (e.code !== '23505') throw e;
        if (e.constraint === 'provider_links_user_provider') return 'provider-set';
        const owner = await pool.query('SELECT user_id FROM provider_links WHERE provider = $1 AND sub = $2', [provider, sub]);
        return owner.rows[0]?.user_id === userId ? 'provider-set' : 'taken';
      }
    },

    async unlinkProvider(userId, provider) {
      const { rowCount } = await pool.query('DELETE FROM provider_links WHERE user_id = $1 AND provider = $2', [userId, provider]);
      return rowCount > 0;
    },

  };
}

function numOrNull(v) {
  return v === null || v === undefined ? null : Number(v);
}

function fromRecoveryRow(r) {
  return {
    reqStatus: r.req_status, reqStartedAt: Number(r.req_started_at), reqExpiresAt: Number(r.req_expires_at),
    reqCodeHash: r.req_code_hash, reqAttempts: r.req_attempts, reqLinkHash: r.req_link_hash, reqLinkConfirmed: r.req_link_confirmed,
    windowStartedAt: numOrNull(r.window_started_at), windowKeyResetAt: numOrNull(r.window_key_reset_at),
    windowPreviousHash: r.window_previous_hash,
    identityCheck: r.identity_check, identityCodeHash: r.identity_code_hash, identityAttempts: r.identity_attempts,
    lockedUntil: Number(r.locked_until), starts: r.starts.map(Number),
  };
}

function fromPhoneRow(r) {
  return {
    phone: r.phone, verified: r.verified, codeHash: r.code_hash, codeAttempts: r.code_attempts,
    codeExpiresAt: Number(r.code_expires_at), sends: r.sends.map(Number),
  };
}
