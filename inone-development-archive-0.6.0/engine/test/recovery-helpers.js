// Shared helpers for the email-code + PIN recovery flow.
import { ChatClient } from '../src/client.js';
import { hashPassword } from '../src/account-rules.js';
import { hashPin } from '../src/pin-security.js';

export const TEST_PIN = '80421697';

export function emailForUserId(userId) {
  const local = String(userId).replace(/^@/, '').split(':')[0].replace(/[^a-z0-9._-]/gi, '-');
  return `${local}@example.test`;
}

export const recoveryEmailCount = (srv, email) =>
  srv.mailbox(email).filter((message) => message.templateId === 'recovery_code').length;

/** Creates a verified-email account fixture with the current eight-digit PIN policy. */
export async function createVerified(base, srv, userId, deviceId, password, phone) {
  const email = emailForUserId(userId);
  const nickname = String(userId).replace(/^@/, '').split(':')[0].replace(/[^a-z0-9._-]/gi, '');
  const created = await srv.testStore.createVerifiedAccount({
    userId,
    passwordHash: hashPassword(password),
    pinHash: await hashPin(srv.testPinPepper, TEST_PIN),
    phoneE164: phone,
    email,
    nickname: nickname.length >= 3 ? nickname : `User${nickname}`,
    nowMs: Date.now(),
    locale: 'ru',
  });
  if (created !== 'ok') throw new Error(`test account creation failed: ${created}`);
  return ChatClient.login(base, userId, password, deviceId);
}

/** Starts recovery and returns the one-time code delivered to the verified primary email. */
export async function startRecovery(base, srv, userId) {
  const email = emailForUserId(userId);
  const response = await fetch(`${base}/recovery/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, locale: 'ru' }),
  });
  if (response.status !== 202) throw new Error(`recovery start failed: ${response.status}`);
  const message = srv.mailbox(email).filter((item) => item.templateId === 'recovery_code').at(-1);
  if (!message) throw new Error('recovery email code was not queued');
  const match = message.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error('recovery email code missing');
  return match[1];
}
