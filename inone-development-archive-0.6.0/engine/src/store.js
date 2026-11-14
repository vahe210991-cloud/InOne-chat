// ============================================================================
// Постоянное PostgreSQL-хранилище серверного движка InOne.
// Серверный запуск передаёт этот адаптер через src/main.js; in-memory store используется отдельно для тестов и локальной разработки.
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

export function createStore({ pool, pinPepper }) {
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
    async claimOneTimeKey(deviceKey) {
      return inTransaction(async (c) => {
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
      return {
        inbox: await run('DELETE FROM inbox WHERE expires_at <= $1'),
        tokens: await run('DELETE FROM tokens WHERE expires_at <= $1'),
        refreshTokens: await run('DELETE FROM refresh_tokens WHERE expires_at <= $1'),
        authTokens: await run('DELETE FROM auth_tokens WHERE expires_at < $1'),
        recoveryCancelCodes: await run('DELETE FROM recovery_cancel_codes WHERE expires_at <= $1'),
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
    async addOrgMemberWithAudit({ orgId, userId, role, actorId, at }) {
      if (!['owner', 'admin', 'member'].includes(role)) return { ok: false, reason: 'invalid_role' };
      return inTransaction(async (c) => {
        const { rows } = await c.query('SELECT user_id, role FROM org_members WHERE org_id = $1 ORDER BY user_id FOR UPDATE', [orgId]);
        const { rows: orgRows } = await c.query('SELECT status FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (!orgRows[0]) return { ok: false, reason: 'not_found' };
        if (orgRows[0].status !== 'approved') return { ok: false, reason: 'not_approved' };
        const actorRole = rows.find((row) => row.user_id === actorId)?.role;
        if (actorRole !== 'owner' && actorRole !== 'admin') return { ok: false, reason: 'forbidden' };
        if (actorRole === 'admin' && role !== 'member') return { ok: false, reason: 'forbidden' };
        if (rows.some((row) => row.user_id === userId)) return { ok: false, reason: 'already_member' };
        const { rowCount: accountCount } = await c.query('SELECT 1 FROM accounts WHERE user_id = $1', [userId]);
        if (accountCount !== 1) return { ok: false, reason: 'unknown_user' };
        await c.query('INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)', [orgId, userId, role, at]);
        await c.query("INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, 'member_add', $3, $4, $5)", [orgId, actorId, userId, role, at]);
        return { ok: true };
      });
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
      await inTransaction(async (c) => {
        await c.query('INSERT INTO org_requests (request_id, applicant_id, name, status, created_at) VALUES ($1, $2, $3, $4, $5)', [requestId, applicantId, name, 'pending', createdAt]);
        await c.query("INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, 'created', $3)", [requestId, applicantId, createdAt]);
      });
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
    async addOrgRequestDocument({ docId, requestId, kind, size, sha256, objectKey, uploadedBy, createdAt }) {
      await inTransaction(async (c) => {
        await c.query('INSERT INTO org_request_documents (doc_id, request_id, kind, size, sha256, object_key, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [docId, requestId, kind, size, sha256, objectKey, uploadedBy, createdAt]);
        await c.query("INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, 'document', $3)", [requestId, uploadedBy, createdAt]);
      });
    },
    async listOrgRequestDocuments(requestId) {
      const { rows } = await pool.query('SELECT doc_id, kind, size, sha256, created_at FROM org_request_documents WHERE request_id = $1 ORDER BY created_at', [requestId]);
      return rows.map((r) => ({ docId: r.doc_id, kind: r.kind, size: Number(r.size), sha256: r.sha256, createdAt: Number(r.created_at) }));
    },
    async getOrgRequestDocument(docId) {
      const { rows } = await pool.query('SELECT doc_id, request_id, kind, size, sha256, object_key FROM org_request_documents WHERE doc_id = $1', [docId]);
      const r = rows[0];
      if (!r) return null;
      return { docId: r.doc_id, requestId: r.request_id, kind: r.kind, size: Number(r.size), sha256: r.sha256, objectKey: r.object_key };
    },
    async decideOrgRequest({ requestId, status, decidedBy, decidedAt, orgId }) {
      return inTransaction(async (c) => {
        const { rowCount } = await c.query(
          "UPDATE org_requests SET status = $2, decided_by = $3, decided_at = $4, org_id = $5 WHERE request_id = $1 AND status = 'pending'",
          [requestId, status, decidedBy, decidedAt, orgId],
        );
        if (rowCount !== 1) return false;
        await c.query('INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, $3, $4)', [requestId, decidedBy, status === 'approved' ? 'approve' : 'reject', decidedAt]);
        return true;
      });
    },
    async approveOrgRequest({ requestId, decidedBy, decidedAt }) {
      return inTransaction(async (c) => {
        const { rows } = await c.query('SELECT applicant_id, name, status FROM org_requests WHERE request_id = $1 FOR UPDATE', [requestId]);
        const request = rows[0];
        if (!request) return { ok: false, reason: 'not_found' };
        if (request.status !== 'pending') return { ok: false, reason: 'already_decided' };
        const orgId = `org-${requestId}`;
        await c.query(
          "INSERT INTO organizations (org_id, name, status, created_by, created_at) VALUES ($1, $2, 'approved', $3, $4) ON CONFLICT (org_id) DO NOTHING",
          [orgId, request.name, request.applicant_id, decidedAt],
        );
        await c.query("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', $3) ON CONFLICT (org_id, user_id) DO NOTHING", [orgId, request.applicant_id, decidedAt]);
        await c.query("UPDATE org_requests SET status = 'approved', decided_by = $2, decided_at = $3, org_id = $4 WHERE request_id = $1 AND status = 'pending'", [requestId, decidedBy, decidedAt, orgId]);
        await c.query("INSERT INTO org_request_log (request_id, actor, action, at) VALUES ($1, $2, 'approve', $3)", [requestId, decidedBy, decidedAt]);
        return { ok: true, orgId };
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
    async changeOrgMemberRole({ orgId, userId, actorId, role, at }) {
      if (!['owner', 'admin', 'member'].includes(role)) return { ok: false, reason: 'invalid_role' };
      return inTransaction(async (c) => {
        const { rows } = await c.query('SELECT user_id, role FROM org_members WHERE org_id = $1 ORDER BY user_id FOR UPDATE', [orgId]);
        const { rowCount: orgCount } = await c.query('SELECT org_id FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (orgCount !== 1) return { ok: false, reason: 'not_found' };
        const roles = new Map(rows.map((row) => [row.user_id, row.role]));
        if (roles.get(actorId) !== 'owner') return { ok: false, reason: 'forbidden' };
        const current = roles.get(userId);
        if (!current) return { ok: false, reason: 'not_found' };
        const ownerCount = rows.filter((row) => row.role === 'owner').length;
        if (current === 'owner' && role !== 'owner' && ownerCount <= 1) return { ok: false, reason: 'last_owner' };
        await c.query('UPDATE org_members SET role = $3 WHERE org_id = $1 AND user_id = $2', [orgId, userId, role]);
        await c.query("INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, 'role_change', $3, $4, $5)", [orgId, actorId, userId, current + '->' + role, at]);
        return { ok: true, current };
      });
    },
    async removeOrgMemberWithAudit({ orgId, userId, actorId, at, leave = false }) {
      return inTransaction(async (c) => {
        const { rows } = await c.query('SELECT user_id, role FROM org_members WHERE org_id = $1 ORDER BY user_id FOR UPDATE', [orgId]);
        const { rowCount: orgCount } = await c.query('SELECT org_id FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (orgCount !== 1) return { ok: false, reason: 'not_found' };
        const roles = new Map(rows.map((row) => [row.user_id, row.role]));
        const actorRole = roles.get(actorId);
        const targetRole = roles.get(userId);
        if (!targetRole) return { ok: false, reason: leave ? 'not_member' : 'not_found' };
        if (leave) {
          if (actorId !== userId) return { ok: false, reason: 'forbidden' };
        } else if (!(actorRole === 'owner' || (actorRole === 'admin' && targetRole === 'member'))) {
          return { ok: false, reason: 'forbidden' };
        }
        const ownerCount = rows.filter((row) => row.role === 'owner').length;
        if (targetRole === 'owner' && ownerCount <= 1) return { ok: false, reason: 'last_owner' };
        const { rows: owned } = await c.query('SELECT COUNT(*)::int AS n FROM rooms WHERE org_id = $1 AND owner = $2', [orgId, userId]);
        if (owned[0].n > 0) return { ok: false, reason: 'owns_rooms' };
        await c.query('DELETE FROM room_members WHERE user_id = $2 AND room_id IN (SELECT room_id FROM rooms WHERE org_id = $1)', [orgId, userId]);
        await c.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
        await c.query('INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)', [orgId, actorId, leave ? 'member_leave' : 'member_remove', userId, targetRole, at]);
        return { ok: true, targetRole };
      });
    },
    async setOrgMemberRole(orgId, userId, role) {
      await pool.query('UPDATE org_members SET role = $3 WHERE org_id = $1 AND user_id = $2', [orgId, userId, role]);
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
      // Lock the authorization row before removing room memberships. Open joins
      // take FOR SHARE on this row inside their own transaction; this ordering
      // prevents a revoke from deleting membership first and then leaving a
      // stale room_members row inserted by an in-flight join.
      await inTransaction(async (c) => {
        await c.query('SELECT user_id FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, userId]);
        await c.query('DELETE FROM room_members WHERE user_id = $2 AND room_id IN (SELECT room_id FROM rooms WHERE org_id = $1)', [orgId, userId]);
        await c.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
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
      if (!column) return { ok: false, reason: 'invalid_field' };
      return inTransaction(async (c) => {
        const { rows: actorRows } = await c.query('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, actor]);
        const { rowCount: orgCount } = await c.query('SELECT org_id FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (orgCount !== 1) return { ok: false, reason: 'not_found' };
        if (!['owner', 'admin'].includes(actorRows[0]?.role)) return { ok: false, reason: 'forbidden' };
        const { rows } = await c.query('SELECT max_group_members, channels_enabled, file_quota_bytes FROM org_settings WHERE org_id = $1', [orgId]);
        const r = rows[0];
        const old = !r ? { maxGroupMembers: null, channelsEnabled: true, fileQuotaBytes: null }[field] : { maxGroupMembers: r.max_group_members, channelsEnabled: r.channels_enabled, fileQuotaBytes: r.file_quota_bytes === null ? null : Number(r.file_quota_bytes) }[field];
        await c.query(`INSERT INTO org_settings (org_id, ${column}) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET ${column} = EXCLUDED.${column}`, [orgId, value]);
        await c.query('INSERT INTO org_settings_log (org_id, actor, field, old_value, new_value, at) VALUES ($1, $2, $3, $4, $5, $6)', [orgId, actor, field, JSON.stringify(old), JSON.stringify(value), at]);
        await c.query("INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, 'setting_change', $3, $4, $5)", [orgId, actor, field, JSON.stringify(value), at]);
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
      return inTransaction(async (c) => {
        const { rows: orgRows } = await c.query('SELECT org_id, status FROM organizations WHERE org_id = ANY($1::text[]) ORDER BY org_id FOR UPDATE', [[a, b]]);
        if (orgRows.length !== 2) return { ok: false, reason: 'not_found' };
        if (orgRows.some((org) => org.status !== 'approved')) return { ok: false, reason: 'not_approved' };
        const { rows: actorRows } = await c.query('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [proposingOrg, proposedBy]);
        if (!['owner', 'admin'].includes(actorRows[0]?.role)) return { ok: false, reason: 'forbidden' };
        const { rowCount } = await c.query(
          "INSERT INTO org_links (link_id, org_a, org_b, proposed_by_org, status, proposed_by, created_at) VALUES ($1, $2, $3, $4, 'proposed', $5, $6) ON CONFLICT (org_a, org_b) DO UPDATE SET link_id = EXCLUDED.link_id, proposed_by_org = EXCLUDED.proposed_by_org, status = 'proposed', proposed_by = EXCLUDED.proposed_by, created_at = EXCLUDED.created_at, decided_by = NULL, decided_at = NULL WHERE org_links.status = 'revoked' RETURNING link_id",
          [linkId, a, b, proposingOrg, proposedBy, createdAt],
        );
        if (rowCount !== 1) return { ok: false, reason: 'already_exists' };
        await c.query("INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, 'link_propose', $3, $4, $5)", [proposingOrg, proposedBy, otherOrg, linkId, createdAt]);
        await c.query("INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, 'link_propose', $3, $4, $5)", [otherOrg, proposedBy, proposingOrg, linkId, createdAt]);
        return { ok: true };
      });
    },
    async getOrgLink(linkId) {
      const { rows } = await pool.query('SELECT link_id, org_a, org_b, status, proposed_by_org FROM org_links WHERE link_id = $1', [linkId]);
      const r = rows[0];
      return r ? { linkId: r.link_id, orgA: r.org_a, orgB: r.org_b, status: r.status, proposingOrg: r.proposed_by_org } : null;
    },
    async setOrgLinkStatus({ linkId, status, decidedBy, decidedAt }) {
      await pool.query('UPDATE org_links SET status = $2, decided_by = $3, decided_at = $4 WHERE link_id = $1', [linkId, status, decidedBy, decidedAt]);
    },
    async transitionOrgLinkStatus({ linkId, fromStatus, status, decidedBy, decidedAt, orgId }) {
      return inTransaction(async (c) => {
        const { rowCount: orgCount } = await c.query('SELECT org_id FROM organizations WHERE org_id = $1 FOR UPDATE', [orgId]);
        if (orgCount !== 1) return { ok: false, reason: 'not_found' };
        const { rows } = await c.query('SELECT org_a, org_b, proposed_by_org, status FROM org_links WHERE link_id = $1 FOR UPDATE', [linkId]);
        const link = rows[0];
        if (!link || (link.org_a !== orgId && link.org_b !== orgId)) return { ok: false, reason: 'not_found' };
        if (link.status !== fromStatus) return { ok: false, reason: 'state_changed' };
        if (status === 'active' && link.proposed_by_org === orgId) return { ok: false, reason: 'wrong_side' };
        const { rows: actorRows } = await c.query('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, decidedBy]);
        if (!['owner', 'admin'].includes(actorRows[0]?.role)) return { ok: false, reason: 'forbidden' };
        const { rowCount } = await c.query(
          'UPDATE org_links SET status = $3, decided_by = $4, decided_at = $5 WHERE link_id = $1 AND status = $2',
          [linkId, fromStatus, status, decidedBy, decidedAt],
        );
        if (rowCount !== 1) return { ok: false, reason: 'state_changed' };
        if (status === 'revoked') {
          await c.query(`DELETE FROM room_members rm USING rooms r
            WHERE rm.room_id = r.room_id AND r.org_id = $1
              AND rm.user_id IN (SELECT user_id FROM org_members WHERE org_id = $2)
              AND rm.user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = $1)`, [link.org_a, link.org_b]);
          await c.query(`DELETE FROM room_members rm USING rooms r
            WHERE rm.room_id = r.room_id AND r.org_id = $2
              AND rm.user_id IN (SELECT user_id FROM org_members WHERE org_id = $1)
              AND rm.user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = $2)`, [link.org_a, link.org_b]);
        }
        const action = status === 'active' ? 'link_accept' : status === 'revoked' ? 'link_revoke' : null;
        if (action) {
          await c.query('INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)', [link.org_a, decidedBy, action, link.org_b, linkId, decidedAt]);
          await c.query('INSERT INTO admin_action_log (org_id, actor, action, target, detail, at) VALUES ($1, $2, $3, $4, $5, $6)', [link.org_b, decidedBy, action, link.org_a, linkId, decidedAt]);
        }
        return { ok: true };
      });
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
      await pool.query(`DELETE FROM room_members rm USING rooms r
        WHERE rm.room_id = r.room_id AND r.org_id = $1
          AND rm.user_id IN (SELECT user_id FROM org_members WHERE org_id = $2)
          AND rm.user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = $1)`, [orgX, orgY]);
      await pool.query(`DELETE FROM room_members rm USING rooms r
        WHERE rm.room_id = r.room_id AND r.org_id = $2
          AND rm.user_id IN (SELECT user_id FROM org_members WHERE org_id = $1)
          AND rm.user_id NOT IN (SELECT user_id FROM org_members WHERE org_id = $2)`, [orgX, orgY]);
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

    async createFile({ fileId, ownerId, roomId, kind, size, sha256, createdAt }) {
      await pool.query('INSERT INTO files (file_id, owner_id, room_id, kind, size, sha256, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [fileId, ownerId, roomId, kind, size, sha256, 'pending', createdAt]);
    },
    async getFile(fileId) {
      const { rows } = await pool.query('SELECT file_id, owner_id, room_id, kind, size, sha256, status, created_at, completed_at FROM files WHERE file_id = $1', [fileId]);
      const r = rows[0];
      if (!r) return null;
      return { fileId: r.file_id, ownerId: r.owner_id, roomId: r.room_id, kind: r.kind, size: Number(r.size), sha256: r.sha256, status: r.status, createdAt: Number(r.created_at), completedAt: r.completed_at === null ? null : Number(r.completed_at) };
    },
    async markFileUploaded(fileId) {
      await pool.query("UPDATE files SET status = 'uploaded' WHERE file_id = $1 AND status = 'pending'", [fileId]);
    },
    async markFileReady(fileId, nowMs) {
      const { rowCount } = await pool.query("UPDATE files SET status = 'ready', completed_at = $2 WHERE file_id = $1 AND status = 'uploaded'", [fileId, nowMs]);
      return rowCount === 1;
    },
    async countPendingFiles(ownerId) {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM files WHERE owner_id = $1 AND status IN ('pending', 'uploaded')", [ownerId]);
      return rows[0].n;
    },
    async bytesForOwner(ownerId) {
      const { rows } = await pool.query("SELECT COALESCE(SUM(size), 0)::bigint AS n FROM files WHERE owner_id = $1 AND status IN ('pending', 'uploaded', 'ready')", [ownerId]);
      return Number(rows[0].n);
    },
    async purgeStaleFiles(cutoffMs) {
      const { rows } = await pool.query("DELETE FROM files WHERE status IN ('pending', 'uploaded') AND created_at < $1 RETURNING file_id", [cutoffMs]);
      return rows.map((r) => r.file_id);
    },
    async setPushToken(deviceKey, provider, token, nowMs) {
      await pool.query('INSERT INTO push_tokens (device_key, provider, token, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (device_key) DO UPDATE SET provider = EXCLUDED.provider, token = EXCLUDED.token, updated_at = EXCLUDED.updated_at', [deviceKey, provider, token, nowMs]);
    },
    async deletePushToken(deviceKey) {
      await pool.query('DELETE FROM push_tokens WHERE device_key = $1', [deviceKey]);
    },
    async devicesToNotify(roomId, excludeDeviceKey) {
      const { rows } = await pool.query('SELECT d.device_key, p.provider, p.token FROM push_tokens p JOIN devices d ON d.device_key = p.device_key JOIN room_members m ON m.user_id = d.user_id WHERE m.room_id = $1 AND d.revoked = FALSE AND p.device_key <> $2', [roomId, excludeDeviceKey]);
      return rows.map((r) => ({ deviceKey: r.device_key, provider: r.provider, token: r.token }));
    },
    async listDevicesFor(userId) {
      const { rows } = await pool.query('SELECT d.device_id, d.label, d.revoked, (p.device_key IS NOT NULL) AS push FROM devices d LEFT JOIN push_tokens p ON p.device_key = d.device_key WHERE d.user_id = $1 ORDER BY d.device_id', [userId]);
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
      // Отключённое устройство теряет ключи, одноразовые ключи и очередь доставки.
      await inTransaction(async (c) => {
        await c.query('UPDATE devices SET revoked = TRUE WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM device_keys WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM one_time_keys WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM inbox WHERE device_key = $1', [deviceKey]);
        await c.query('DELETE FROM push_tokens WHERE device_key = $1', [deviceKey]);
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

    async countOneTimeKeys(deviceKey, prefix) {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM one_time_keys WHERE device_key = $1 AND left(name, char_length($2)) = $2',
        [deviceKey, prefix],
      );
      return rows[0].n;
    },

    // ---- беседы ----
    async createRoom(roomId, owner, memberIds, opts = {}) {
      return inTransaction(async (c) => {
        const ins = await c.query('INSERT INTO rooms (room_id, owner, kind, name) VALUES ($1, $2, $3, $4) ON CONFLICT (room_id) DO NOTHING', [roomId, owner, opts.kind ?? 'group', opts.name ?? null]);
        if (ins.rowCount === 0) return false;
    if (opts.orgId) await c.query('UPDATE rooms SET org_id = $2 WHERE room_id = $1', [roomId, opts.orgId]);
        const { rows } = await c.query("SELECT value FROM counters WHERE name = 'event_seq' FOR UPDATE");
        const seq = Number(rows[0].value);
        for (const m of [...new Set(memberIds)]) {
          await c.query('INSERT INTO room_members (room_id, user_id, is_admin, joined_seq, capabilities) VALUES ($1, $2, FALSE, $3, $4::text[])', [roomId, m, seq, [...DEFAULT_MEMBER_CAPABILITIES]]);
        }
        return true;
      });
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
        const { rows } = await c.query('SELECT owner FROM rooms WHERE room_id = $1 FOR UPDATE', [roomId]);
        if (rows.length === 0) return;
        const previous = rows[0].owner;
        await c.query('UPDATE rooms SET owner = $2 WHERE room_id = $1', [roomId, newOwner]);
        await c.query('UPDATE room_members SET is_admin = FALSE WHERE room_id = $1 AND user_id IN ($2, $3)', [roomId, newOwner, previous]);
      });
    },
    async channelNameTaken(name, exceptRoomId) {
      const { rows } = await pool.query(
        "SELECT 1 FROM rooms WHERE kind = 'channel' AND lower(regexp_replace(name, '\\s+', ' ', 'g')) = $1 AND room_id IS DISTINCT FROM $2 LIMIT 1",
        [channelNameKey(name), exceptRoomId ?? null],
      );
      return rows.length > 0;
    },

    // Комнаты, где пользователь участник (G1, этап 0.7.3): без чужих комнат.
  async roomsOfUser(userId) {
    const { rows } = await pool.query(
      `SELECT r.room_id, r.kind, r.name, r.owner, m.is_admin
         FROM room_members m JOIN rooms r ON r.room_id = m.room_id
        WHERE m.user_id = $1 ORDER BY r.room_id`,
      [userId],
    );
    return rows.map((r) => ({ roomId: r.room_id, kind: r.kind, name: r.name, owner: r.owner, isAdmin: r.is_admin }));
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
    async joinPublicRoomOpen({ roomId, userId, maxMembers }) {
      return inTransaction(async (c) => {
        // The room row is the serialization point for every open-join attempt and
        // for concurrent visibility/join-policy updates.
        const { rows: roomRows } = await c.query(
          `SELECT r.kind, r.visibility, r.join_policy, r.org_id, o.status AS org_status
             FROM rooms r JOIN organizations o ON o.org_id = r.org_id
            WHERE r.room_id = $1 FOR UPDATE OF r`,
          [roomId],
        );
        const room = roomRows[0];
        if (!room) return { status: 'not_found' };
        if (room.visibility !== 'public') return { status: 'not_public' };
        if (room.join_policy !== 'open') return { status: 'not_open' };

        const { rows: existing } = await c.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, userId],
        );
        if (existing.length) return { status: 'already_member' };
        if (room.org_status !== 'approved') return { status: 'org_not_approved' };

        // Re-check organization access inside the same transaction. Share locks
        // prevent membership removal or link revocation from overtaking this join.
        const { rows: directMembership } = await c.query(
          'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2 FOR SHARE',
          [room.org_id, userId],
        );
        if (!directMembership.length) {
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
            [room.org_id, userId],
          );
          if (!linkedMembership.length) return { status: 'org_not_member' };
        }

        const { rows: countRows } = await c.query(
          'SELECT COUNT(*)::int AS n FROM room_members WHERE room_id = $1',
          [roomId],
        );
        if (room.kind !== 'channel' && Number.isFinite(maxMembers) && Number(countRows[0].n) >= maxMembers) {
          return { status: 'full' };
        }

        const { rows: seqRows } = await c.query(
          "SELECT value FROM counters WHERE name = 'event_seq' FOR UPDATE",
        );
        const inserted = await c.query(
          'INSERT INTO room_members (room_id, user_id, is_admin, joined_seq, capabilities) VALUES ($1, $2, FALSE, $3, $4::text[]) ON CONFLICT (room_id, user_id) DO NOTHING RETURNING user_id',
          [roomId, userId, Number(seqRows[0].value), [...DEFAULT_MEMBER_CAPABILITIES]],
        );
        if (!inserted.rowCount) return { status: 'already_member' };
        const { rows: members } = await c.query(
          'SELECT user_id FROM room_members WHERE room_id = $1 ORDER BY id',
          [roomId],
        );
        return { status: 'joined', members: members.map((row) => row.user_id) };
      });
    },

    async addRoomMember(roomId, userId) {
      return inTransaction(async (c) => {
        const { rows } = await c.query("SELECT value FROM counters WHERE name = 'event_seq' FOR UPDATE");
        const ins = await c.query(
          'INSERT INTO room_members (room_id, user_id, is_admin, joined_seq, capabilities) VALUES ($1, $2, FALSE, $3, $4::text[]) ON CONFLICT (room_id, user_id) DO NOTHING',
          [roomId, userId, Number(rows[0].value), [...DEFAULT_MEMBER_CAPABILITIES]],
        );
        return ins.rowCount === 1;
      });
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

    async removeRoomMember(roomId, userId) {
      await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
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
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND consumed_at IS NULL AND last_resort = FALSE AND created_at >= $3', [userId, deviceId, nowMs - MLS_REGULAR_MAX_AGE_MS]);
      return rows[0].n;
    },
    async mlsStoreLastResort(userId, deviceId, bytes, createdAt) {
      await inTransaction(async (c) => {
        await c.query('DELETE FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND last_resort = TRUE', [userId, deviceId]);
        await c.query('INSERT INTO mls_key_packages (user_id, device_id, package, created_at, last_resort) VALUES ($1, $2, $3, $4, TRUE)', [userId, deviceId, bytes, createdAt]);
      });
    },

    async mlsStoreKeyPackages(userId, deviceId, packages, createdAt) {
      for (const bytes of packages) {
        await pool.query('INSERT INTO mls_key_packages (user_id, device_id, package, created_at) VALUES ($1, $2, $3, $4)', [userId, deviceId, bytes, createdAt]);
      }
    },

    /** Durable KeyPackage reservation. Repeated claim IDs return the exact same package set. */
    async mlsClaimKeyPackages(targetUserId, requesterUserId, requesterDeviceId, claimId, roomId, nowMs) {
      return inTransaction(async (c) => {
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
            packages: claim.result.map((item) => ({
              deviceId: item.deviceId,
              packageId: item.packageId ?? null,
              package: Buffer.from(item.package, 'base64'),
            })),
          };
        }

        const { rows: devices } = await c.query(
          'SELECT DISTINCT device_id FROM mls_key_packages WHERE user_id = $1 AND consumed_at IS NULL ORDER BY device_id',
          [targetUserId],
        );
        const out = [];
        for (const { device_id: deviceId } of devices) {
          const { rows } = await c.query(
            'UPDATE mls_key_packages SET consumed_at = $3 WHERE id = (SELECT id FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND consumed_at IS NULL AND last_resort = FALSE AND created_at >= $4 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, package',
            [targetUserId, deviceId, nowMs, nowMs - MLS_REGULAR_MAX_AGE_MS],
          );
          if (rows[0]) { out.push({ deviceId, packageId: Number(rows[0].id), package: rows[0].package }); continue; }
          const { rows: fallback } = await c.query(
            'SELECT id, package FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND last_resort = TRUE AND created_at >= $3 ORDER BY id DESC LIMIT 1',
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

    async appendRoomEvent(roomId, sender, type, content, nowMs) {
      return inTransaction(async (c) => {
        const { rows } = await c.query("UPDATE counters SET value = value + 1 WHERE name = 'event_seq' RETURNING value");
        const seq = Number(rows[0].value);
        await c.query(
          'INSERT INTO room_events (seq, room_id, sender, origin_ts, type, content) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
          [seq, roomId, sender, nowMs, type, JSON.stringify(content ?? null)],
        );
        return seq;
      });
    },

    async roomEventRows(roomId, sinceSeq) {
      const { rows } = await pool.query(
        'SELECT seq, room_id, sender, origin_ts, type, content FROM room_events WHERE room_id = $1 AND seq > $2 ORDER BY seq',
        [roomId, sinceSeq],
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
    async mlsApplyCommit(roomId, baseEpoch, { senderId, deviceId, clientOperationId, requestFingerprint, keyPackageClaimId, commit, welcomes, changes = { adds: [], removes: [] } }, nowMs) {
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
      const { rows } = await pool.query('SELECT id, room_id, epoch, welcome FROM mls_welcomes WHERE user_id = $1 AND device_id = $2 AND acked_at IS NULL ORDER BY id', [userId, deviceId]);
      return rows.map((r) => ({ id: Number(r.id), roomId: r.room_id, epoch: Number(r.epoch), welcome: r.welcome }));
    },

    async mlsDropDevicePackages(userId, deviceId) {
      await pool.query('DELETE FROM mls_key_packages WHERE user_id = $1 AND device_id = $2 AND consumed_at IS NULL', [userId, deviceId]);
      await pool.query('DELETE FROM mls_welcomes WHERE user_id = $1 AND device_id = $2 AND acked_at IS NULL', [userId, deviceId]);
    },

    async mlsAckWelcome(id, userId, deviceId, nowMs) {
      const { rowCount } = await pool.query('UPDATE mls_welcomes SET acked_at = $4 WHERE id = $1 AND user_id = $2 AND device_id = $3 AND acked_at IS NULL', [id, userId, deviceId, nowMs]);
      return rowCount === 1;
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
      const { rows } = await pool.query('SELECT email, email_verified, nickname, created_at FROM profiles WHERE user_id = $1', [userId]);
      return rows[0]
        ? { email: rows[0].email, emailVerified: rows[0].email_verified, nickname: rows[0].nickname, createdAt: Number(rows[0].created_at) }
        : null;
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
    async createVerifiedAccount({ userId, passwordHash, email, nickname, nowMs, provider = null, joinDefaultOrg = false }) {
      try {
        return await inTransaction(async (c) => {
          await c.query('INSERT INTO accounts (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
          if (joinDefaultOrg) await c.query("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ('org-default', $1, 'member', $2) ON CONFLICT DO NOTHING", [userId, Date.now()]);
          await c.query(
            'INSERT INTO profiles (user_id, email, email_verified, nickname, created_at) VALUES ($1, $2, TRUE, $3, $4)',
            [userId, email, nickname, nowMs],
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
          tokenHash: r.token_hash, tokenExpiresAt: Number(r.token_expires_at),
        };
        const { next, result } = change(current);
        await c.query(
          `UPDATE email_codes SET code_hash = $2, code_attempts = $3, code_expires_at = $4, token_hash = $5, token_expires_at = $6
           WHERE email = $1`,
          [email, next.codeHash, next.codeAttempts, next.codeExpiresAt, next.tokenHash, next.tokenExpiresAt],
        );
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

    async backupEmailRemove(userId) {
      const { rowCount } = await pool.query('DELETE FROM backup_emails WHERE user_id = $1', [userId]);
      return rowCount > 0;
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
