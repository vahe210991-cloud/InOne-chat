// Общие правила создания аккаунта: идентификатор, хэш пароля и проверка пароля.
// Регистрация и процедура создания владельца используют эти функции, поэтому пароль проверяется одинаково.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 8;

export const newUserId = () => 'u' + randomBytes(12).toString('hex');

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}$${scryptSync(password, salt, 32).toString('base64')}`;
}

export function checkPassword(password, stored) {
  const [saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
