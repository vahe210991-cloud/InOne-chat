// ============================================================================
// Память PoC: тот же интерфейс, что у store.js (PostgreSQL), но без базы.
// Операции синхронные: JavaScript не чередует их, поэтому гонок нет.
// Правила PIN совпадают с store.js (verifyPin). Токены лежат как ключевые хэши, как и в базе.
// ============================================================================
import { channelNameKey } from './room-names.js';
import { MLS_REGULAR_MAX_AGE_MS, MLS_LAST_RESORT_MAX_AGE_MS } from './mls-rules.js';
import { DEFAULT_ADMIN_CAPABILITIES, DEFAULT_MEMBER_CAPABILITIES } from './room-permissions.js';
import { createHmac, randomBytes } from 'node:crypto';
import { decideLogin } from './login-throttle.js';
import { freshRecovery } from './recovery-rules.js';
import { freshPhone } from './phone-rules.js';
import { applyHit } from './rate-limit.js';
import { freshEmailCode } from './email-code-rules.js';

export function createMemoryStore({ pinPepper }) {
  const keyed = (label, value) => createHmac('sha256', pinPepper).update(`${label}|${value}`).digest('hex');
  const accounts = new Map(); // пользователь -> хэш пароля
  const pins = new Map();     // пользователь -> { hash, failed, lockedUntil }
  const devices = new Map();  // ключ устройства -> { userId, deviceId, label, revoked }
  const tokens = new Map();   // ключевой хэш токена доступа -> { deviceKey, expiresAt }
  const refreshes = new Map();
  const files = new Map();
  const pushTokens = new Map(); // ключ устройства -> { provider, token, updatedAt }
  const flagValues = new Map();
  const flagUpdated = new Map();
  const flagLog = new Map();
  const delivered = new Map(); // ключ устройства|поток -> наибольший отданный номер
  const DEFAULT_ORG_ID = 'org-default';
  const ORG_ROLES = ['owner', 'admin', 'member'];
  const ORG_STATUSES = ['pending', 'approved', 'rejected'];
  const organizations = new Map([[DEFAULT_ORG_ID, { orgId: DEFAULT_ORG_ID, name: 'Основная', status: 'approved', createdBy: null, createdAt: 0 }]]);
  const orgMembers = new Map(); // org_id -> Map(user_id -> { role, joinedAt })
  const platformRoles = new Map();
  const orgRequests = new Map();
  const orgRequestDocs = new Map();
  const orgRequestLog = [];
  const orgSettingsMap = new Map();
  const orgSettingsLog = [];
  const orgLinks = new Map();
  const adminActions = [];
  function addOrgMembership(orgId, userId, role, joinedAt) {
    if (!ORG_ROLES.includes(role)) throw new Error('invalid role');
    if (!organizations.has(orgId)) throw new Error('unknown organization');
    let members = orgMembers.get(orgId);
    if (!members) { members = new Map(); orgMembers.set(orgId, members); }
    if (members.has(userId)) return false;
    members.set(userId, { role, joinedAt });
    return true;
  } // ключевой хэш токена обновления -> { deviceKey, expiresAt, usedAt }
  const throttle = new Map();      // ключ счётчика входа -> { failed, windowStart, blockedUntil }
  const recovery = new Map();      // пользователь -> состояние восстановления (см. recovery-rules.js)
  const phones = new Map();        // пользователь -> телефон аккаунта (см. phone-rules.js)
  const rates = new Map();         // ключ лимита -> { windowStart, hits }
  const profiles = new Map();      // пользователь -> почта и никнейм (этап 1 модели аккаунта)
  const emailCodes = new Map();    // почта -> код и токен регистрации
  const providerLinks = new Map(); // provider|sub -> { userId, email, linkedAt } (этап 2)
  const authTokens = new Map();    // kind|хэш -> { userId, payload, expiresAt } (одноразовые)
  const backupEmails = new Map();  // userId -> { email, createdAt } (запасная почта)
  const deviceWaits = new Map();   // userId|deviceId -> { activateAt, cancelHash, ... } (отложенный вход)
  const recoveryCancels = new Map(); // userId -> { codeHash, expiresAt } (код отмены восстановления)
  const signingKeys = new Map();     // deviceKey -> открытый ключ устройства (этап 2б)
  const deviceKeys = new Map();    // ключ устройства -> публичные ключи устройства
  const oneTimeKeys = new Map();   // ключ устройства -> Map(имя -> значение)
  const inbox = new Map();         // ключ устройства -> события очереди доставки
  const sends = new Map();         // (отправитель, тип, номер) -> время отправки
  const rooms = new Map();
  const mlsPackages = [];
  const mlsPackageClaims = new Map();
  const mlsGroups = new Map();
  const mlsCommitOperations = new Map();
  const mlsCommits = [];
  const mlsWelcomes = [];
  const deviceRemovals = [];
  const clientMessages = [];         // беседа -> { owner, admins, members, joinedSeq, events }
  const counters = { eventSeq: 0, inboxSeq: 0 };
  const approvals = new Map();     // идентификатор -> запрос подтверждения входа
  const copy = (d) => ({ userId: d.userId, deviceId: d.deviceId, label: d.label, revoked: d.revoked, createdAt: d.createdAt });

  return {
    hasAccount: (userId) => accounts.has(userId),
    accountHash: (userId) => accounts.get(userId) ?? null,
    addAccount(userId, passwordHash, opts = {}) {
      if (accounts.has(userId)) return false;
      accounts.set(userId, passwordHash);
      if (opts.joinDefaultOrg) addOrgMembership(DEFAULT_ORG_ID, userId, 'member', Date.now());
      return true;
    },

    hasPin: (userId) => pins.has(userId),
    pinHash: (userId) => pins.get(userId)?.hash ?? null,
    setPin(userId, pinHash) {
      pins.set(userId, { hash: pinHash, failed: 0, lockedUntil: null });
    },
    removePin(userId) {
      pins.delete(userId);
    },

    verifyPin(userId, pin, { now, free, lockDuration, check }) {
      const rec = pins.get(userId);
      if (!rec) return { ok: false, reason: 'no-pin' };
      if (rec.lockedUntil && now < rec.lockedUntil) return { ok: false, reason: 'locked', retryAt: rec.lockedUntil };
      const expiredLockCleared = !!rec.lockedUntil && now >= rec.lockedUntil;
      if (expiredLockCleared) rec.lockedUntil = null;
      rec.failed += 1;
      const attempt = rec.failed;
      if (attempt > free && !expiredLockCleared) {
        rec.lockedUntil = now + lockDuration(attempt);
        return { ok: false, reason: 'locked', retryAt: rec.lockedUntil };
      }
      if (check(pin, rec.hash)) {
        rec.failed = 0;
        rec.lockedUntil = null;
        return { ok: true };
      }
      if (attempt >= free) rec.lockedUntil = now + lockDuration(attempt);
      return { ok: false, reason: 'wrong' };
    },

    addDevice(userId, deviceId, label = null, createdAt = 0) {
      const dk = `${userId}|${deviceId}`;
      if (!devices.has(dk)) devices.set(dk, { userId, deviceId, label, revoked: false, createdAt });
      return dk;
    },
    deviceRecord: (dk) => (devices.has(dk) ? copy(devices.get(dk)) : null),
    activeDeviceCount: (userId) => [...devices.values()].filter((d) => d.userId === userId && !d.revoked).length,
    activeDevices: () => [...devices.values()].filter((d) => !d.revoked).map(copy),
    devicesOfUser: (userId) => [...devices.values()].filter((d) => d.userId === userId).map(copy),
    createFile({ fileId, ownerId, roomId, kind, size, sha256, createdAt }) {
      files.set(fileId, { fileId, ownerId, roomId, kind, size, sha256, status: 'pending', createdAt, completedAt: null });
    },
    getFile(fileId) {
      const f = files.get(fileId);
      return f ? { ...f } : null;
    },
    markFileUploaded(fileId) {
      const f = files.get(fileId);
      if (f && f.status === 'pending') f.status = 'uploaded';
    },
    markFileReady(fileId, nowMs) {
      const f = files.get(fileId);
      if (!f || f.status !== 'uploaded') return false;
      f.status = 'ready';
      f.completedAt = nowMs;
      return true;
    },
    countPendingFiles(ownerId) {
      return [...files.values()].filter((f) => f.ownerId === ownerId && (f.status === 'pending' || f.status === 'uploaded')).length;
    },
    bytesForOwner(ownerId) {
      return [...files.values()].filter((f) => f.ownerId === ownerId && ['pending', 'uploaded', 'ready'].includes(f.status)).reduce((sum, f) => sum + f.size, 0);
    },
    purgeStaleFiles(cutoffMs) {
      const removed = [];
      for (const [id, f] of files) {
        if ((f.status === 'pending' || f.status === 'uploaded') && f.createdAt < cutoffMs) {
          files.delete(id);
          removed.push(id);
        }
      }
      return removed;
    },
    setPushToken(deviceKey, provider, token, nowMs) {
      pushTokens.set(deviceKey, { provider, token, updatedAt: nowMs });
    },
    deletePushToken(deviceKey) {
      pushTokens.delete(deviceKey);
    },
    devicesToNotify(roomId, excludeDeviceKey) {
      const room = rooms.get(roomId);
      if (!room) return [];
      const out = [];
      for (const [dk, p] of pushTokens) {
        const d = devices.get(dk);
        if (dk !== excludeDeviceKey && d && !d.revoked && room.members.has(d.userId)) out.push({ deviceKey: dk, provider: p.provider, token: p.token });
      }
      return out;
    },
    listDevicesFor(userId) {
      return [...devices.entries()].filter(([, d]) => d.userId === userId).map(([dk, d]) => ({ deviceId: d.deviceId, label: d.label, revoked: !!d.revoked, pushRegistered: pushTokens.has(dk) })).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
    },
    flagOverrides() {
      return Object.fromEntries(flagValues);
    },
    flagVersion() {
      return flagUpdated.size ? Math.max(...flagUpdated.values()) : 0;
    },
    setFlag(key, value, actor, reason, nowMs) {
      const old = flagValues.has(key) ? flagValues.get(key) : null;
      flagValues.set(key, value);
      flagUpdated.set(key, nowMs);
      if (!flagLog.has(key)) flagLog.set(key, []);
      flagLog.get(key).push({ old_value: old === null ? null : JSON.stringify(old), new_value: JSON.stringify(value), actor, reason, changed_at: nowMs });
    },
    flagHistory(key) {
      return flagLog.get(key) ?? [];
    },
    purgeExpired(nowMs) {
      let inboxRemoved = 0;
      for (const [dk, list] of inbox) {
        const alive = list.filter((e) => e.expiresAt > nowMs);
        inboxRemoved += list.length - alive.length;
        inbox.set(dk, alive);
      }
      let tokensRemoved = 0;
      for (const [h, t] of tokens) if (t.expiresAt <= nowMs) { tokens.delete(h); tokensRemoved += 1; }
      let refreshRemoved = 0;
      for (const [h, t] of refreshes) if (t.expiresAt <= nowMs) { refreshes.delete(h); refreshRemoved += 1; }
      let authRemoved = 0;
      for (const [k, t] of authTokens) if (t.expiresAt < nowMs) { authTokens.delete(k); authRemoved += 1; }
      let cancelRemoved = 0;
      for (const [u, c] of recoveryCancels) if (c.expiresAt <= nowMs) { recoveryCancels.delete(u); cancelRemoved += 1; }
      return { inbox: inboxRemoved, tokens: tokensRemoved, refreshTokens: refreshRemoved, authTokens: authRemoved, recoveryCancelCodes: cancelRemoved };
    },
    clearExpiredCodes(nowMs) {
      let phoneCodes = 0;
      for (const p of phones.values()) if (p.codeExpiresAt > 0 && p.codeExpiresAt <= nowMs) { p.codeHash = null; p.codeAttempts = 0; p.codeExpiresAt = 0; phoneCodes += 1; }
      let emailCodesCleared = 0;
      let emailRows = 0;
      for (const [e, c] of emailCodes) {
        if (c.codeExpiresAt > 0 && c.codeExpiresAt <= nowMs) { c.codeHash = null; c.codeAttempts = 0; c.codeExpiresAt = 0; emailCodesCleared += 1; }
        if (c.tokenExpiresAt > 0 && c.tokenExpiresAt <= nowMs) { c.tokenHash = null; c.tokenExpiresAt = 0; emailCodesCleared += 1; }
        if (c.codeHash == null && c.tokenHash == null) { emailCodes.delete(e); emailRows += 1; }
      }
      let recoveryRequests = 0;
      for (const r of recovery.values()) if (r.reqExpiresAt > 0 && r.reqExpiresAt <= nowMs) { r.reqCodeHash = null; r.reqLinkHash = null; recoveryRequests += 1; }
      return { phoneCodes, emailCodes: emailCodesCleared, emailRows, recoveryRequests };
    },
    purgeRetired(nowMs) {
      const retention = 30 * 24 * 3600_000;
      let approvalsRemoved = 0;
      for (const [id, a] of approvals) if (a.expiresAt + retention <= nowMs) { approvals.delete(id); approvalsRemoved += 1; }
      let invitesRemoved = 0;
      for (const r of rooms.values()) for (const [id, inv] of r.invites) if (inv.expiresAt + retention <= nowMs) { r.invites.delete(id); invitesRemoved += 1; }
      return { approvals: approvalsRemoved, invites: invitesRemoved };
    },
    createOrganization({ orgId, name, status, createdBy, createdAt }) {
      if (!ORG_STATUSES.includes(status)) throw new Error('invalid organization status');
      if (organizations.has(orgId)) throw new Error('organization exists');
      organizations.set(orgId, { orgId, name, status, createdBy: createdBy ?? null, createdAt });
    },
    addOrgMember(orgId, userId, role, joinedAt) {
      return addOrgMembership(orgId, userId, role, joinedAt);
    },
    orgRoleOf(orgId, userId) {
      return orgMembers.get(orgId)?.get(userId)?.role ?? null;
    },
    listUserOrgs(userId) {
      const out = [];
      for (const [orgId, members] of orgMembers) {
        const m = members.get(userId);
        if (m) out.push({ orgId, name: organizations.get(orgId).name, status: organizations.get(orgId).status, role: m.role });
      }
      return out.sort((a, b) => a.orgId.localeCompare(b.orgId));
    },
    roomOrg(roomId) {
      return rooms.get(roomId)?.orgId ?? null;
    },
    orgStatus(orgId) {
      return organizations.get(orgId)?.status ?? null;
    },
    setPlatformRole(userId, role) { platformRoles.set(userId, role); },
    platformRoleOf(userId) { return platformRoles.get(userId) ?? null; },
    createOrgRequest({ requestId, applicantId, name, createdAt }) {
      orgRequests.set(requestId, { requestId, applicantId, name, status: 'pending', orgId: null, createdAt, decidedAt: null, decidedBy: null });
      orgRequestLog.push({ requestId, actor: applicantId, action: 'created', at: createdAt });
    },
    getOrgRequest(requestId) { const r = orgRequests.get(requestId); return r ? { ...r } : null; },
    listOrgRequests({ userId, all }) {
      return [...orgRequests.values()].filter((r) => all || r.applicantId === userId).map((r) => ({ requestId: r.requestId, applicantId: r.applicantId, name: r.name, status: r.status, createdAt: r.createdAt })).sort((a, b) => a.createdAt - b.createdAt);
    },
    addOrgRequestDocument({ docId, requestId, kind, size, sha256, objectKey, uploadedBy, createdAt }) {
      orgRequestDocs.set(docId, { docId, requestId, kind, size, sha256, objectKey, uploadedBy, createdAt });
      orgRequestLog.push({ requestId, actor: uploadedBy, action: 'document', at: createdAt });
    },
    listOrgRequestDocuments(requestId) {
      return [...orgRequestDocs.values()].filter((x) => x.requestId === requestId).map((x) => ({ docId: x.docId, kind: x.kind, size: x.size, sha256: x.sha256, createdAt: x.createdAt })).sort((a, b) => a.createdAt - b.createdAt);
    },
    getOrgRequestDocument(docId) { const x = orgRequestDocs.get(docId); return x ? { ...x } : null; },
    decideOrgRequest({ requestId, status, decidedBy, decidedAt, orgId }) {
      const r = orgRequests.get(requestId);
      r.status = status; r.decidedBy = decidedBy; r.decidedAt = decidedAt; r.orgId = orgId;
      orgRequestLog.push({ requestId, actor: decidedBy, action: status === 'approved' ? 'approve' : 'reject', at: decidedAt });
    },
    logOrgRequest(requestId, actor, action, at) { orgRequestLog.push({ requestId, actor, action, at }); },
    listOrgRequestLog(requestId) { return orgRequestLog.filter((x) => x.requestId === requestId).map((x) => ({ actor: x.actor, action: x.action, at: x.at })); },
    listOrgMembers(orgId) {
      return [...(orgMembers.get(orgId) ?? new Map()).entries()].map(([userId, m]) => ({ userId, role: m.role })).sort((a, b) => a.userId.localeCompare(b.userId));
    },
    setOrgMemberRole(orgId, userId, role) {
      const m = orgMembers.get(orgId)?.get(userId);
      if (m) m.role = role;
    },
    countOrgOwners(orgId) {
      let n = 0;
      for (const m of (orgMembers.get(orgId) ?? new Map()).values()) if (m.role === 'owner') n += 1;
      return n;
    },
    countOwnedRoomsInOrg(orgId, userId) {
      let n = 0;
      for (const r of rooms.values()) if (r.orgId === orgId && r.owner === userId) n += 1;
      return n;
    },
    removeOrgMember(orgId, userId) {
      for (const r of rooms.values()) if (r.orgId === orgId) { r.members.delete(userId); r.admins.delete(userId); }
      orgMembers.get(orgId)?.delete(userId);
    },
    purgeRejectedOrgRequests(cutoffMs) {
      const keys = [];
      for (const [id, r] of orgRequests) {
        if (r.status === 'rejected' && r.decidedAt <= cutoffMs) {
          for (const [docId, d] of orgRequestDocs) if (d.requestId === id) { keys.push(d.objectKey); orgRequestDocs.delete(docId); }
          orgRequests.delete(id);
        }
      }
      for (let i = orgRequestLog.length - 1; i >= 0; i--) if (!orgRequests.has(orgRequestLog[i].requestId)) orgRequestLog.splice(i, 1);
      return keys;
    },
    orgSettings(orgId) {
      const s = orgSettingsMap.get(orgId);
      return s ? { ...s } : { maxGroupMembers: null, channelsEnabled: true, fileQuotaBytes: null };
    },
    setOrgSetting({ orgId, field, value, actor, at }) {
      const cur = { maxGroupMembers: null, channelsEnabled: true, fileQuotaBytes: null, ...(orgSettingsMap.get(orgId) ?? {}) };
      const old = cur[field];
      cur[field] = value;
      orgSettingsMap.set(orgId, cur);
      orgSettingsLog.push({ orgId, actor, field, old, new: value, at });
    },
    listOrgSettingsLog(orgId) {
      return orgSettingsLog.filter((e) => e.orgId === orgId).map((e) => ({ actor: e.actor, field: e.field, old: e.old, new: e.new, at: e.at }));
    },
    bytesForOrg(orgId) {
      let n = 0;
      for (const f of files.values()) { const r = rooms.get(f.roomId); if (r && r.orgId === orgId) n += f.size; }
      return n;
    },
    createOrgLink({ linkId, proposingOrg, otherOrg, proposedBy, createdAt }) {
      const a = proposingOrg < otherOrg ? proposingOrg : otherOrg;
      const b = proposingOrg < otherOrg ? otherOrg : proposingOrg;
      for (const l of [...orgLinks.values()]) {
        if (l.orgA === a && l.orgB === b) {
          if (l.status !== 'revoked') return false;
          orgLinks.delete(l.linkId);
        }
      }
      orgLinks.set(linkId, { linkId, orgA: a, orgB: b, status: 'proposed', proposingOrg, proposedBy, decidedBy: null, createdAt, decidedAt: null });
      return true;
    },
    getOrgLink(linkId) {
      const l = orgLinks.get(linkId);
      return l ? { linkId: l.linkId, orgA: l.orgA, orgB: l.orgB, status: l.status, proposingOrg: l.proposingOrg } : null;
    },
    setOrgLinkStatus({ linkId, status, decidedBy, decidedAt }) {
      const l = orgLinks.get(linkId);
      l.status = status; l.decidedBy = decidedBy; l.decidedAt = decidedAt;
    },
    transitionOrgLinkStatus({ linkId, fromStatus, status, decidedBy, decidedAt }) {
      const l = orgLinks.get(linkId);
      if (!l || l.status !== fromStatus) return false;
      l.status = status;
      l.decidedBy = decidedBy;
      l.decidedAt = decidedAt;
      return true;
    },
    activeLinkBetween(x, y) {
      const a = x < y ? x : y;
      const b = x < y ? y : x;
      for (const l of orgLinks.values()) if (l.orgA === a && l.orgB === b && l.status === 'active') return true;
      return false;
    },
    orgLinksFor(orgId) {
      return [...orgLinks.values()].filter((l) => l.orgA === orgId || l.orgB === orgId).map((l) => ({ linkId: l.linkId, orgA: l.orgA, orgB: l.orgB, status: l.status, proposingOrg: l.proposingOrg }));
    },
    removeCrossOrgMemberships(orgX, orgY) {
      const inOrg = (org, u) => orgMembers.get(org)?.has(u) ?? false;
      for (const r of rooms.values()) {
        if (r.orgId !== orgX && r.orgId !== orgY) continue;
        const other = r.orgId === orgX ? orgY : orgX;
        for (const u of [...r.members]) if (inOrg(other, u) && !inOrg(r.orgId, u)) { r.members.delete(u); r.admins.delete(u); }
      }
    },
    logAdminAction({ orgId, actor, action, target, detail, at }) {
      adminActions.push({ orgId: orgId ?? null, actor, action, target: target ?? null, detail: detail ?? null, at });
    },
    listAdminActions(orgId) {
      return adminActions.filter((a) => a.orgId === (orgId ?? null)).map((a) => ({ actor: a.actor, action: a.action, target: a.target, detail: a.detail, at: a.at }));
    },
    removePlatformRole(userId) { platformRoles.delete(userId); },
    listPlatformRoles() { return [...platformRoles.entries()].map(([userId, role]) => ({ userId, role })).sort((x, y) => x.userId.localeCompare(y.userId)); },
    // Только для тестов: задать ник уже созданному аккаунту (по HTTP этот метод недоступен).
    setNicknameForTests(userId, nickname) {
      const p = profiles.get(userId) ?? { email: `${userId.replace(/[^a-z0-9]/gi, '')}@test.invalid`, emailVerified: true, nickname: '', createdAt: Date.now() };
      p.nickname = nickname;
      profiles.set(userId, p);
    },
    revokeDevice(dk) {
      const d = devices.get(dk);
      if (d) d.revoked = true;
      deviceKeys.delete(dk);
      oneTimeKeys.delete(dk);
      inbox.delete(dk);
      pushTokens.delete(dk);
    },
    issueSession(dk, nowMs, accessTtlMs, refreshTtlMs) {
      const accessToken = randomBytes(16).toString('hex');
      const refreshToken = randomBytes(16).toString('hex');
      const accessExpiresAt = nowMs + accessTtlMs;
      const refreshExpiresAt = nowMs + refreshTtlMs;
      tokens.set(keyed('token', accessToken), { deviceKey: dk, expiresAt: accessExpiresAt });
      refreshes.set(keyed('refresh', refreshToken), { deviceKey: dk, expiresAt: refreshExpiresAt, usedAt: null });
      return { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt };
    },
    deviceKeyForToken: (raw, nowMs) => {
      const t = tokens.get(keyed('token', raw));
      return t && t.expiresAt > nowMs ? t.deviceKey : null;
    },
    accessTokenState: (raw, nowMs) => {
      const t = tokens.get(keyed('token', raw));
      if (!t) return 'unknown';
      return t.expiresAt > nowMs ? 'valid' : 'expired';
    },
    consumeRefreshToken: (raw, nowMs) => {
      const t = refreshes.get(keyed('refresh', raw));
      if (!t) return { state: 'unknown' };
      if (t.usedAt !== null) return { state: 'reused', deviceKey: t.deviceKey };
      if (t.expiresAt <= nowMs) return { state: 'expired' };
      t.usedAt = nowMs;
      return { state: 'ok', deviceKey: t.deviceKey };
    },
    endSession: (dk) => {
      for (const [h, t] of tokens) if (t.deviceKey === dk) tokens.delete(h);
      for (const [h, t] of refreshes) if (t.deviceKey === dk) refreshes.delete(h);
    },
    tokenHashes: () => [...tokens.keys()],
    // ---- защита входа (D7): счётчики пары, адреса и логина ----
    throttledLogin({ pairKey, sourceKey, loginKey, now: nowMs, verify, policy, notify }) {
      const r = decideLogin({
        pair: throttle.get(pairKey), source: throttle.get(sourceKey), login: throttle.get(loginKey),
        nowMs, verify, notify, policy,
      });
      throttle.set(pairKey, r.pair);
      throttle.set(sourceKey, r.source);
      throttle.set(loginKey, r.login);
      return { status: r.status, retryAt: r.retryAt, notify: r.notify };
    },

    // ---- запросы подтверждения входа с нового устройства ----
    createApproval(row, { max, now: nowMs }) {
      const pending = [...approvals.values()].filter((a) => a.userId === row.userId && a.status === 'pending' && nowMs < a.expiresAt).length;
      if (pending >= max) return false;
      approvals.set(row.id, { ...row });
      return true;
    },
    listPendingApprovals(userId, nowMs) {
      return [...approvals.values()]
        .filter((a) => a.userId === userId && a.status === 'pending' && nowMs < a.expiresAt)
        .map((a) => ({ id: a.id, label: a.label, platform: a.platform, createdAt: a.createdAt, expiresAt: a.expiresAt }));
    },
    readApprovalForClaim(id, pollHash, nowMs) {
      const a = approvals.get(id);
      if (!a || a.pollHash !== pollHash || a.status === 'consumed') return { status: 'unknown' };
      if (a.status === 'denied') return { status: 'denied' };
      if (a.status === 'pending' && nowMs >= a.expiresAt) a.status = 'expired';
      if (a.status === 'expired') return { status: 'expired' };
      if (a.status === 'pending') return { status: 'pending' };
      return { status: 'approved', userId: a.userId, deviceId: a.deviceId, label: a.label };
    },
    consumeApproval(id) {
      const a = approvals.get(id);
      if (!a || a.status !== 'approved') return false;
      a.status = 'consumed';
      return true;
    },
    decideApproval(id, userId, action, { now: nowMs, codeMatches, max }) {
      const a = approvals.get(id);
      if (!a || a.userId !== userId || a.status !== 'pending' || nowMs >= a.expiresAt) return { status: 'unknown' };
      if (action === 'deny') {
        a.status = 'denied';
        return { status: 'denied', label: a.label };
      }
      if (!codeMatches(a.codeHash)) {
        a.attempts += 1;
        const denied = a.attempts >= max;
        if (denied) a.status = 'denied';
        return { status: 'wrong', denied, label: a.label };
      }
      a.status = 'approved';
      return { status: 'approved', label: a.label };
    },
    setPasswordHash(userId, passwordHash) {
      if (accounts.has(userId)) accounts.set(userId, passwordHash);
    },

    // ---- состояние восстановления (то же поведение, что в PostgreSQL) ----
    recoveryGet(userId) {
      const cur = recovery.get(userId);
      return cur ? structuredClone(cur) : freshRecovery();
    },
    recoveryUpdate(userId, change) {
      if (!accounts.has(userId)) return change(freshRecovery()).result;
      const cur = recovery.get(userId);
      const { next, result } = change(cur ? structuredClone(cur) : freshRecovery());
      recovery.set(userId, structuredClone(next));
      return result;
    },
    recoveryHashes() {
      return Object.fromEntries([...recovery]
        .filter(([, r]) => r.reqCodeHash)
        .map(([u, r]) => [u, { status: r.reqStatus, codeHash: r.reqCodeHash }]));
    },

    // ---- ключи устройств и одноразовые ключи ----
    putDeviceKeys(deviceKey, keys) {
      deviceKeys.set(deviceKey, structuredClone(keys));
    },
    queryDeviceKeys(userId) {
      const out = {};
      for (const [dk, keys] of deviceKeys) {
        const d = devices.get(dk);
        if (d && !d.revoked && d.userId === userId) out[d.deviceId] = structuredClone(keys);
      }
      return out;
    },
    addOneTimeKeys(deviceKey, keys) {
      if (!oneTimeKeys.has(deviceKey)) oneTimeKeys.set(deviceKey, new Map());
      const pool = oneTimeKeys.get(deviceKey);
      for (const [name, value] of Object.entries(keys)) if (!pool.has(name)) pool.set(name, structuredClone(value));
    },
    countOneTimeKeys(deviceKey, prefix) {
      return [...(oneTimeKeys.get(deviceKey)?.keys() ?? [])].filter((n) => n.startsWith(prefix)).length;
    },
    claimOneTimeKey(deviceKey) {
      const pool = oneTimeKeys.get(deviceKey);
      if (!pool || pool.size === 0) return null;
      const [name, value] = pool.entries().next().value;
      pool.delete(name); // одноразовый ключ выдаётся один раз
      return { [name]: value };
    },

    // ---- очередь доставки: события с номером и сроком хранения ----
    enqueue(deviceKey, stream, body, dedupeKey, expiresAt) {
      const q = inbox.get(deviceKey) ?? [];
      const kept = dedupeKey == null ? q : q.filter((e) => !(e.stream === stream && e.dedupeKey === dedupeKey));
      kept.push({ id: ++counters.inboxSeq, expiresAt, stream, dedupeKey: dedupeKey ?? null, body: structuredClone(body) });
      inbox.set(deviceKey, kept);
    },
    deliveredMax(deviceKey, stream) {
      return delivered.get(`${deviceKey}|${stream}`) ?? 0;
    },
    markDelivered(deviceKey, stream, id) {
      const k = `${deviceKey}|${stream}`;
      delivered.set(k, Math.max(delivered.get(k) ?? 0, id));
    },
    drainQueue(deviceKey, acked, signalAcked, nowMs) {
      const alive = (inbox.get(deviceKey) ?? []).filter((e) =>
        e.expiresAt > nowMs && (e.stream === 'to_device' ? e.id > acked : e.id > signalAcked));
      inbox.set(deviceKey, alive);
      return alive.map((e) => ({ id: e.id, stream: e.stream, dedupeKey: e.dedupeKey, body: structuredClone(e.body) }));
    },
    recordSend(senderKey, type, txn, nowMs, windowMs = 7 * 24 * 60 * 60 * 1000) {
      const k = `${senderKey}|${type}|${txn}`;
      const prev = sends.get(k);
      if (prev !== undefined && nowMs - prev < windowMs) return false;
      sends.set(k, nowMs);
      return true;
    },

    // ---- беседы ----
    createRoom(roomId, owner, memberIds, opts = {}) {
      if (rooms.has(roomId)) return false;
      const members = [...new Set(memberIds)];
      rooms.set(roomId, {
        owner, orgId: opts.orgId ?? DEFAULT_ORG_ID, admins: new Set(), members: new Set(members),
        joinedSeq: new Map(members.map((m) => [m, counters.eventSeq])), events: [],
        capabilities: new Map(members.map((m) => [m, [...DEFAULT_MEMBER_CAPABILITIES]])),
        name: opts.name ?? null,
      kind: opts.kind ?? 'group', visibility: 'private', readUpTo: new Map(members.map((m) => [m, 0])),
        joinPolicy: 'approval', joinRequests: new Map(), invites: new Map(),
        description: '', backgroundColor: null, avatarAssetId: null, coverAssetId: null, backgroundAssetId: null, assets: new Map(),
      });
      return true;
    },
    getRoom(roomId) {
      const r = rooms.get(roomId);
      if (!r) return null;
      return { owner: r.owner, admins: [...r.admins], members: [...r.members], joinedSeq: Object.fromEntries(r.joinedSeq), capabilities: Object.fromEntries(r.capabilities), name: r.name, visibility: r.visibility, readUpTo: Object.fromEntries(r.readUpTo), joinPolicy: r.joinPolicy, description: r.description, backgroundColor: r.backgroundColor, avatarAssetId: r.avatarAssetId, coverAssetId: r.coverAssetId, backgroundAssetId: r.backgroundAssetId };
    },
    transferRoomOwner(roomId, newOwner) {
      const r = rooms.get(roomId);
      if (!r) return;
      const previous = r.owner;
      r.owner = newOwner;
      r.admins.delete(newOwner);
      r.admins.delete(previous);
    },
    channelNameTaken(name, exceptRoomId) {
      const key = channelNameKey(name);
      for (const [roomId, r] of rooms) {
        if (roomId !== exceptRoomId && r.kind === 'channel' && r.name && channelNameKey(r.name) === key) return true;
      }
      return false;
    },
    // Комнаты, где пользователь участник (G1, этап 0.7.3): без чужих комнат.
    roomsOfUser(userId) {
      const out = [];
      for (const [roomId, r] of rooms.entries()) {
        if (![...r.members].includes(userId)) continue;
        out.push({ roomId, kind: r.kind, name: r.name ?? null, owner: r.owner, isAdmin: [...r.admins].includes(userId) });
      }
      return out.sort((a, b) => (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0));
    },
    roomKind(roomId) {
      return rooms.get(roomId)?.kind ?? null;
    },
    setRoomName(roomId, name) {
      const r = rooms.get(roomId);
      if (!r) return false;
      r.name = name;
      return true;
    },

    joinPublicRoomOpen({ roomId, userId, maxMembers }) {
      const r = rooms.get(roomId);
      if (!r) return { status: 'not_found' };
      if (r.visibility !== 'public') return { status: 'not_public' };
      if (r.joinPolicy !== 'open') return { status: 'not_open' };
      if (r.members.has(userId)) return { status: 'already_member' };
      const roomOrg = organizations.get(r.orgId);
      if (!roomOrg || roomOrg.status !== 'approved') return { status: 'org_not_approved' };

      let allowed = orgMembers.get(r.orgId)?.has(userId) ?? false;
      if (!allowed) {
        for (const [memberOrgId, members] of orgMembers) {
          if (!members.has(userId) || organizations.get(memberOrgId)?.status !== 'approved') continue;
          for (const link of orgLinks.values()) {
            if (link.status === 'active'
              && ((link.orgA === memberOrgId && link.orgB === r.orgId)
                || (link.orgB === memberOrgId && link.orgA === r.orgId))) {
              allowed = true;
              break;
            }
          }
          if (allowed) break;
        }
      }
      if (!allowed) return { status: 'org_not_member' };
      if (r.kind !== 'channel' && Number.isFinite(maxMembers) && r.members.size >= maxMembers) {
        return { status: 'full' };
      }
      r.members.add(userId);
      r.joinedSeq.set(userId, counters.eventSeq);
      r.capabilities.set(userId, [...DEFAULT_MEMBER_CAPABILITIES]);
      r.readUpTo.set(userId, 0);
      return { status: 'joined', members: [...r.members] };
    },
    addRoomMember(roomId, userId) {
      const r = rooms.get(roomId);
      if (!r || r.members.has(userId)) return false;
      r.members.add(userId);
      r.joinedSeq.set(userId, counters.eventSeq);
      r.capabilities.set(userId, [...DEFAULT_MEMBER_CAPABILITIES]);
      r.readUpTo.set(userId, 0);
      return true;
    },
    setRoomAdmin(roomId, userId, isAdmin) {
      const r = rooms.get(roomId);
      if (!r) return;
      if (isAdmin) {
        r.admins.add(userId);
        r.capabilities.set(userId, [...new Set([...(r.capabilities.get(userId) ?? []), ...DEFAULT_ADMIN_CAPABILITIES])]);
      } else {
        r.admins.delete(userId);
        r.capabilities.set(userId, [...DEFAULT_MEMBER_CAPABILITIES]);
      }
    },
    setRoomCapabilities(roomId, userId, list) {
      const r = rooms.get(roomId);
      if (!r) return;
      r.capabilities.set(userId, [...list]);
    },
    removeRoomMember(roomId, userId) {
      const r = rooms.get(roomId);
      if (!r) return;
      r.members.delete(userId);
      r.admins.delete(userId);
      r.joinedSeq.delete(userId); // при повторном добавлении история начинается заново
      r.capabilities.delete(userId);
      r.readUpTo.delete(userId);
    },
    setRoomAppearance(roomId, patch) {
      const r = rooms.get(roomId);
      if (!r) return;
      for (const key of ['description', 'backgroundColor', 'avatarAssetId', 'coverAssetId', 'backgroundAssetId']) {
        if (patch[key] !== undefined) r[key] = patch[key];
      }
    },
    addRoomAsset(roomId, asset) {
      const r = rooms.get(roomId);
      if (r) r.assets.set(asset.assetId, asset);
    },
    getRoomAsset(roomId, assetId) {
      return rooms.get(roomId)?.assets.get(assetId) ?? null;
    },
    deleteRoomAsset(roomId, assetId) {
      const r = rooms.get(roomId);
      if (!r || !r.assets.delete(assetId)) return false;
      for (const key of ['avatarAssetId', 'coverAssetId', 'backgroundAssetId']) {
        if (r[key] === assetId) r[key] = null;
      }
      return true;
    },
    listRoomStickers(roomId) {
      const r = rooms.get(roomId);
      if (!r) return [];
      return [...r.assets.values()].filter((a) => a.kind === 'sticker').map((a) => ({ assetId: a.assetId, shortcode: a.shortcode, encrypted: a.encrypted }));
    },
    listRoomAssets(roomId) {
      const r = rooms.get(roomId);
      if (!r) return [];
      return [...r.assets.values()].map(({ data, ...rest }) => rest);
    },
    replaceRoomAsset(roomId, assetId, patch) {
      const a = rooms.get(roomId)?.assets.get(assetId);
      if (!a) return false;
      Object.assign(a, { contentType: patch.contentType, encrypted: patch.encrypted, data: patch.data, size: patch.data.length });
      return true;
    },
    mlsAvailableCount(userId, deviceId, nowMs) {
      return mlsPackages.filter((p) => p.userId === userId && p.deviceId === deviceId && p.consumedAt === null && !p.lastResort && p.createdAt >= nowMs - MLS_REGULAR_MAX_AGE_MS).length;
    },
    mlsStoreLastResort(userId, deviceId, bytes, createdAt) {
      for (let i = mlsPackages.length - 1; i >= 0; i--) {
        const p = mlsPackages[i];
        if (p.userId === userId && p.deviceId === deviceId && p.lastResort) mlsPackages.splice(i, 1);
      }
      mlsPackages.push({ id: mlsPackages.length + 1, userId, deviceId, package: Buffer.from(bytes), createdAt, consumedAt: null, lastResort: true });
    },
    mlsStoreKeyPackages(userId, deviceId, packages, createdAt) {
      for (const bytes of packages) {
        mlsPackages.push({ id: mlsPackages.length + 1, userId, deviceId, package: Buffer.from(bytes), createdAt, consumedAt: null });
      }
    },
    mlsClaimKeyPackages(targetUserId, requesterUserId, requesterDeviceId, claimId, roomId, nowMs) {
      const claimKey = JSON.stringify([targetUserId, requesterUserId, requesterDeviceId, claimId]);
      const previous = mlsPackageClaims.get(claimKey);
      if (previous) {
        if (previous.state === 'released') return { ok: false, reason: 'claim_released' };
        if (previous.state === 'committed') return { ok: false, reason: 'claim_committed' };
        if (roomId && previous.roomId && previous.roomId !== roomId) return { ok: false, reason: 'claim_room_mismatch' };
        if (roomId && !previous.roomId) previous.roomId = roomId;
        return { ok: true, packages: previous.packages.map((item) => ({
          deviceId: item.deviceId, packageId: item.packageId, package: Buffer.from(item.package),
        })) };
      }
      const out = [];
      const devices = [...new Set(mlsPackages.filter((p) => p.userId === targetUserId && p.consumedAt === null).map((p) => p.deviceId))].sort();
      for (const deviceId of devices) {
        const next = mlsPackages.find((p) => p.userId === targetUserId && p.deviceId === deviceId && p.consumedAt === null && !p.lastResort && p.createdAt >= nowMs - MLS_REGULAR_MAX_AGE_MS);
        if (next) { next.consumedAt = nowMs; out.push({ deviceId, packageId: next.id, package: Buffer.from(next.package) }); continue; }
        const fallback = [...mlsPackages].reverse().find((p) => p.userId === targetUserId && p.deviceId === deviceId && p.lastResort && p.createdAt >= nowMs - MLS_LAST_RESORT_MAX_AGE_MS);
        if (fallback) out.push({ deviceId, packageId: fallback.id, package: Buffer.from(fallback.package) });
      }
      mlsPackageClaims.set(claimKey, { roomId: roomId ?? null, state: 'reserved', packages: out.map((item) => ({
        deviceId: item.deviceId, packageId: item.packageId, package: Buffer.from(item.package),
      })) });
      return { ok: true, packages: out };
    },
    mlsReleaseKeyPackageClaim(requesterUserId, requesterDeviceId, claimId) {
      const matches = [...mlsPackageClaims.entries()].filter(([key]) => {
        const [target, requester, device, id] = JSON.parse(key);
        return requester === requesterUserId && device === requesterDeviceId && id === claimId;
      });
      if (matches.length === 0) return { ok: true, released: false };
      if (matches.length > 1) return { ok: false, reason: 'claim_ambiguous' };
      const [key, claim] = matches[0];
      if (claim.state === 'committed') return { ok: false, reason: 'claim_committed' };
      if (claim.state === 'released') return { ok: true, released: true };
      for (const item of claim.packages) {
        const pack = mlsPackages.find((p) => p.id === item.packageId);
        if (pack && !pack.lastResort) pack.consumedAt = null;
      }
      claim.state = 'released';
      mlsPackageClaims.set(key, claim);
      return { ok: true, released: true };
    },

    ping() {
      return true;
    },
    createInvite(roomId, invite) {
      const r = rooms.get(roomId);
      if (r) r.invites.set(invite.inviteId, invite);
    },
    listInvites(roomId) {
      const r = rooms.get(roomId);
      if (!r) return [];
      return [...r.invites.values()].map(({ tokenHash, ...rest }) => rest);
    },
    revokeInvite(roomId, inviteId) {
      const inv = rooms.get(roomId)?.invites.get(inviteId);
      if (!inv) return false;
      inv.revoked = true;
      return true;
    },
    findInviteByTokenHash(tokenHash) {
      for (const [roomId, r] of rooms) {
        for (const inv of r.invites.values()) {
          if (inv.tokenHash === tokenHash) return { ...inv, roomId };
        }
      }
      return null;
    },
    useInvite(inviteId, nowMs) {
      for (const r of rooms.values()) {
        const inv = r.invites.get(inviteId);
        if (!inv) continue;
        if (inv.revoked || nowMs >= inv.expiresAt || (inv.maxUses !== null && inv.uses >= inv.maxUses)) return false;
        inv.uses += 1;
        return true;
      }
      return false;
    },
    hasJoinRequest(roomId, userId) {
      return !!rooms.get(roomId)?.joinRequests.has(userId);
    },
    createJoinRequest(roomId, userId, nowMs) {
      const r = rooms.get(roomId);
      if (!r || r.joinRequests.has(userId)) return false;
      r.joinRequests.set(userId, nowMs);
      return true;
    },
    listJoinRequests(roomId) {
      const r = rooms.get(roomId);
      return r ? [...r.joinRequests].map(([userId, created]) => ({ userId, created_at: created })) : [];
    },
    deleteJoinRequest(roomId, userId) {
      const r = rooms.get(roomId);
      return !!r && r.joinRequests.delete(userId);
    },
    clearJoinRequests(roomId) {
      const r = rooms.get(roomId);
      if (r) r.joinRequests.clear();
    },
    searchPublicRooms(query, limit) {
      const needle = query.toLowerCase();
      const found = [];
      for (const [roomId, r] of rooms) {
        if (r.visibility !== 'public' || !r.name || !r.name.toLowerCase().includes(needle)) continue;
        found.push({ roomId, name: r.name, join_policy: r.joinPolicy, members: r.members.size });
      }
      return found.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
    },
    setRoomSettings(roomId, settings) {
      const r = rooms.get(roomId);
      if (!r) return;
      if (settings.name !== undefined) r.name = settings.name;
      if (settings.visibility !== undefined) r.visibility = settings.visibility;
      if (settings.joinPolicy !== undefined) r.joinPolicy = settings.joinPolicy;
    },
    setReadUpTo(roomId, userId, seq) {
      const r = rooms.get(roomId);
      if (!r) return;
      r.readUpTo.set(userId, Math.max(r.readUpTo.get(userId) ?? 0, seq));
    },
    roomLastSeq(roomId) {
      const r = rooms.get(roomId);
      return r && r.events.length ? r.events[r.events.length - 1].seq : 0;
    },
    findRoomEvent(roomId, seq) {
      const r = rooms.get(roomId);
      const e = r?.events.find((x) => x.seq === seq);
      return e ? { seq: e.seq, sender: e.sender, type: e.type, content: structuredClone(e.content ?? null), origin_ts: e.origin_server_ts } : null;
    },
    redactRoomEvent(roomId, seq, actor, nowMs) {
      const r = rooms.get(roomId);
      if (!r) return false;
      const targetId = `$${seq}`;
      for (const e of r.events) {
        const isTarget = e.seq === seq;
        const isReplacement = e.type === 'm.room.encrypted.replace' && e.content?.replaces === targetId;
        if (isTarget || isReplacement) {
          e.type = 'm.room.redacted';
          e.content = { redacted_by: actor, redacted_at: nowMs };
        }
      }
      return true;
    },
    appendRoomEvent(roomId, sender, type, content, nowMs) {
      const r = rooms.get(roomId);
      const seq = ++counters.eventSeq;
      r.events.push({ event_id: `$${seq}`, seq, room_id: roomId, sender, origin_server_ts: nowMs, type, content: structuredClone(content ?? null) });
      return seq;
    },
    roomEventRows(roomId, sinceSeq) {
      const r = rooms.get(roomId);
      return (r ? r.events : []).filter((e) => e.seq > sinceSeq).map((e) => structuredClone(e));
    },

    /** Всё, что сервер хранит по беседам и очереди. Нужно тестам: проверить, что открытого текста нет. */
    snapshot() {
      return {
        rooms: Object.fromEntries([...rooms].map(([k, v]) => [k, structuredClone(v.events)])),
        inbox: Object.fromEntries([...inbox].map(([k, v]) => [k, structuredClone(v)])),
        deviceKeys: Object.fromEntries([...deviceKeys].map(([k, v]) => [k, structuredClone(v)])),
      };
    },

    // ---- телефон аккаунта (D5) ----
    phoneGet(userId) {
      const cur = phones.get(userId);
      return cur ? structuredClone(cur) : freshPhone();
    },
    phoneUpdate(userId, change) {
      if (!accounts.has(userId)) return change(freshPhone()).result;
      const cur = phones.get(userId);
      const { next, result } = change(cur ? structuredClone(cur) : freshPhone());
      phones.set(userId, structuredClone(next));
      return result;
    },
    mlsGroupEpoch(roomId) {
      return mlsGroups.get(roomId) ?? 0;
    },
    mlsCommitOperation(roomId, senderId, deviceId, clientOperationId, requestFingerprint) {
      const key = JSON.stringify([roomId, senderId, deviceId, clientOperationId]);
      const previous = mlsCommitOperations.get(key);
      if (!previous) return null;
      if (previous.requestFingerprint !== requestFingerprint) return { ok: false, reason: 'operation_id_reused' };
      return { ok: true, epoch: previous.epoch, replayed: true };
    },
    /** Применяет коммит и idempotency receipt одним синхронным шагом. */
    mlsApplyCommit(roomId, baseEpoch, { senderId, deviceId, clientOperationId, requestFingerprint, keyPackageClaimId, commit, welcomes, changes = { adds: [], removes: [] } }, nowMs) {
      const operationKey = clientOperationId ? JSON.stringify([roomId, senderId, deviceId, clientOperationId]) : null;
      if (operationKey) {
        const previous = mlsCommitOperations.get(operationKey);
        if (previous) {
          if (previous.requestFingerprint !== requestFingerprint) return { ok: false, reason: 'operation_id_reused', epoch: previous.epoch };
          return { ok: true, epoch: previous.epoch, replayed: true };
        }
      }
      const current = mlsGroups.get(roomId) ?? 0;
      if (current !== baseEpoch) return { ok: false, reason: 'epoch_outdated', epoch: current };
      let reservedClaim = null;
      if (keyPackageClaimId) {
        const targetUserId = changes.adds?.length === 1 ? changes.adds[0] : null;
        if (!targetUserId) return { ok: false, reason: 'claim_mismatch', epoch: current };
        const claimKey = JSON.stringify([targetUserId, senderId, deviceId, keyPackageClaimId]);
        reservedClaim = mlsPackageClaims.get(claimKey);
        if (!reservedClaim) return { ok: false, reason: 'claim_missing', epoch: current };
        if (reservedClaim.roomId !== roomId) return { ok: false, reason: 'claim_room_mismatch', epoch: current };
        if (reservedClaim.state === 'released') return { ok: false, reason: 'claim_released', epoch: current };
        if (reservedClaim.state === 'committed') return { ok: false, reason: 'claim_committed', epoch: current };
        const claimedDevices = reservedClaim.packages.map((item) => item.deviceId).sort();
        const welcomeDevices = welcomes.filter((item) => item.userId === targetUserId).map((item) => item.deviceId).sort();
        if (JSON.stringify(claimedDevices) !== JSON.stringify(welcomeDevices)) return { ok: false, reason: 'claim_mismatch', epoch: current };
      }
      const room = rooms.get(roomId);
      for (const deviceId of changes.removeDevices ?? []) {
        for (const r of deviceRemovals) if (r.roomId === roomId && r.deviceId === deviceId && r.doneAt === null) r.doneAt = nowMs;
      }
      for (const userId of changes.removes) {
        if (room) { room.members.delete(userId); room.admins.delete(userId); room.joinedSeq.delete(userId); room.capabilities.delete(userId); room.readUpTo.delete(userId); }
      }
      for (const userId of changes.adds) {
        if (room && !room.members.has(userId)) { room.members.add(userId); room.joinedSeq.set(userId, counters.eventSeq); room.capabilities.set(userId, [...DEFAULT_MEMBER_CAPABILITIES]); room.readUpTo.set(userId, 0); }
      }
      const next = current + 1;
      mlsGroups.set(roomId, next);
      mlsCommits.push({ roomId, epoch: next, senderId, commit: Buffer.from(commit), changes: structuredClone({ adds: changes.adds ?? [], removes: changes.removes ?? [], removeDevices: changes.removeDevices ?? [] }), welcomeRecipients: welcomes.map((w) => ({ userId: w.userId, deviceId: w.deviceId })), createdAt: nowMs });
      for (const w of welcomes) {
        mlsWelcomes.push({ id: mlsWelcomes.length + 1, roomId, epoch: next, userId: w.userId, deviceId: w.deviceId, welcome: Buffer.from(w.welcome), createdAt: nowMs, ackedAt: null });
      }
      if (operationKey) mlsCommitOperations.set(operationKey, { requestFingerprint, epoch: next });
      if (reservedClaim) reservedClaim.state = 'committed';
      return { ok: true, epoch: next, replayed: false };
    },
    mlsCommitsSince(roomId, since, limit) {
      return mlsCommits.filter((c) => c.roomId === roomId && c.epoch > since).sort((a, b) => a.epoch - b.epoch).slice(0, limit)
        .map((c) => ({ epoch: c.epoch, senderId: c.senderId, commit: Buffer.from(c.commit), changes: c.changes ? structuredClone(c.changes) : null, welcomeRecipients: c.welcomeRecipients ? structuredClone(c.welcomeRecipients) : null }));
    },
    mlsPendingWelcomes(userId, deviceId) {
      return mlsWelcomes.filter((w) => w.userId === userId && w.deviceId === deviceId && w.ackedAt === null)
        .map((w) => ({ id: w.id, roomId: w.roomId, epoch: w.epoch, welcome: Buffer.from(w.welcome) }));
    },
    mlsDropDevicePackages(userId, deviceId) {
      for (let i = mlsPackages.length - 1; i >= 0; i--) {
        const p = mlsPackages[i];
        if (p.userId === userId && p.deviceId === deviceId && p.consumedAt === null) mlsPackages.splice(i, 1);
      }
      for (let i = mlsWelcomes.length - 1; i >= 0; i--) {
        const w = mlsWelcomes[i];
        if (w.userId === userId && w.deviceId === deviceId && w.ackedAt === null) mlsWelcomes.splice(i, 1);
      }
    },
    mlsRecordDeviceRemovals(userId, deviceId, nowMs) {
      for (const [roomId, group] of mlsGroups) {
        const room = rooms.get(roomId);
        if (group > 0 && room && room.members.has(userId) && !deviceRemovals.some((r) => r.roomId === roomId && r.userId === userId && r.deviceId === deviceId)) {
          deviceRemovals.push({ roomId, userId, deviceId, createdAt: nowMs, doneAt: null });
        }
      }
    },
    findClientMessage(roomId, userId, clientId) {
  const hit = clientMessages.find((m) => m.roomId === roomId && m.userId === userId && m.clientId === clientId && m.seq !== null);
  return hit ? hit.seq : null;
},
reserveClientMessage(roomId, userId, clientId) {
  const hit = clientMessages.find((m) => m.roomId === roomId && m.userId === userId && m.clientId === clientId);
  if (!hit) {
    clientMessages.push({ roomId, userId, clientId, seq: null });
    return { state: 'new' };
  }
  if (hit.seq === null) return { state: 'pending' };
  return { state: 'done', seq: hit.seq };
},
completeClientMessage(roomId, userId, clientId, seq) {
  const hit = clientMessages.find((m) => m.roomId === roomId && m.userId === userId && m.clientId === clientId);
  if (hit) hit.seq = seq;
},
releaseClientMessage(roomId, userId, clientId) {
  const i = clientMessages.findIndex((m) => m.roomId === roomId && m.userId === userId && m.clientId === clientId && m.seq === null);
  if (i >= 0) clientMessages.splice(i, 1);
},
mlsPendingRemovalsFor(userId) {
      return deviceRemovals.filter((r) => r.userId === userId && r.doneAt === null).map((r) => ({ roomId: r.roomId, deviceId: r.deviceId }));
    },
    mlsPendingRemovalDevices(roomId) {
      return deviceRemovals.filter((r) => r.roomId === roomId && r.doneAt === null).map((r) => r.deviceId);
    },
    mlsAckWelcome(id, userId, deviceId, nowMs) {
      const w = mlsWelcomes.find((x) => x.id === id && x.userId === userId && x.deviceId === deviceId && x.ackedAt === null);
      if (!w) return false;
      w.ackedAt = nowMs;
      return true;
    },
    phoneOwner(phone) {
      for (const [userId, p] of phones) if (p.phone === phone) return userId;
      return null;
    },
    verifiedPhoneOwner(phone) {
      for (const [userId, p] of phones) if (p.verified && p.phone === phone) return userId;
      return null;
    },

    // ---- лимиты запросов (окна времени) ----
    rateHit(key, nowMs, windowMs, limit) {
      const { next, allowed, retryAt } = applyHit(rates.get(key) ?? null, { nowMs, windowMs, limit });
      rates.set(key, next);
      return { allowed, retryAt };
    },

    // ---- профиль аккаунта: почта и никнейм ----
    profileGet(userId) {
      const p = profiles.get(userId);
      return p ? structuredClone(p) : null;
    },
    userIdByEmail(email) {
      for (const [userId, p] of profiles) if (p.emailVerified && p.email === email) return userId;
      return null;
    },
    searchNickname(nickname) {
      const wanted = nickname.toLowerCase();
      for (const [userId, p] of profiles) {
        if (p.nickname.toLowerCase() === wanted) return { userId, nickname: p.nickname };
      }
      return null;
    },
    createVerifiedAccount({ userId, passwordHash, email, nickname, nowMs, provider = null, joinDefaultOrg = false }) {
      if (accounts.has(userId)) return 'account';
      for (const p of profiles.values()) {
        if (p.emailVerified && p.email === email) return 'email';
        if (p.nickname.toLowerCase() === nickname.toLowerCase()) return 'nickname';
      }
      const key = provider ? `${provider.provider}|${provider.sub}` : null;
      if (key && providerLinks.has(key)) return 'link';
      accounts.set(userId, passwordHash);
      if (joinDefaultOrg) addOrgMembership(DEFAULT_ORG_ID, userId, 'member', nowMs);
      profiles.set(userId, { email, emailVerified: true, nickname, createdAt: nowMs });
      if (key) providerLinks.set(key, { userId, email, linkedAt: nowMs });
      return 'ok';
    },

    // ---- код подтверждения почты при регистрации ----
    emailCodeUpdate(email, change) {
      const cur = emailCodes.get(email);
      const { next, result } = change(cur ? structuredClone(cur) : freshEmailCode());
      emailCodes.set(email, structuredClone(next));
      return result;
    },

    // ---- открытый ключ устройства для биометрического подтверждения (этап 2б) ----
    signingKeyGet(deviceKey) {
      const k = signingKeys.get(deviceKey);
      return k ? structuredClone(k) : null;
    },
    signingKeySet(deviceKey, jwk, createdAt) {
      signingKeys.set(deviceKey, structuredClone({ ...jwk, createdAt }));
    },
    signingKeyDelete(deviceKey) {
      return signingKeys.delete(deviceKey);
    },

    // ---- код отмены восстановления ----
    recoveryCancelSet(userId, codeHash, expiresAt) {
      recoveryCancels.set(userId, { codeHash, expiresAt });
    },
    recoveryCancelGet(userId) {
      const c = recoveryCancels.get(userId);
      return c ? { codeHash: c.codeHash, expiresAt: c.expiresAt } : null;
    },
    recoveryCancelClear(userId) {
      recoveryCancels.delete(userId);
    },

    // ---- отложенный вход с нового устройства ----
    deviceWaitGet(userId, deviceId) {
      const w = deviceWaits.get(`${userId}|${deviceId}`);
      return w ? { activateAt: w.activateAt } : null;
    },
    deviceWaitsOf(userId) {
      return [...deviceWaits.entries()]
        .filter(([k]) => k.startsWith(`${userId}|`))
        .map(([k, w]) => ({ deviceId: k.slice(userId.length + 1), activateAt: w.activateAt, cancelHash: w.cancelHash }));
    },
    deviceWaitCreate({ userId, deviceId, label, platform, activateAt, cancelHash, createdAt }) {
      const key = `${userId}|${deviceId}`;
      if (deviceWaits.has(key)) return 'exists';
      deviceWaits.set(key, { label, platform, activateAt, cancelHash, createdAt });
      return 'ok';
    },
    deviceWaitDelete(userId, deviceId) {
      return deviceWaits.delete(`${userId}|${deviceId}`);
    },

    // ---- запасная почта ----
    backupEmailGet(userId) {
      const b = backupEmails.get(userId);
      return b ? { email: b.email, verified: true } : null;
    },
    backupEmailSave(userId, email, nowMs) {
      for (const [uid, b] of backupEmails) if (uid !== userId && b.email === email) return 'taken';
      backupEmails.set(userId, { email, createdAt: nowMs });
      return 'ok';
    },
    backupEmailRemove(userId) {
      return backupEmails.delete(userId);
    },

    // ---- одноразовые токены этапа 2 ----
    issueAuthToken({ kind, tokenHash, userId, payload, expiresAt }) {
      authTokens.set(`${kind}|${tokenHash}`, { userId, payload, expiresAt });
    },
    consumeAuthToken(kind, tokenHash, nowMs) {
      const key = `${kind}|${tokenHash}`;
      const t = authTokens.get(key);
      if (!t || t.expiresAt < nowMs) {
        authTokens.delete(key);
        return null;
      }
      authTokens.delete(key);
      return { userId: t.userId, payload: t.payload };
    },

    // ---- связи с внешними аккаунтами ----
    providerLinkFind(provider, sub) {
      const l = providerLinks.get(`${provider}|${sub}`);
      return l ? { userId: l.userId } : null;
    },
    providerLinksOf(userId) {
      return [...providerLinks.entries()]
        .filter(([, l]) => l.userId === userId)
        .map(([k]) => ({ provider: k.split('|')[0] }))
        .sort((x, y) => x.provider.localeCompare(y.provider));
    },
    linkProvider({ userId, provider, sub, email, nowMs }) {
      const key = `${provider}|${sub}`;
      const owner = providerLinks.get(key);
      if (owner) return owner.userId === userId ? 'provider-set' : 'taken';
      for (const [k, l] of providerLinks) {
        if (l.userId === userId && k.startsWith(`${provider}|`)) return 'provider-set';
      }
      providerLinks.set(key, { userId, email, linkedAt: nowMs });
      return 'ok';
    },
    unlinkProvider(userId, provider) {
      for (const [k, l] of providerLinks) {
        if (l.userId === userId && k.startsWith(`${provider}|`)) {
          providerLinks.delete(k);
          return true;
        }
      }
      return false;
    },

  };
}
