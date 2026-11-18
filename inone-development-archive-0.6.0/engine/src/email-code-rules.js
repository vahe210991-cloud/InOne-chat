// ============================================================================
// Код подтверждения почты при регистрации (модель аккаунта, этап 1).
// Чистые переходы состояния: одинаково для памяти и базы.
// Код — 6 цифр, действует 10 минут, 5 попыток. Токен регистрации — 30 минут, одноразовый.
// ============================================================================
export const EMAIL_CODE_RULES = {
  codeTtlMs: 10 * 60_000,
  maxCodeAttempts: 5,
  tokenTtlMs: 30 * 60_000,
};

export function freshEmailCode() {
  return { codeHash: null, codeAttempts: 0, codeExpiresAt: 0, tokenHash: null, tokenExpiresAt: 0, locale: 'hy' };
}

/** Новый код: прежние попытки и токен сбрасываются. */
export function requestEmailCode(e, { nowMs, codeHash, rules = EMAIL_CODE_RULES }) {
  return { ...e, codeHash, codeAttempts: 0, codeExpiresAt: nowMs + rules.codeTtlMs, tokenHash: null, tokenExpiresAt: 0 };
}

/** Проверка кода. outcome: none | expired | wrong | locked | ok. При ok выдаётся токен регистрации. */
export function checkEmailCode(e, { nowMs, codeOk, tokenHash, rules = EMAIL_CODE_RULES }) {
  if (!e.codeHash) return { next: e, outcome: 'none' };
  if (nowMs > e.codeExpiresAt) return { next: { ...e, codeHash: null, codeAttempts: 0 }, outcome: 'expired' };
  if (codeOk) {
    return {
      next: { ...e, codeHash: null, codeAttempts: 0, tokenHash, tokenExpiresAt: nowMs + rules.tokenTtlMs },
      outcome: 'ok',
    };
  }
  const attempts = e.codeAttempts + 1;
  if (attempts >= rules.maxCodeAttempts) return { next: { ...e, codeHash: null, codeAttempts: 0 }, outcome: 'locked' };
  return { next: { ...e, codeAttempts: attempts }, outcome: 'wrong' };
}

/** Погашение токена регистрации: один раз. outcome: none | expired | wrong | ok. */
export function useEmailToken(e, { nowMs, tokenOk }) {
  if (!e.tokenHash) return { next: e, outcome: 'none' };
  if (nowMs > e.tokenExpiresAt) return { next: { ...e, tokenHash: null, tokenExpiresAt: 0 }, outcome: 'expired' };
  if (!tokenOk) return { next: e, outcome: 'wrong' };
  return { next: { ...e, tokenHash: null, tokenExpiresAt: 0 }, outcome: 'ok' };
}
