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
  }
  function isOrgMemberRoom(orgId, roomOrgId, userId) {
    if (roomOrgId === orgId) return true;
    if (!roomOrgId || (orgMembers.get(roomOrgId)?.has(userId) ?? false)) return false;
    return [...orgLinks.values()].some((link) => {
      if (link.status !== 'active') return false;
      const linkedOrg = link.orgA === orgId ? link.orgB : link.orgB === orgId ? link.orgA : null;
      return linkedOrg === roomOrgId && organizations.get(linkedOrg)?.status === 'approved';
    });
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
  const directConversations = new Map(); // unordered pair key -> direct conversation
  const directConversationsByRoom = new Map();
  const contacts = new Map(); // owner user -> Set(contact user)
  const contactRequests = new Map(); // requester|recipient -> request state
  const userBlocks = new Set(); // canonical unordered pair key
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
  const pairKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
  const requestKey = (requester, recipient) => JSON.stringify([requester, recipient]);
  const isBlockedPair = (a, b) => userBlocks.has(pairKey(a, b));
  function addContact(ownerId, contactUserId) {
    let set = contacts.get(ownerId);
    if (!set) { set = new Set(); contacts.set(ownerId, set); }
    set.add(contactUserId);
  }
  function recordIncomingContactRequest(roomId, senderId, createdAt) {
    const conversation = directConversationsByRoom.get(roomId);
    if (!conversation) return;
    const recipientId = conversation.userA === senderId
      ? conversation.userB
      : conversation.userB === senderId ? conversation.userA : null;
    if (!recipientId || isBlockedPair(senderId, recipientId) || contacts.get(recipientId)?.has(senderId)) return;
    const key = requestKey(senderId, recipientId);
    if (!contactRequests.has(key)) {
      contactRequests.set(key, { requesterId: senderId, recipientId, roomId, status: 'pending', createdAt, decidedAt: null });
    }
  }

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
    reserveFile({ fileId, ownerId, ownerDeviceId = '', roomId, orgId = null, kind, size, sha256, createdAt, ownerQuotaBytes = null, orgQuotaBytes = null, pendingLimit }) {
      const owned = [...files.values()].filter((f) => f.ownerId === ownerId);
      if (owned.filter((f) => f.status === 'pending' || f.status === 'uploading' || f.status === 'uploaded').length >= pendingLimit) {
        return { ok: false, reason: 'pending_limit' };
      }
      if (ownerQuotaBytes !== null && owned
        .filter((f) => ['pending', 'uploading', 'uploaded', 'ready', 'deleting'].includes(f.status))
        .reduce((sum, f) => sum + f.size, 0) + size > ownerQuotaBytes) {
        return { ok: false, reason: 'owner_quota' };
      }
      if (orgId && orgQuotaBytes !== null) {
        const used = [...files.values()]
          .filter((f) => rooms.get(f.roomId)?.orgId === orgId && ['pending', 'uploading', 'uploaded', 'ready', 'deleting'].includes(f.status))
          .reduce((sum, f) => sum + f.size, 0);
        if (used + size > orgQuotaBytes) return { ok: false, reason: 'org_quota' };
      }
      files.set(fileId, { fileId, ownerId, ownerDeviceId, roomId, kind, size, sha256, status: 'pending', createdAt, completedAt: null });
      return { ok: true };
    },
    createFile({ fileId, ownerId, ownerDeviceId = '', roomId, kind, size, sha256, createdAt }) {
      files.set(fileId, { fileId, ownerId, ownerDeviceId, roomId, kind, size, sha256, status: 'pending', createdAt, completedAt: null });
    },
    getFile(fileId) {
      const f = files.get(fileId);
      return f ? { ...f } : null;
    },
    claimFileUpload(fileId, ownerId, ownerDeviceId) {
      const f = files.get(fileId);
      if (!f || f.ownerId !== ownerId || f.ownerDeviceId !== ownerDeviceId || f.status !== 'pending') return false;
      f.status = 'uploading';
      return true;
    },
    markFileUploaded(fileId) {
      const f = files.get(fileId);
      if (!f || f.status !== 'uploading') return false;
      f.status = 'uploaded';
      return true;
    },
    markFileReady(fileId, nowMs, ownerId, ownerDeviceId) {
      const f = files.get(fileId);
      if (!f || f.status !== 'uploaded' || f.ownerId !== ownerId || f.ownerDeviceId !== ownerDeviceId) return false;
      const device = devices.get(`${ownerId}|${ownerDeviceId}`);
      if (!device || device.revoked) return false;
      if (f.roomId) {
        const room = rooms.get(f.roomId);
        if (!room || !room.members.has(ownerId)) return false;
        const org = organizations.get(room.orgId);
        if (!org || org.status !== 'approved') return false;
        let eligible = orgMembers.get(room.orgId)?.has(ownerId) ?? false;
        if (!eligible) {
          for (const [memberOrgId, members] of orgMembers) {
            if (!members.has(ownerId)) continue;
            const memberOrg = organizations.get(memberOrgId);
            if (!memberOrg || memberOrg.status !== 'approved') continue;
            if ([...orgLinks.values()].some((link) => link.status === 'active'
              && ((link.orgA === memberOrgId && link.orgB === room.orgId)
                || (link.orgB === memberOrgId && link.orgA === room.orgId)))) {
              eligible = true;
              break;
            }
          }
        }
        if (!eligible) return false;
        if (room.owner !== ownerId && !(room.capabilities.get(ownerId) ?? []).includes('send_messages')) return false;
      }
      f.status = 'ready';
      f.completedAt = nowMs;
      return true;
    },
    countPendingFiles(ownerId) {
      return [...files.values()].filter((f) => f.ownerId === ownerId && (f.status === 'pending' || f.status === 'uploading' || f.status === 'uploaded')).length;
    },
    bytesForOwner(ownerId) {
      return [...files.values()].filter((f) => f.ownerId === ownerId && ['pending', 'uploading', 'uploaded', 'ready', 'deleting'].includes(f.status)).reduce((sum, f) => sum + f.size, 0);
    },
    purgeStaleFiles(cutoffMs) {
      const pending = [];
      for (const [id, f] of files) {
        if ((f.status === 'pending' || f.status === 'uploading' || f.status === 'uploaded') && f.createdAt < cutoffMs) f.status = 'deleting';
        if (f.status === 'deleting') pending.push(id);
      }
      return pending.slice(0, 100);
    },
    markFileDeleting(fileId) {
      const f = files.get(fileId);
      if (!f || !['pending', 'uploading', 'uploaded'].includes(f.status)) return false;
      f.status = 'deleting';
      return true;
    },
    finalizeFileDeletion(fileId) {
      const f = files.get(fileId);
      if (!f || f.status !== 'deleting') return false;
      files.delete(fileId);
      return true;
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
      let rateLimitsRemoved = 0;
      for (const [key, value] of rates) {
        if (value.windowStart <= nowMs - 24 * 60 * 60_000) {
          rates.delete(key);
          rateLimitsRemoved += 1;
        }
      }
      let loginThrottleRemoved = 0;
      for (const [key, value] of throttle) {
        if (value.windowStart <= nowMs - 15 * 60_000 && value.blockedUntil <= nowMs) {
          throttle.delete(key);
          loginThrottleRemoved += 1;
        }
      }
      return {
        inbox: inboxRemoved, tokens: tokensRemoved, refreshTokens: refreshRemoved,
        authTokens: authRemoved, recoveryCancelCodes: cancelRemoved,
        rateLimits: rateLimitsRemoved, loginThrottle: loginThrottleRemoved,
      };
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
    addOrgRequestDocument({ docId, requestId, kind, size, sha256, filename, mimeType, objectKey, uploadedBy, createdAt }) {
      const request = orgRequests.get(requestId);
      if (!request || request.status !== 'pending') return false;
      orgRequestDocs.set(docId, { docId, requestId, kind, size, sha256, filename, mimeType, objectKey, uploadedBy, createdAt });
      orgRequestLog.push({ requestId, actor: uploadedBy, action: 'document', at: createdAt });
      return true;
    },
    listOrgRequestDocuments(requestId) {
      return [...orgRequestDocs.values()].filter((x) => x.requestId === requestId).map((x) => ({
        docId: x.docId, kind: x.kind, size: x.size, sha256: x.sha256,
        filename: x.filename ?? 'document.bin',
        mimeType: x.mimeType ?? 'application/octet-stream',
        createdAt: x.createdAt,
      })).sort((a, b) => a.createdAt - b.createdAt);
    },
    getOrgRequestDocument(docId) { const x = orgRequestDocs.get(docId); return x ? { ...x } : null; },
    decideOrgRequest({ requestId, decision, decidedBy, decidedAt }) {
      const request = orgRequests.get(requestId);
      if (!request) return null;
      if (request.status !== 'pending') {
        return { conflict: true, status: request.status, orgId: request.orgId };
      }
      const status = decision === 'approve' ? 'approved' : 'rejected';
      const orgId = decision === 'approve' ? `org-${requestId}` : null;
      if (orgId) {
        if (organizations.has(orgId)) throw new Error('organization already exists for pending request');
        organizations.set(orgId, {
          orgId,
          name: request.name,
          status: 'approved',
          createdBy: request.applicantId,
          createdAt: decidedAt,
        });
        addOrgMembership(orgId, request.applicantId, 'owner', decidedAt);
      }
      request.status = status;
      request.decidedBy = decidedBy;
      request.decidedAt = decidedAt;
      request.orgId = orgId;
      orgRequestLog.push({ requestId, actor: decidedBy, action: decision, at: decidedAt });
      return { status, orgId };
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
    addOrgMemberAtomic({ orgId, actor, target, role, at }) {
      const org = organizations.get(orgId);
      if (!org) return { ok: false, reason: 'not_found' };
      if (org.status !== 'approved') return { ok: false, reason: 'org_not_approved' };
      const actorRole = orgMembers.get(orgId)?.get(actor)?.role;
      if (actorRole !== 'owner' && actorRole !== 'admin') return { ok: false, reason: 'forbidden' };
      if (actorRole === 'admin' && role !== 'member') return { ok: false, reason: 'forbidden' };
      if (!accounts.has(target)) return { ok: false, reason: 'unknown_user' };
      if (!addOrgMembership(orgId, target, role, at)) return { ok: false, reason: 'already_member' };
      adminActions.push({ orgId, actor, action: 'member_add', target, detail: role, at });
      return { ok: true };
    },
    changeOrgMemberRoleAtomic({ orgId, actor, target, role, at }) {
      const members = orgMembers.get(orgId);
      if (!organizations.has(orgId)) return { ok: false, reason: 'not_found' };
      const actorRole = members?.get(actor)?.role;
      const current = members?.get(target)?.role;
      if (actorRole !== 'owner') return { ok: false, reason: 'forbidden' };
      if (!current) return { ok: false, reason: 'not_found' };
      if (current === 'owner' && role !== 'owner' && [...members.values()].filter((m) => m.role === 'owner').length <= 1) {
        return { ok: false, reason: 'last_owner' };
      }
      members.get(target).role = role;
      adminActions.push({ orgId, actor, action: 'role_change', target, detail: current + '->' + role, at });
      return { ok: true, current };
    },
    removeOrgMemberAtomic({ orgId, actor, target, action, at }) {
      const members = orgMembers.get(orgId);
      if (!organizations.has(orgId)) return { ok: false, reason: 'not_found' };
      const actorRole = members?.get(actor)?.role;
      const targetRole = members?.get(target)?.role;
      if (!targetRole) return { ok: false, reason: 'not_found' };
      if (action === 'member_leave') {
        if (actor !== target || !actorRole) return { ok: false, reason: 'not_found' };
      } else if (actorRole !== 'owner' && !(actorRole === 'admin' && targetRole === 'member')) {
        return { ok: false, reason: 'forbidden' };
      }
      if (targetRole === 'owner' && [...members.values()].filter((m) => m.role === 'owner').length <= 1) {
        return { ok: false, reason: 'last_owner' };
      }
      if ([...rooms.values()].some((room) => room.owner === target && isOrgMemberRoom(orgId, room.orgId, target))) {
        return { ok: false, reason: 'owns_rooms' };
      }
      const roomIds = [...rooms.entries()].filter(([, room]) => room.members.has(target) && isOrgMemberRoom(orgId, room.orgId, target)).map(([roomId]) => roomId).sort();
      if (roomIds.length) return { ok: false, reason: 'mls_removal_required', roomIds };
      for (const room of rooms.values()) if (isOrgMemberRoom(orgId, room.orgId, target)) room.joinRequests.delete(target);
      members.delete(target);
      adminActions.push({ orgId, actor, action, target, detail: targetRole, at });
      return { ok: true, role: targetRole };
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
      if ([...rooms.values()].some((room) => room.owner === userId && isOrgMemberRoom(orgId, room.orgId, userId))) return { ok: false, reason: 'owns_rooms' };
      const roomIds = [...rooms.entries()].filter(([, room]) => room.members.has(userId) && isOrgMemberRoom(orgId, room.orgId, userId)).map(([roomId]) => roomId).sort();
      if (roomIds.length) return { ok: false, reason: 'mls_removal_required', roomIds };
      for (const room of rooms.values()) if (isOrgMemberRoom(orgId, room.orgId, userId)) room.joinRequests.delete(userId);
      orgMembers.get(orgId)?.delete(userId);
      return { ok: true };
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
    setOrgSettingAtomic({ orgId, field, value, actor, at }) {
      const org = organizations.get(orgId);
      if (!org) return { ok: false, reason: 'not_found' };
      if (org.status !== 'approved') return { ok: false, reason: 'org_not_approved' };
      const role = orgMembers.get(orgId)?.get(actor)?.role;
      if (role !== 'owner' && role !== 'admin') return { ok: false, reason: 'forbidden' };
      const cur = { maxGroupMembers: null, channelsEnabled: true, fileQuotaBytes: null, ...(orgSettingsMap.get(orgId) ?? {}) };
      const old = cur[field];
      cur[field] = value;
      orgSettingsMap.set(orgId, cur);
      orgSettingsLog.push({ orgId, actor, field, old, new: value, at });
      adminActions.push({ orgId, actor, action: 'setting_change', target: field, detail: JSON.stringify(value), at });
      return { ok: true };
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
      const inOrg = (org, userId) => orgMembers.get(org)?.has(userId) ?? false;
      const memberships = [];
      for (const [roomId, room] of rooms) {
        if (room.orgId !== orgX && room.orgId !== orgY) continue;
        const other = room.orgId === orgX ? orgY : orgX;
        for (const userId of room.members) {
          if (inOrg(other, userId) && !inOrg(room.orgId, userId)) memberships.push({ roomId, userId, owner: room.owner === userId });
        }
      }
      return memberships.length
        ? { ok: false, reason: 'mls_removal_required', memberships }
        : { ok: true };
    },
    revokeOrgLink({ linkId, fromStatus, actor, at }) {
      const link = orgLinks.get(linkId);
      if (!link || link.status !== fromStatus) return { ok: false, reason: 'state_changed' };
      const orgA = link.orgA;
      const orgB = link.orgB;
      const inOrg = (org, userId) => orgMembers.get(org)?.has(userId) ?? false;
      const memberships = [];
      for (const [roomId, room] of rooms) {
        if (room.orgId !== orgA && room.orgId !== orgB) continue;
        const other = room.orgId === orgA ? orgB : orgA;
        for (const userId of room.members) {
          if (inOrg(other, userId) && !inOrg(room.orgId, userId)) memberships.push({ roomId, userId, owner: room.owner === userId });
        }
      }
      if (memberships.length) return { ok: false, reason: 'mls_removal_required', memberships };
      link.status = 'revoked';
      link.decidedBy = actor;
      link.decidedAt = at;
      for (const room of rooms.values()) {
        if (room.orgId !== orgA && room.orgId !== orgB) continue;
        const other = room.orgId === orgA ? orgB : orgA;
        for (const userId of [...room.joinRequests.keys()]) {
          if (inOrg(other, userId) && !inOrg(room.orgId, userId)) room.joinRequests.delete(userId);
        }
      }
      adminActions.push(
        { orgId: orgA, actor, action: 'link_revoke', target: orgB, detail: linkId, at },
        { orgId: orgB, actor, action: 'link_revoke', target: orgA, detail: linkId, at },
      );
      return { ok: true };
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
      if (d) {
        d.revoked = true;
        for (let i = mlsPackages.length - 1; i >= 0; i--) {
          if (mlsPackages[i].userId === d.userId && mlsPackages[i].deviceId === d.deviceId) mlsPackages.splice(i, 1);
        }
        for (const [claimKey, claim] of mlsPackageClaims) {
          const [targetUserId] = JSON.parse(claimKey);
          if (targetUserId === d.userId) claim.packages = claim.packages.filter((item) => item.deviceId !== d.deviceId);
        }
      }
      if (d) {
        for (let i = mlsWelcomes.length - 1; i >= 0; i--) {
          if (mlsWelcomes[i].userId === d.userId && mlsWelcomes[i].deviceId === d.deviceId && mlsWelcomes[i].ackedAt === null) {
            mlsWelcomes.splice(i, 1);
          }
        }
      }
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

    async recoveryUpdateWithOutbox(userId, change, enqueue) {
      if (!accounts.has(userId)) return change(freshRecovery()).result;
      const cur = recovery.get(userId);
      const { next, result } = change(cur ? structuredClone(cur) : freshRecovery());
      recovery.set(userId, structuredClone(next));
      try {
        if (enqueue) await enqueue(null, result);
      } catch (error) {
        if (cur) recovery.set(userId, cur); else recovery.delete(userId);
        throw error;
      }
      return result;
    },
    async recoveryCancelWithOutbox(userId, passwordHash, change, enqueue) {
      if (!accounts.has(userId)) return change(freshRecovery()).result;
      const oldPassword = accounts.get(userId);
      const oldRecovery = recovery.get(userId);
      const oldCancel = recoveryCancels.get(userId);
      const { next, result } = change(oldRecovery ? structuredClone(oldRecovery) : freshRecovery());
      if (passwordHash) accounts.set(userId, passwordHash);
      recovery.set(userId, structuredClone(next));
      recoveryCancels.delete(userId);
      try {
        if (enqueue) await enqueue(null, result);
      } catch (error) {
        accounts.set(userId, oldPassword);
        if (oldRecovery) recovery.set(userId, oldRecovery); else recovery.delete(userId);
        if (oldCancel) recoveryCancels.set(userId, oldCancel);
        throw error;
      }
      return result;
    },
    async recoveryCompleteWithOutbox(userId, passwordHash, change, cancelCodeHash, enqueue) {
      if (!accounts.has(userId)) throw new Error('recovery account not found');
      const oldPassword = accounts.get(userId);
      const oldRecovery = recovery.get(userId);
      const oldCancel = recoveryCancels.get(userId);
      const { next, result } = change(oldRecovery ? structuredClone(oldRecovery) : freshRecovery());
      accounts.set(userId, passwordHash);
      recovery.set(userId, structuredClone(next));
      recoveryCancels.set(userId, { codeHash: cancelCodeHash, expiresAt: result });
      try {
        if (enqueue) await enqueue(null, result);
      } catch (error) {
        accounts.set(userId, oldPassword);
        if (oldRecovery) recovery.set(userId, oldRecovery); else recovery.delete(userId);
        if (oldCancel) recoveryCancels.set(userId, oldCancel); else recoveryCancels.delete(userId);
        throw error;
      }
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
    queryDeviceKeysForUser(requesterId, targetUserId) {
      if (requesterId !== targetUserId) {
        const senderOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(requesterId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const recipientOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(targetUserId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const allowed = senderOrgs.some((senderOrg) => recipientOrgs.some((recipientOrg) =>
          senderOrg === recipientOrg || [...orgLinks.values()].some((link) =>
            link.status === 'active' && (
              (link.orgA === senderOrg && link.orgB === recipientOrg)
              || (link.orgB === senderOrg && link.orgA === recipientOrg)
            ))));
        if (!allowed) return null;
      }
      const out = {};
      for (const [dk, keys] of deviceKeys) {
        const d = devices.get(dk);
        if (d && !d.revoked && d.userId === targetUserId) out[d.deviceId] = structuredClone(keys);
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
    claimOneTimeKey(deviceKey, requesterId, targetUserId) {
      const device = devices.get(deviceKey);
      if (!device || device.revoked || device.userId !== targetUserId) return null;
      if (requesterId !== targetUserId) {
        const senderOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(requesterId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const recipientOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(targetUserId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const allowed = senderOrgs.some((senderOrg) => recipientOrgs.some((recipientOrg) =>
          senderOrg === recipientOrg || [...orgLinks.values()].some((link) =>
            link.status === 'active' && (
              (link.orgA === senderOrg && link.orgB === recipientOrg)
              || (link.orgB === senderOrg && link.orgA === recipientOrg)
            ))));
        if (!allowed) return null;
      }
      const pool = oneTimeKeys.get(deviceKey);
      if (!pool || pool.size === 0) return null;
      const [name, value] = pool.entries().next().value;
      pool.delete(name);
      return { [name]: value };
    },

    // ---- очередь доставки: события с номером и сроком хранения ----
    enqueue(deviceKey, stream, body, dedupeKey, expiresAt) {
      const q = inbox.get(deviceKey) ?? [];
      const kept = dedupeKey == null ? q : q.filter((e) => !(e.stream === stream && e.dedupeKey === dedupeKey));
      kept.push({ id: ++counters.inboxSeq, expiresAt, stream, dedupeKey: dedupeKey ?? null, body: structuredClone(body) });
      inbox.set(deviceKey, kept);
    },
    enqueueToDevice(deviceKey, body, dedupeKey, expiresAt, nowMs, maxPending, senderUserId, recipientUserId) {
      if (!accounts.has(recipientUserId)) return { ok: false, reason: 'recipient_not_found' };
      const device = devices.get(deviceKey);
      if (!device || device.revoked) return { ok: false, reason: 'device_revoked' };
      if (device.userId !== recipientUserId) return { ok: false, reason: 'device_mismatch' };
      if (senderUserId !== recipientUserId) {
        const senderOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(senderUserId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const recipientOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(recipientUserId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const allowed = senderOrgs.some((senderOrg) => recipientOrgs.some((recipientOrg) =>
          senderOrg === recipientOrg || [...orgLinks.values()].some((link) =>
            link.status === 'active' && (
              (link.orgA === senderOrg && link.orgB === recipientOrg)
              || (link.orgB === senderOrg && link.orgA === recipientOrg)
            ))));
        if (!allowed) return { ok: false, reason: 'not_authorized' };
      }
      const userDeviceKeys = [...devices.entries()]
        .filter(([, entry]) => entry.userId === recipientUserId && !entry.revoked)
        .map(([key]) => key);
      let userQueueCount = 0;
      for (const key of userDeviceKeys) {
        const alive = (inbox.get(key) ?? []).filter((entry) => entry.expiresAt > nowMs);
        inbox.set(key, alive);
        userQueueCount += alive.filter((entry) => entry.stream === 'to_device').length;
      }
      const kept = inbox.get(deviceKey) ?? [];
      const existing = kept.find((e) => e.stream === 'to_device' && e.dedupeKey === dedupeKey);
      if (!existing && userQueueCount >= maxPending) {
        inbox.set(deviceKey, kept);
        return { ok: false, reason: 'queue_full' };
      }
      const entry = {
        id: ++counters.inboxSeq,
        expiresAt,
        stream: 'to_device',
        dedupeKey,
        body: structuredClone(body),
      };
      if (existing) Object.assign(existing, entry);
      else kept.push(entry);
      inbox.set(deviceKey, kept);
      return { ok: true };
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
    releaseSend(senderKey, type, txn) {
      sends.delete(`${senderKey}|${type}|${txn}`);
    },

    // ---- беседы ----
    createRoom(roomId, owner, memberIds, opts = {}) {
      if ([...new Set(memberIds)].some((userId) => userId !== owner)) return { status: 'mls_commit_required' };
      if (rooms.has(roomId)) return false;
      const orgId = opts.orgId ?? DEFAULT_ORG_ID;
      const org = organizations.get(orgId);
      if (!org || org.status !== 'approved') return { status: 'org_not_approved' };
      const members = [...new Set(memberIds)];
      for (const userId of [...members].sort()) {
        const direct = orgMembers.get(orgId)?.has(userId) ?? false;
        const linked = !direct && [...orgLinks.values()].some((link) => {
          if (link.status !== 'active') return false;
          const memberOrg = link.orgA === orgId ? link.orgB : link.orgB === orgId ? link.orgA : null;
          return memberOrg !== null
            && organizations.get(memberOrg)?.status === 'approved'
            && (orgMembers.get(memberOrg)?.has(userId) ?? false);
        });
        if (!direct && !linked) return { status: 'org_not_member', userId };
      }
      rooms.set(roomId, {
        owner, orgId, admins: new Set(), members: new Set(members),
        joinedSeq: new Map(members.map((m) => [m, counters.eventSeq])), events: [],
        capabilities: new Map(members.map((m) => [m, [...DEFAULT_MEMBER_CAPABILITIES]])),
        name: opts.name ?? null,
      kind: opts.kind ?? 'group', visibility: 'private', readUpTo: new Map(members.map((m) => [m, 0])),
        joinPolicy: 'approval', joinRequests: new Map(), invites: new Map(),
        description: '', backgroundColor: null, avatarAssetId: null, coverAssetId: null, backgroundAssetId: null, assets: new Map(),
      });
      return true;
    },
    createOrOpenDirectConversation({ requester, target, roomId, createdAt }) {
      const requesterFirst = Buffer.compare(Buffer.from(requester, 'utf8'), Buffer.from(target, 'utf8')) < 0;
      const userA = requesterFirst ? requester : target;
      const userB = requesterFirst ? target : requester;
      const pairKey = JSON.stringify([userA, userB]);
      if (isBlockedPair(userA, userB)) return { status: 'blocked' };
      const existing = directConversations.get(pairKey);
      if (existing) return { ...structuredClone(existing), isCreator: existing.createdBy === requester, created: false };
      if (rooms.has(roomId)) return { status: 'room_id_conflict' };
      if (!accounts.has(requester) || !accounts.has(target)) return { status: 'unknown_user' };
      const conversation = { roomId, userA, userB, createdBy: requester, status: 'provisioning', createdAt };
      directConversations.set(pairKey, conversation);
      directConversationsByRoom.set(roomId, conversation);
      rooms.set(roomId, {
        owner: requester, orgId: null, admins: new Set(), members: new Set([requester]),
        joinedSeq: new Map([[requester, counters.eventSeq]]), events: [],
        capabilities: new Map([[requester, [...DEFAULT_MEMBER_CAPABILITIES]]]),
        name: null, kind: 'direct', visibility: 'private', readUpTo: new Map([[requester, 0]]),
        joinPolicy: 'approval', joinRequests: new Map(), invites: new Map(),
        description: '', backgroundColor: null, avatarAssetId: null, coverAssetId: null, backgroundAssetId: null, assets: new Map(),
      });
      return { ...structuredClone(conversation), isCreator: true, created: true };
    },
    directConversation(roomId) {
      const conversation = directConversationsByRoom.get(roomId);
      return conversation ? structuredClone(conversation) : null;
    },
    listContacts(userId) {
      const contactIds = [...(contacts.get(userId) ?? [])];
      const incomingRequests = [...contactRequests.values()]
        .filter((request) => request.recipientId === userId && request.status === 'pending')
        .map((request) => ({
          userId: request.requesterId,
          displayName: profiles.get(request.requesterId)?.nickname?.trim() || request.requesterId,
          roomId: request.roomId,
          createdAt: request.createdAt,
        }));
      return {
        contacts: contactIds.map((contactUserId) => ({
          userId: contactUserId,
          displayName: profiles.get(contactUserId)?.nickname?.trim() || contactUserId,
        })),
        incomingRequests,
      };
    },
    acceptContactRequest(recipientId, requesterId, nowMs) {
      const request = contactRequests.get(requestKey(requesterId, recipientId));
      if (!request) return { status: 'not_found' };
      if (request.status === 'blocked' || isBlockedPair(recipientId, requesterId)) return { status: 'blocked' };
      if (request.status === 'accepted') return { status: 'accepted' };
      addContact(recipientId, requesterId);
      request.status = 'accepted';
      request.decidedAt = nowMs;
      return { status: 'accepted' };
    },
    blockUser(blockerId, blockedId, nowMs) {
      if (!accounts.has(blockerId) || !accounts.has(blockedId)) return { status: 'unknown_user' };
      if (blockerId === blockedId) return { status: 'invalid_pair' };
      userBlocks.add(pairKey(blockerId, blockedId));
      contacts.get(blockerId)?.delete(blockedId);
      contacts.get(blockedId)?.delete(blockerId);
      for (const request of contactRequests.values()) {
        if (((request.requesterId === blockerId && request.recipientId === blockedId)
          || (request.requesterId === blockedId && request.recipientId === blockerId))
          && request.status === 'pending') {
          request.status = 'blocked';
          request.decidedAt = nowMs;
        }
      }
      return { status: 'blocked' };
    },
    getRoom(roomId) {
      const r = rooms.get(roomId);
      if (!r) return null;
      return { owner: r.owner, admins: [...r.admins], members: [...r.members], joinedSeq: Object.fromEntries(r.joinedSeq), capabilities: Object.fromEntries(r.capabilities), name: r.name, visibility: r.visibility, readUpTo: Object.fromEntries(r.readUpTo), joinPolicy: r.joinPolicy, description: r.description, backgroundColor: r.backgroundColor, avatarAssetId: r.avatarAssetId, coverAssetId: r.coverAssetId, backgroundAssetId: r.backgroundAssetId };
    },
    transferRoomOwner(roomId, newOwner) {
      const r = rooms.get(roomId);
      if (!r || !r.members.has(newOwner)) return false;
      const previous = r.owner;
      r.owner = newOwner;
      r.admins.delete(newOwner);
      r.admins.delete(previous);
      return true;
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
        if (!r.members.has(userId)) continue;
        const conversation = directConversationsByRoom.get(roomId);
        const peerUserId = conversation
          ? (conversation.userA === userId ? conversation.userB : conversation.userA)
          : null;
        const peerName = peerUserId ? profiles.get(peerUserId)?.nickname : null;
        const incomingRequest = peerUserId ? contactRequests.get(requestKey(peerUserId, userId)) : null;
        const joinedSeq = r.joinedSeq.get(userId) ?? 0;
        const readSeq = r.readUpTo.get(userId) ?? 0;
        const messages = r.events.filter((event) => event.seq > joinedSeq && event.type === 'm.room.encrypted');
        const lastMessage = messages.at(-1) ?? null;
        const unreadCount = messages.filter((event) => event.seq > Math.max(joinedSeq, readSeq) && event.sender !== userId).length;
        out.push({
          roomId,
          kind: r.kind,
          name: r.name ?? (peerName?.trim() || null),
          peerUserId,
          isPeerContact: !!peerUserId && (contacts.get(userId)?.has(peerUserId) ?? false),
          incomingContactRequest: incomingRequest?.status === 'pending',
          isBlocked: !!peerUserId && isBlockedPair(userId, peerUserId),
          owner: r.owner,
          isAdmin: [...r.admins].includes(userId),
          lastEventSeq: lastMessage?.seq ?? null,
          lastEventAt: lastMessage?.origin_server_ts ?? null,
          unreadCount,
        });
      }
      return out.sort((a, b) => (b.lastEventSeq ?? 0) - (a.lastEventSeq ?? 0) || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0));
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

    // TEST ONLY: inject server/MLS membership divergence for native-client consistency tests.
    // No HTTP route calls this helper; production membership changes must use mlsApplyCommit.
    __testOnlyForceRoomMembership(roomId, userId, present) {
      const room = rooms.get(roomId);
      if (!room) return false;
      if (present) {
        if (room.members.has(userId)) return false;
        const org = organizations.get(room.orgId);
        if (!org || org.status !== 'approved') return { status: 'org_not_approved' };
        const direct = orgMembers.get(room.orgId)?.has(userId) ?? false;
        const linked = !direct && [...orgLinks.values()].some((link) => {
          if (link.status !== 'active') return false;
          const memberOrg = link.orgA === room.orgId ? link.orgB : link.orgB === room.orgId ? link.orgA : null;
          return memberOrg !== null
            && organizations.get(memberOrg)?.status === 'approved'
            && (orgMembers.get(memberOrg)?.has(userId) ?? false);
        });
        if (!direct && !linked) return { status: 'org_not_member' };
        room.members.add(userId);
        room.joinedSeq.set(userId, counters.eventSeq);
        room.capabilities.set(userId, [...DEFAULT_MEMBER_CAPABILITIES]);
        room.readUpTo.set(userId, 0);
        return true;
      }
      room.members.delete(userId);
      room.admins.delete(userId);
      room.joinedSeq.delete(userId);
      room.capabilities.delete(userId);
      room.readUpTo.delete(userId);
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
      const active = [...devices.values()].some((device) => device.userId === userId && device.deviceId === deviceId && !device.revoked);
      if (!active) return 0;
      return mlsPackages.filter((p) => p.userId === userId && p.deviceId === deviceId && p.consumedAt === null && !p.lastResort && p.createdAt >= nowMs - MLS_REGULAR_MAX_AGE_MS).length;
    },
    mlsStoreLastResort(userId, deviceId, bytes, createdAt) {
      const active = [...devices.values()].some((device) => device.userId === userId && device.deviceId === deviceId && !device.revoked);
      if (!active) return false;
      for (let i = mlsPackages.length - 1; i >= 0; i--) {
        const p = mlsPackages[i];
        if (p.userId === userId && p.deviceId === deviceId && p.lastResort) mlsPackages.splice(i, 1);
      }
      mlsPackages.push({ id: mlsPackages.length + 1, userId, deviceId, package: Buffer.from(bytes), createdAt, consumedAt: null, lastResort: true });
      return true;
    },
    mlsStoreKeyPackages(userId, deviceId, packages, createdAt, maxUnused) {
      const active = [...devices.values()].some((device) => device.userId === userId && device.deviceId === deviceId && !device.revoked);
      if (!active) return { ok: false, reason: 'device_revoked' };
      const current = mlsPackages.filter((item) => item.userId === userId && item.deviceId === deviceId
        && item.consumedAt === null && !item.lastResort && item.createdAt >= createdAt - MLS_REGULAR_MAX_AGE_MS).length;
      if (current + packages.length > maxUnused) return { ok: false, reason: 'package_limit' };
      for (const bytes of packages) {
        mlsPackages.push({ id: mlsPackages.length + 1, userId, deviceId, package: Buffer.from(bytes), createdAt, consumedAt: null });
      }
      return { ok: true };
    },
    mlsClaimKeyPackages(targetUserId, requesterUserId, requesterDeviceId, claimId, roomId, nowMs) {
      const hasOrgAccess = (userId, orgId) => {
        if (orgMembers.get(orgId)?.has(userId)) return true;
        return [...orgLinks.values()].some((link) => {
          if (link.status !== 'active') return false;
          const memberOrg = link.orgA === orgId ? link.orgB : link.orgB === orgId ? link.orgA : null;
          return memberOrg !== null
            && organizations.get(memberOrg)?.status === 'approved'
            && (orgMembers.get(memberOrg)?.has(userId) ?? false);
        });
      };
      if (roomId) {
        const room = rooms.get(roomId);
        if (!room) return { ok: false, reason: 'room_not_found' };
        if (room.kind === 'direct') {
          const conversation = directConversationsByRoom.get(roomId);
          const counterpart = conversation?.userA === requesterUserId ? conversation.userB : conversation?.userB === requesterUserId ? conversation.userA : null;
          if (!conversation || conversation.status !== 'provisioning' || conversation.createdBy !== requesterUserId
            || counterpart !== targetUserId || !room.members.has(requesterUserId)) {
            return { ok: false, reason: 'not_authorized' };
          }
          if (isBlockedPair(requesterUserId, targetUserId)) return { ok: false, reason: 'user_blocked' };
        } else {
          if (organizations.get(room.orgId)?.status !== 'approved') return { ok: false, reason: 'org_not_approved' };
          if (!hasOrgAccess(requesterUserId, room.orgId) || !hasOrgAccess(targetUserId, room.orgId)) {
            return { ok: false, reason: 'not_authorized' };
          }
          if (!room.members.has(requesterUserId)
            || (requesterUserId !== room.owner && !room.capabilities.get(requesterUserId)?.includes('invite_members'))) {
            return { ok: false, reason: 'invite_capability_required' };
          }
        }
      } else if (requesterUserId !== targetUserId) {
        const requesterOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(requesterUserId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const targetOrgs = [...orgMembers.entries()]
          .filter(([orgId, members]) => members.has(targetUserId) && organizations.get(orgId)?.status === 'approved')
          .map(([orgId]) => orgId);
        const shared = requesterOrgs.some((a) => targetOrgs.some((b) =>
          a === b || [...orgLinks.values()].some((link) =>
            link.status === 'active' && ((link.orgA === a && link.orgB === b) || (link.orgB === a && link.orgA === b)))));
        if (!shared) return { ok: false, reason: 'not_authorized' };
      }
      const activeDeviceIds = new Set([...devices.values()]
        .filter((device) => device.userId === targetUserId && !device.revoked)
        .map((device) => device.deviceId));
      const claimKey = JSON.stringify([targetUserId, requesterUserId, requesterDeviceId, claimId]);
      const previous = mlsPackageClaims.get(claimKey);
      if (previous) {
        if (previous.state === 'released') return { ok: false, reason: 'claim_released' };
        if (previous.state === 'committed') return { ok: false, reason: 'claim_committed' };
        if (roomId && previous.roomId && previous.roomId !== roomId) return { ok: false, reason: 'claim_room_mismatch' };
        if (roomId && !previous.roomId) previous.roomId = roomId;
        return { ok: true, packages: previous.packages.filter((item) => activeDeviceIds.has(item.deviceId)).map((item) => ({
          deviceId: item.deviceId, packageId: item.packageId, package: Buffer.from(item.package),
        })) };
      }
      const out = [];
      const targetDeviceIds = [...new Set(mlsPackages.filter((p) => p.userId === targetUserId && activeDeviceIds.has(p.deviceId) && p.consumedAt === null).map((p) => p.deviceId))].sort();
      for (const deviceId of targetDeviceIds) {
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
    appendRoomEvent(roomId, sender, type, content, nowMs, afterAppend = null) {
      const r = rooms.get(roomId);
      if (!r) return { state: 'room_not_found' };
      if (r.kind === 'direct') {
        const conversation = directConversationsByRoom.get(roomId);
        if (!conversation || conversation.status !== 'active') return { state: 'direct_not_active' };
        if (![conversation.userA, conversation.userB].includes(sender)) return { state: 'not_member' };
        if (isBlockedPair(conversation.userA, conversation.userB)) return { state: 'user_blocked' };
      } else {
        const roomOrg = organizations.get(r.orgId);
        if (!roomOrg || roomOrg.status !== 'approved') return { state: 'org_not_approved' };
        const direct = orgMembers.get(r.orgId)?.has(sender) ?? false;
        const linked = !direct && [...orgLinks.values()].some((link) => {
          if (link.status !== 'active') return false;
          const memberOrg = link.orgA === r.orgId ? link.orgB : link.orgB === r.orgId ? link.orgA : null;
          return memberOrg !== null
            && organizations.get(memberOrg)?.status === 'approved'
            && (orgMembers.get(memberOrg)?.has(sender) ?? false);
        });
        if (!direct && !linked) return { state: 'org_not_member' };
      }
      if (!r.members.has(sender)) return { state: 'not_member' };
      const seq = ++counters.eventSeq;
      r.events.push({ event_id: `${seq}`, seq, room_id: roomId, sender, origin_server_ts: nowMs, type, content: structuredClone(content ?? null) });
      if (type === 'm.room.encrypted') recordIncomingContactRequest(roomId, sender, nowMs);
      if (afterAppend) return Promise.resolve(afterAppend(null, { seq, roomId, eventId: `${seq}` })).then(() => seq);
      return seq;
    },
    roomEventRows(roomId, sinceSeq, limit = 200) {
      const r = rooms.get(roomId);
      return (r ? r.events : []).filter((e) => e.seq > sinceSeq).slice(0, limit).map((e) => structuredClone(e));
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
    mlsApplyCommit(roomId, baseEpoch, { senderId, deviceId, clientOperationId, requestFingerprint, keyPackageClaimId, joinRequestUserId, commit, welcomes, changes = { adds: [], removes: [] } }, nowMs) {
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
      const room = rooms.get(roomId);
      if (!room) return { ok: false, reason: 'room_not_found', epoch: current };
      const senderDeviceActive = [...devices.values()].some((entry) =>
        entry.userId === senderId && entry.deviceId === deviceId && !entry.revoked);
      if (!senderDeviceActive) return { ok: false, reason: 'sender_device_revoked', epoch: current };
      for (const welcome of welcomes ?? []) {
        const welcomeDeviceActive = [...devices.values()].some((entry) =>
          entry.userId === welcome.userId && entry.deviceId === welcome.deviceId && !entry.revoked);
        if (!welcomeDeviceActive) return { ok: false, reason: 'welcome_device_revoked', epoch: current };
      }
      if (room.kind === 'direct' && (changes.removes?.length ?? 0) > 0) {
        return { ok: false, reason: 'direct_membership_fixed', epoch: current };
      }
      if (room.kind === 'direct' && isBlockedPair(
        directConversationsByRoom.get(roomId)?.userA,
        directConversationsByRoom.get(roomId)?.userB,
      )) return { ok: false, reason: 'user_blocked', epoch: current };
      if ((changes.adds ?? []).length > 0) {
        if (room.kind === 'direct') {
          const conversation = directConversationsByRoom.get(roomId);
          const counterpart = conversation?.userA === senderId ? conversation.userB : conversation?.userB === senderId ? conversation.userA : null;
          if (!conversation || conversation.status !== 'provisioning' || conversation.createdBy !== senderId
            || changes.adds.length !== 1 || changes.adds[0] !== counterpart || !keyPackageClaimId || joinRequestUserId) {
            return { ok: false, reason: 'direct_add_not_authorized', epoch: current };
          }
        } else {
          const roomOrg = organizations.get(room.orgId);
          if (!roomOrg || roomOrg.status !== 'approved') return { ok: false, reason: 'org_not_approved', epoch: current };
          for (const targetUserId of [...changes.adds].sort()) {
          const direct = orgMembers.get(room.orgId)?.has(targetUserId) ?? false;
          const linked = !direct && [...orgLinks.values()].some((link) => {
            if (link.status !== 'active') return false;
            const memberOrg = link.orgA === room.orgId ? link.orgB : link.orgB === room.orgId ? link.orgA : null;
            return memberOrg !== null
              && organizations.get(memberOrg)?.status === 'approved'
              && (orgMembers.get(memberOrg)?.has(targetUserId) ?? false);
          });
          if (!direct && !linked) return { ok: false, reason: 'org_not_member', epoch: current };
          }
        }
      }
      if (joinRequestUserId) {
        if (changes.adds?.length !== 1 || changes.adds[0] !== joinRequestUserId) return { ok: false, reason: 'join_request_mismatch', epoch: current };
        if (!room?.joinRequests.has(joinRequestUserId)) return { ok: false, reason: 'join_request_not_pending', epoch: current };
      }
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
      for (const deviceId of changes.removeDevices ?? []) {
        for (const r of deviceRemovals) if (r.roomId === roomId && r.deviceId === deviceId && r.doneAt === null) r.doneAt = nowMs;
      }
      for (const userId of changes.removes) {
        if (room) { room.members.delete(userId); room.admins.delete(userId); room.joinedSeq.delete(userId); room.capabilities.delete(userId); room.readUpTo.delete(userId); }
      }
      for (const userId of changes.adds) {
        if (room && !room.members.has(userId)) { room.members.add(userId); room.joinedSeq.set(userId, counters.eventSeq); room.capabilities.set(userId, [...DEFAULT_MEMBER_CAPABILITIES]); room.readUpTo.set(userId, 0); }
      }
      if (room?.kind === 'direct' && (changes.adds ?? []).length === 1) {
        const conversation = directConversationsByRoom.get(roomId);
        if (!conversation || conversation.status !== 'provisioning') return { ok: false, reason: 'direct_state_changed', epoch: current };
        conversation.status = 'active';
      }
      const next = current + 1;
      mlsGroups.set(roomId, next);
      mlsCommits.push({ roomId, epoch: next, senderId, commit: Buffer.from(commit), changes: structuredClone({ adds: changes.adds ?? [], removes: changes.removes ?? [], removeDevices: changes.removeDevices ?? [] }), welcomeRecipients: welcomes.map((w) => ({ userId: w.userId, deviceId: w.deviceId })), createdAt: nowMs });
      for (const w of welcomes) {
        mlsWelcomes.push({ id: mlsWelcomes.length + 1, roomId, epoch: next, userId: w.userId, deviceId: w.deviceId, welcome: Buffer.from(w.welcome), createdAt: nowMs, ackedAt: null });
      }
      if (operationKey) mlsCommitOperations.set(operationKey, { requestFingerprint, epoch: next });
      if (reservedClaim) reservedClaim.state = 'committed';
      if (joinRequestUserId) room.joinRequests.delete(joinRequestUserId);
      return { ok: true, epoch: next, replayed: false };
    },
    mlsCommitsSince(roomId, since, limit) {
      return mlsCommits.filter((c) => c.roomId === roomId && c.epoch > since).sort((a, b) => a.epoch - b.epoch).slice(0, limit)
        .map((c) => ({ epoch: c.epoch, senderId: c.senderId, commit: Buffer.from(c.commit), changes: c.changes ? structuredClone(c.changes) : null, welcomeRecipients: c.welcomeRecipients ? structuredClone(c.welcomeRecipients) : null }));
    },
    mlsPendingWelcomes(userId, deviceId) {
      const active = [...devices.values()].some((entry) => entry.userId === userId && entry.deviceId === deviceId && !entry.revoked);
      if (!active) return [];
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
    appendClientMessageEvent(roomId, userId, clientId, sender, type, content, nowMs, afterAppend = null) {
      const hit = clientMessages.find((m) => m.roomId === roomId && m.userId === userId && m.clientId === clientId);
      if (hit?.seq !== null && hit) return { state: 'done', seq: hit.seq };
      if (hit) return { state: 'pending' };
      const seq = this.appendRoomEvent(roomId, sender, type, content, nowMs);
      if (seq && typeof seq === 'object') return seq;
      if (afterAppend) return Promise.resolve(seq).then((value) => afterAppend(null, { seq: value, roomId, eventId: `$${value}` })).then(() => { clientMessages.push({ roomId, userId, clientId, seq: value }); return { state: 'created', seq: value }; });
      clientMessages.push({ roomId, userId, clientId, seq });
      return { state: 'created', seq };
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
      const active = [...devices.values()].some((entry) => entry.userId === userId && entry.deviceId === deviceId && !entry.revoked);
      if (!active) return false;
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
    profileLocaleSet(userId, locale) {
      const profile = profiles.get(userId);
      if (!profile) return false;
      profile.locale = locale;
      return true;
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
    createVerifiedAccount({ userId, passwordHash, email, nickname, nowMs, provider = null, joinDefaultOrg = false, locale = 'hy' }) {
      if (accounts.has(userId)) return 'account';
      for (const p of profiles.values()) {
        if (p.emailVerified && p.email === email) return 'email';
        if (p.nickname.toLowerCase() === nickname.toLowerCase()) return 'nickname';
      }
      const key = provider ? `${provider.provider}|${provider.sub}` : null;
      if (key && providerLinks.has(key)) return 'link';
      accounts.set(userId, passwordHash);
      if (joinDefaultOrg) addOrgMembership(DEFAULT_ORG_ID, userId, 'member', nowMs);
      profiles.set(userId, { email, emailVerified: true, nickname, createdAt: nowMs, locale });
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

    async emailCodeUpdateWithOutbox(email, change, enqueue, locale = 'hy') {
      const cur = emailCodes.get(email);
      const { next, result } = change(cur ? structuredClone(cur) : freshEmailCode());
      emailCodes.set(email, structuredClone({ ...next, locale }));
      try {
        if (enqueue) await enqueue(null, result);
      } catch (error) {
        if (cur) emailCodes.set(email, cur); else emailCodes.delete(email);
        throw error;
      }
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

    async deviceWaitCreateWithOutbox({ userId, deviceId, label, platform, activateAt, cancelHash, createdAt }, enqueue) {
      const key = `${userId}|${deviceId}`;
      if (deviceWaits.has(key)) return 'exists';
      deviceWaits.set(key, { label, platform, activateAt, cancelHash, createdAt });
      try {
        if (enqueue) await enqueue(null);
      } catch (error) {
        deviceWaits.delete(key);
        throw error;
      }
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

    async backupEmailSaveWithOutbox(userId, email, nowMs, enqueue) {
      for (const [uid, b] of backupEmails) if (uid !== userId && b.email === email) return 'taken';
      if (enqueue) await enqueue(null);
      backupEmails.set(userId, { email, createdAt: nowMs });
      return 'ok';
    },
    backupEmailRemove(userId) {
      return backupEmails.delete(userId);
    },

    async backupEmailRemoveWithOutbox(userId, enqueue) {
      if (!backupEmails.has(userId)) return false;
      if (enqueue) await enqueue(null);
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
