// ============================================================================
/** Recovery and post-recovery identity challenge transitions. */
export const RECOVERY_RULES = {
  codeTtlMs: 60 * 60_000,
  keyResetMs: 48 * 60 * 60_000,
  maxCodeAttempts: 5,
  lockMs: 60 * 60_000,
  maxStartsPerHour: 3,
  maxIdentityAttempts: 5,
  // Post-recovery login codes are deliberately shorter-lived than recovery request codes.
  identityCodeTtlMs: 10 * 60_000,
  identityResendCooldownMs: 60_000,
  identityLockMs: 60 * 60_000,
};

const HOUR_MS = 60 * 60_000;

const clearIdentityChallenge = (r) => ({
  ...r,
  identityCodeHash: null,
  identityCodeExpiresAt: 0,
  identityDeviceId: null,
  identityChallengeId: null,
});

export function freshRecovery() {
  return {
    reqStatus: null, reqStartedAt: 0, reqExpiresAt: 0, reqCodeHash: null, reqAttempts: 0,
    reqLinkHash: null, reqLinkConfirmed: false,
    windowStartedAt: null, windowKeyResetAt: null, windowPreviousHash: null,
    identityCheck: false, identityCodeHash: null, identityAttempts: 0,
    identityCodeExpiresAt: 0, identityDeviceId: null, identityChallengeId: null,
    identityLockedUntil: 0, identityLastSentAt: 0,
    lockedUntil: 0, starts: [],
  };
}

/** Recovery window: devices may read, while old devices can cancel. */
export function windowOpen(r, nowMs) {
  return r.windowKeyResetAt !== null && nowMs < r.windowKeyResetAt;
}

export function requestCode(r, { nowMs, codeHash, linkHash, rules = RECOVERY_RULES }) {
  const starts = r.starts.filter((t) => nowMs - t < HOUR_MS);
  const live = r.reqStatus === 'pending' && nowMs < r.reqExpiresAt;
  const closed = r.lockedUntil > nowMs;
  if (live || closed || starts.length >= rules.maxStartsPerHour) return { next: { ...r, starts }, issued: false };
  return {
    next: {
      ...r, reqStatus: 'pending', reqStartedAt: nowMs, reqExpiresAt: nowMs + rules.codeTtlMs,
      reqCodeHash: codeHash, reqAttempts: 0, reqLinkHash: linkHash, reqLinkConfirmed: false,
      starts: [...starts, nowMs],
    },
    issued: true,
  };
}

export function confirmLink(r, { nowMs, linkOk }) {
  if (r.reqStatus !== 'pending') return { next: r, outcome: 'none' };
  if (nowMs > r.reqExpiresAt) return { next: { ...r, reqStatus: 'expired' }, outcome: 'expired' };
  if (!linkOk) return { next: r, outcome: 'wrong' };
  return { next: { ...r, reqLinkConfirmed: true }, outcome: 'ok' };
}

export function checkCode(r, { nowMs, codeOk, rules = RECOVERY_RULES }) {
  if (r.reqStatus !== 'pending') return { next: r, outcome: 'none' };
  if (nowMs > r.reqExpiresAt) return { next: { ...r, reqStatus: 'expired' }, outcome: 'expired' };
  if (!codeOk) {
    const attempts = r.reqAttempts + 1;
    if (attempts >= rules.maxCodeAttempts) {
      return { next: { ...r, reqAttempts: attempts, reqStatus: 'locked', lockedUntil: nowMs + rules.lockMs }, outcome: 'locked' };
    }
    return { next: { ...r, reqAttempts: attempts }, outcome: 'wrong' };
  }
  if (!r.reqLinkConfirmed) return { next: r, outcome: 'unconfirmed' };
  return { next: r, outcome: 'ok' };
}

/** Password accepted: open the recovery window and require a first-login identity challenge. */
export function completeRecovery(r, { nowMs, previousHash, rules = RECOVERY_RULES }) {
  const open = windowOpen(r, nowMs);
  return {
    ...clearIdentityChallenge(r),
    reqStatus: 'completed',
    windowStartedAt: open ? r.windowStartedAt : r.reqStartedAt,
    windowKeyResetAt: nowMs + rules.keyResetMs,
    windowPreviousHash: open ? r.windowPreviousHash : previousHash,
    identityCheck: true,
    identityAttempts: 0,
    identityLockedUntil: 0,
    identityLastSentAt: 0,
  };
}

export function cancelWindow(r) {
  return {
    ...clearIdentityChallenge(r),
    reqStatus: r.reqStatus === 'completed' ? 'cancelled' : r.reqStatus,
    windowStartedAt: null, windowKeyResetAt: null, windowPreviousHash: null,
    identityCheck: false, identityAttempts: 0,
    identityLockedUntil: 0, identityLastSentAt: 0,
  };
}

/**
 * Issues or reuses a challenge bound to one device and one challenge ID.
 * outcome: sent | active | cooldown | device_mismatch | locked.
 */
export function issueIdentity(r, {
  codeHash,
  deviceId,
  challengeId,
  nowMs,
  rules = RECOVERY_RULES,
}) {
  if (r.identityLockedUntil > nowMs) {
    return { next: r, outcome: 'locked', challengeId: null, expiresAt: r.identityCodeExpiresAt, resendAfter: r.identityLockedUntil };
  }

  const attempts = r.identityLockedUntil > 0 && nowMs >= r.identityLockedUntil
    ? 0
    : r.identityAttempts;
  const hasActiveCode = !!r.identityCodeHash && r.identityCodeExpiresAt > nowMs;
  const cooldownUntil = r.identityLastSentAt + rules.identityResendCooldownMs;

  if (hasActiveCode && r.identityDeviceId === deviceId && nowMs < cooldownUntil) {
    return {
      next: { ...r, identityAttempts: attempts },
      outcome: 'active',
      challengeId: r.identityChallengeId,
      expiresAt: r.identityCodeExpiresAt,
      resendAfter: cooldownUntil,
    };
  }
  if (r.identityLastSentAt > 0 && nowMs < cooldownUntil) {
    return {
      next: { ...r, identityAttempts: attempts },
      outcome: hasActiveCode ? 'device_mismatch' : 'cooldown',
      challengeId: null,
      expiresAt: r.identityCodeExpiresAt,
      resendAfter: cooldownUntil,
    };
  }

  const next = {
    ...r,
    identityCodeHash: codeHash,
    identityCodeExpiresAt: nowMs + rules.identityCodeTtlMs,
    identityDeviceId: deviceId,
    identityChallengeId: challengeId,
    identityAttempts: attempts,
    identityLockedUntil: 0,
    identityLastSentAt: nowMs,
  };
  return {
    next,
    outcome: 'sent',
    challengeId,
    expiresAt: next.identityCodeExpiresAt,
    resendAfter: nowMs + rules.identityResendCooldownMs,
  };
}

/** Checks expiry, device/challenge binding, and bounded attempts. */
export function checkIdentity(r, {
  nowMs,
  deviceId,
  challengeId,
  codeOk,
  rules = RECOVERY_RULES,
}) {
  if (r.identityLockedUntil > nowMs) return { next: r, outcome: 'locked' };
  if (!r.identityCodeHash) return { next: r, outcome: 'expired' };
  if (r.identityCodeExpiresAt <= nowMs) {
    return { next: clearIdentityChallenge(r), outcome: 'expired' };
  }
  if (r.identityDeviceId !== deviceId || r.identityChallengeId !== challengeId) {
    return { next: r, outcome: 'wrong' };
  }
  if (codeOk) {
    return {
      next: {
        ...clearIdentityChallenge(r),
        identityCheck: false,
        identityAttempts: 0,
        identityLockedUntil: 0,
        identityLastSentAt: 0,
      },
      outcome: 'ok',
    };
  }
  const attempts = r.identityAttempts + 1;
  if (attempts >= rules.maxIdentityAttempts) {
    return {
      next: {
        ...clearIdentityChallenge(r),
        identityAttempts: attempts,
        identityLockedUntil: nowMs + rules.identityLockMs,
      },
      outcome: 'locked',
    };
  }
  return { next: { ...r, identityAttempts: attempts }, outcome: 'wrong' };
}

export function closeWindowIfDue(r, nowMs) {
  if (r.windowKeyResetAt === null || nowMs < r.windowKeyResetAt) return { next: r, dueSince: null };
  return { next: { ...r, windowKeyResetAt: null }, dueSince: r.windowStartedAt };
}
