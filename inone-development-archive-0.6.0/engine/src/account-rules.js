// Общие правила создания аккаунта: идентификатор, хэш пароля и проверка пароля.
// Регистрация и процедура создания владельца используют эти функции, поэтому пароль проверяется одинаково.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function passwordLength(password) {
  return Array.from(password).length;
}

export const newUserId = () => 'u' + randomBytes(12).toString('hex');

export function hashPassword(password) {
  const length = typeof password === 'string' ? passwordLength(password) : 0;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new TypeError('password length is outside the supported range');
  }
  const salt = randomBytes(16);
  return `${salt.toString('base64')}$${scryptSync(password, salt, 32).toString('base64')}`;
}

export function checkPassword(password, stored) {
  if (typeof password !== 'string') return false;
  const length = passwordLength(password);
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) return false;
  if (typeof stored !== 'string') return false;
  const [saltB64, hashB64] = stored.split('
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
);
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
