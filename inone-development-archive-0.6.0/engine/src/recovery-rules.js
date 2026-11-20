// ============================================================================
// Правила восстановления (D1, D5, D8): чистые переходы состояния.
// Состояние хранит хранилище (PostgreSQL или память) и меняет его под блокировкой строки.
// Здесь только правила, поэтому оба хранилища ведут себя одинаково.
// Восстановление требует два канала (D5): код из SMS и переход по ссылке из письма.
// ============================================================================
export const RECOVERY_RULES = {
  codeTtlMs: 60 * 60_000,        // код и ссылка восстановления живут час
  keyResetMs: 48 * 60 * 60_000,  // окно: 48 часов до отключения старых устройств (D5)
  maxCodeAttempts: 5,            // неверных кодов до блокировки запросов
  lockMs: 60 * 60_000,           // блокировка новых кодов после пяти неверных
  maxStartsPerHour: 3,           // новых запросов восстановления за час
  maxIdentityAttempts: 5,        // неверных кодов входа после восстановления
};

const HOUR_MS = 60 * 60_000;

export function freshRecovery() {
  return {
    reqStatus: null, reqStartedAt: 0, reqExpiresAt: 0, reqCodeHash: null, reqAttempts: 0,
    reqLinkHash: null, reqLinkConfirmed: false,
    windowStartedAt: null, windowKeyResetAt: null, windowPreviousHash: null,
    identityCheck: false, identityCodeHash: null, identityAttempts: 0,
    lockedUntil: 0, starts: [],
  };
}

/** Окно открыто: все устройства аккаунта только читают; старое может отменить восстановление (D8). */
export function windowOpen(r, nowMs) {
  return r.windowKeyResetAt !== null && nowMs < r.windowKeyResetAt;
}

/** Новый запрос выдаётся, если нет живого запроса, нет блокировки и не больше трёх запросов за час. */
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

/** Переход по ссылке из письма (D5). outcome: none | expired | ok | wrong. */
export function confirmLink(r, { nowMs, linkOk }) {
  if (r.reqStatus !== 'pending') return { next: r, outcome: 'none' };
  if (nowMs > r.reqExpiresAt) return { next: { ...r, reqStatus: 'expired' }, outcome: 'expired' };
  if (!linkOk) return { next: r, outcome: 'wrong' };
  return { next: { ...r, reqLinkConfirmed: true }, outcome: 'ok' };
}

/** Проверка кода из SMS. Без подтверждения по ссылке код не принимается. outcome: none | expired | unconfirmed | ok | wrong | locked. */
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

/** Новый пароль принят. Окно открывается; если уже открыто, не сдвигается, а откат остаётся прежним (D8). */
export function completeRecovery(r, { nowMs, previousHash, rules = RECOVERY_RULES }) {
  const open = windowOpen(r, nowMs);
  return {
    ...r,
    reqStatus: 'completed',
    windowStartedAt: open ? r.windowStartedAt : r.reqStartedAt,
    windowKeyResetAt: open ? r.windowKeyResetAt : nowMs + rules.keyResetMs,
    windowPreviousHash: open ? r.windowPreviousHash : previousHash,
    identityCheck: true,
    identityCodeHash: null,
    identityAttempts: 0,
  };
}

/** Отмена со старого устройства: окно закрывается, проверка входа снимается. */
export function cancelWindow(r) {
  return {
    ...r,
    reqStatus: r.reqStatus === 'completed' ? 'cancelled' : r.reqStatus,
    windowStartedAt: null, windowKeyResetAt: null, windowPreviousHash: null,
    identityCheck: false, identityCodeHash: null, identityAttempts: 0,
  };
}

/** Код проверки первого входа после восстановления отправлен. */
export function issueIdentity(r, { codeHash }) {
  return { ...r, identityCodeHash: codeHash, identityAttempts: 0 };
}

/** Проверка кода первого входа. outcome: none | ok | wrong | locked. */
export function checkIdentity(r, { codeOk, rules = RECOVERY_RULES }) {
  if (!r.identityCodeHash) return { next: r, outcome: 'none' };
  if (codeOk) return { next: { ...r, identityCheck: false, identityCodeHash: null, identityAttempts: 0 }, outcome: 'ok' };
  const attempts = r.identityAttempts + 1;
  if (attempts >= rules.maxIdentityAttempts) return { next: { ...r, identityCodeHash: null, identityAttempts: 0 }, outcome: 'locked' };
  return { next: { ...r, identityAttempts: attempts }, outcome: 'wrong' };
}

/** Окно закончилось: возвращает начало окна, если пора отключать старые устройства. */
export function closeWindowIfDue(r, nowMs) {
  if (r.windowKeyResetAt === null || nowMs < r.windowKeyResetAt) return { next: r, dueSince: null };
  return { next: { ...r, windowKeyResetAt: null }, dueSince: r.windowStartedAt };
}
