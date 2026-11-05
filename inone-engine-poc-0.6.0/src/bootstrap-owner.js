// Первичный аккаунт владельца. Создаёт оператор сервера прямо в базе, один раз. Письма для этого не нужны:
// почта отмечается подтверждённой оператором, и это решение записывается в журнал. Дальше вход — обычный, по паролю.
import { hashPassword, MIN_PASSWORD_LENGTH, newUserId } from './account-rules.js';
import { normalizeEmail, isEmail, validateNickname } from './identity-rules.js';
import { normalizePhone } from './phone-international.js';

export async function bootstrapOwnerAccount({
  store, email, nickname, password, phone = '', confirmOwnerEmail = false,
  allowedCountries = [], blockedCountries = [], nowMs = Date.now(), log = () => {},
}) {
  if (confirmOwnerEmail !== true) throw new Error('confirm that the email belongs to the owner (--i-confirm-email-is-mine)');
  const mail = normalizeEmail(email);
  if (!isEmail(mail)) throw new Error('email must be a valid address');
  const nickError = validateNickname(nickname);
  if (nickError) throw new Error(nickError);
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  let phoneE164 = null;
  if (phone) {
    const checked = normalizePhone(phone, { blockedCountries, allowedCountries });
    if (checked.error) throw new Error(checked.error);
    phoneE164 = checked.value.e164;
    if (await store.phoneOwner(phoneE164)) throw new Error('phone already used by another account');
  }
  if (await store.userIdByEmail(mail)) throw new Error('email already registered');
  if (await store.searchNickname(nickname)) throw new Error('nickname taken');
  const userId = newUserId();
  const created = await store.createVerifiedAccount({ userId, passwordHash: hashPassword(password), email: mail, nickname, nowMs });
  if (created !== 'ok') throw new Error(`account not created: ${created}`);
  if (phoneE164) {
    await store.phoneUpdate(userId, () => ({ next: { phone: phoneE164, verified: false, codeHash: null, codeAttempts: 0, codeExpiresAt: 0, sends: [] }, result: 'saved' }));
  }
  log({ event: 'owner account created', userId, nickname, at: new Date(nowMs).toISOString(), emailConfirmedByOperator: true, phoneStoredPending: phoneE164 !== null });
  return { userId, nickname };
}
