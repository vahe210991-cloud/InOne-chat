// ============================================================================
// Защита входа (D7): жёсткой блокировки логина нет.
// Три счётчика: пара «адрес и логин» (нарастающие задержки), адрес (ограничение на все логины)
// и логин (уведомление владельцу без блокировки). Функция чистая: хранилище читает и записывает
// записи под блокировкой, а решение принимает здесь. Поэтому PostgreSQL и память работают одинаково.
// ============================================================================
export const LOGIN_POLICY = {
  freeFailures: 2,          // первые две неудачи с одной пары без задержки
  baseDelayMs: 60_000,      // с третьей неудачи — минута, затем вдвое дольше
  maxDelayMs: 15 * 60_000,  // потолок задержки
  sourceLimit: 30,          // адрес: 30 неудач за окно — ограничение адреса
  sourceWindowMs: 10 * 60_000,
  sourceBlockMs: 10 * 60_000,
  notifyAfter: 5,           // владельцу: пять неудач по логину из любых адресов за окно
  notifyWindowMs: 15 * 60_000,
};

export const freshCounter = () => ({ failed: 0, windowStart: 0, blockedUntil: 0 });

function bump(rec, nowMs, windowMs) {
  if (nowMs - rec.windowStart >= windowMs) {
    rec.failed = 0;
    rec.windowStart = nowMs;
  }
  rec.failed += 1;
}

/**
 * Решение о попытке входа. pair, source, login — текущие записи счётчиков (или undefined).
 * Возвращает статус и новые записи; сохранять их должно хранилище под блокировкой.
 */
export function decideLogin({ pair, source, login, nowMs, verify, notify, policy = LOGIN_POLICY }) {
  const p = { ...(pair ?? freshCounter()) };
  const s = { ...(source ?? freshCounter()) };
  const l = { ...(login ?? freshCounter()) };
  if (p.blockedUntil > nowMs) return { status: 'throttled', retryAt: p.blockedUntil, pair: p, source: s, login: l, notify: false };
  if (s.blockedUntil > nowMs) return { status: 'throttled', retryAt: s.blockedUntil, pair: p, source: s, login: l, notify: false };
  if (verify()) return { status: 'ok', pair: freshCounter(), source: s, login: l, notify: false };
  p.failed += 1;
  if (p.failed > policy.freeFailures) {
    const steps = p.failed - policy.freeFailures - 1;
    p.blockedUntil = nowMs + Math.min(policy.baseDelayMs * 2 ** steps, policy.maxDelayMs);
  }
  bump(s, nowMs, policy.sourceWindowMs);
  if (s.failed >= policy.sourceLimit) s.blockedUntil = nowMs + policy.sourceBlockMs;
  bump(l, nowMs, policy.notifyWindowMs);
  const crossed = !!notify && l.failed === policy.notifyAfter;
  return { status: 'wrong', pair: p, source: s, login: l, notify: crossed };
}
