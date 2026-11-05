// ============================================================================
// Правила аккаунта InOne (спецификация IDENTITY_MODEL_2026-10-21.md).
// Почта приватна и нужна для входа и кодов. Никнейм публичный и уникальный
// без учёта регистра: по нему находят пользователя.
// ============================================================================
export const RESERVED_NICKNAMES = ['inone', 'propo', 'admin', 'administrator', 'support', 'help', 'root', 'system', 'moderator', 'official'];

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Ник: 3–20 символов, латиница, цифры, точка и подчёркивание; начинается с буквы. Возвращает текст ошибки или null. */
export function validateNickname(value) {
  if (typeof value !== 'string') return 'nickname must be a string';
  if (!/^[a-zA-Z][a-zA-Z0-9._]{2,19}$/.test(value)) {
    return 'nickname: 3-20 latin letters, digits, dot or underscore, starts with a letter';
  }
  if (value.includes('..') || value.endsWith('.') || value.endsWith('_')) {
    return 'nickname: no double dots, no trailing dot or underscore';
  }
  if (RESERVED_NICKNAMES.includes(value.toLowerCase())) return 'nickname is reserved';
  return null;
}
