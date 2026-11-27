// ============================================================================
// Лимиты запросов (D5, защита от накрутки): фиксированные окна времени.
// Считаются все попытки, в том числе отклонённые, поэтому перебор не обходит лимит.
// Окна хранятся в хранилище (PostgreSQL или память) и переживают перезапуск сервера.
// ============================================================================
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_RATE_LIMITS = {
  registrationsPerAddress: [{ windowMs: HOUR_MS, limit: 10 }, { windowMs: DAY_MS, limit: 50 }],
  recoveryPerAddress: [{ windowMs: HOUR_MS, limit: 10 }],
  smsPerPhone: [{ windowMs: DAY_MS, limit: 5 }],
  emailCodePerEmail: [{ windowMs: HOUR_MS, limit: 3 }, { windowMs: DAY_MS, limit: 10 }],
  emailCodePerAddress: [{ windowMs: HOUR_MS, limit: 10 }],
  searchPerAccount: [{ windowMs: HOUR_MS, limit: 30 }],
  searchPerAddress: [{ windowMs: HOUR_MS, limit: 60 }],
  authNoncePerAddress: [{ windowMs: HOUR_MS, limit: 60 }],
  providerAuthPerAddress: [{ windowMs: HOUR_MS, limit: 30 }],
  stepupPerAccount: [{ windowMs: HOUR_MS, limit: 5 }],
  pinResetStartPerAccount: [{ windowMs: HOUR_MS, limit: 3 }],
  pinResetStartPerAddress: [{ windowMs: HOUR_MS, limit: 5 }],
  pinResetCompletePerAccount: [{ windowMs: HOUR_MS, limit: 5 }],
  pinResetCompletePerAddress: [{ windowMs: HOUR_MS, limit: 10 }],
  backupEmailPerAccount: [{ windowMs: HOUR_MS, limit: 5 }],
  deviceWaitCancelPerEmail: [{ windowMs: HOUR_MS, limit: 10 }],
  recoveryCancelPerEmail: [{ windowMs: HOUR_MS, limit: 10 }],
  bioChallengePerAccount: [{ windowMs: HOUR_MS, limit: 30 }],
  mlsClaimPerAccount: [{ windowMs: HOUR_MS, limit: 60 }],
  toDevicePerAccount: [{ windowMs: 60_000, limit: 120 }, { windowMs: HOUR_MS, limit: 1000 }],
  phoneRegistrationPerPhone: [{ windowMs: DAY_MS, limit: 3 }],
};

/** Одна попытка в окне. rec = { windowStart, hits } или null, если окна ещё нет. */
export function applyHit(rec, { nowMs, windowMs, limit }) {
  let windowStart = rec ? rec.windowStart : nowMs;
  let hits = rec ? rec.hits : 0;
  if (nowMs - windowStart >= windowMs) {
    windowStart = nowMs;
    hits = 0;
  }
  hits += 1;
  return { next: { windowStart, hits }, allowed: hits <= limit, retryAt: windowStart + windowMs };
}
