// ============================================================================
// Телефон аккаунта (D5): номер и проверка кодом из SMS. Чистые переходы состояния,
// одинаковые для памяти и базы (как recovery-rules.js).
// ============================================================================
export const PHONE_RULES = {
  codeTtlMs: 10 * 60_000, // код подтверждения телефона живёт 10 минут
  maxCodeAttempts: 5,     // неверных кодов до сброса кода
  maxSendsPerHour: 3,     // SMS с кодом не чаще трёх раз в час на аккаунт
};

const HOUR_MS = 60 * 60_000;

export function freshPhone() {
  return { phone: null, verified: false, codeHash: null, codeAttempts: 0, codeExpiresAt: 0, sends: [] };
}

/** Международный формат: знак +, затем 8–15 цифр, первая не ноль. */
export function isPhone(value) {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
}

/** Новый код. outcome: sent | limit. Смена номера снимает подтверждение. */
export function requestPhoneCode(p, { nowMs, phone, codeHash, rules = PHONE_RULES }) {
  const sends = p.sends.filter((t) => nowMs - t < HOUR_MS);
  if (sends.length >= rules.maxSendsPerHour) return { next: { ...p, sends }, outcome: 'limit' };
  return {
    next: {
      ...p, phone, verified: false, codeHash, codeAttempts: 0,
      codeExpiresAt: nowMs + rules.codeTtlMs, sends: [...sends, nowMs],
    },
    outcome: 'sent',
  };
}

/** Проверка кода. outcome: none | expired | wrong | locked | ok. */
export function checkPhoneCode(p, { nowMs, codeOk, rules = PHONE_RULES }) {
  if (!p.codeHash) return { next: p, outcome: 'none' };
  if (nowMs > p.codeExpiresAt) return { next: { ...p, codeHash: null, codeAttempts: 0 }, outcome: 'expired' };
  if (codeOk) return { next: { ...p, verified: true, codeHash: null, codeAttempts: 0 }, outcome: 'ok' };
  const attempts = p.codeAttempts + 1;
  if (attempts >= rules.maxCodeAttempts) return { next: { ...p, codeHash: null, codeAttempts: 0 }, outcome: 'locked' };
  return { next: { ...p, codeAttempts: attempts }, outcome: 'wrong' };
}
