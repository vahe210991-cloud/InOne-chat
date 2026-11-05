// Общие помощники тестов восстановления и телефона (D5): код из SMS, ссылка из письма.
import { ChatClient } from '../src/client.js';

/** Последний код из SMS на номер. */
export const smsCodeFrom = (srv, phone) => srv.smsOutbox(phone).at(-1).text.match(/Код: (\d{6})/)[1];

/** Токен из последнего письма со ссылкой восстановления. */
export const linkTokenFrom = (srv, userId) => {
  const mail = srv.mailbox(userId).filter((m) => m.subject === 'Подтверждение восстановления').at(-1);
  return mail.text.match(/token=([A-Za-z0-9_-]+)/)[1];
};

/** Подтверждение ссылки кнопкой на странице: POST с данными из письма. */
export async function confirmLink(base, userId, token) {
  const res = await fetch(`${base}/recovery/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: userId, token }),
  });
  if (!res.ok) throw Object.assign(new Error(`confirm -> ${res.status}`), { status: res.status });
  return res;
}

/** Аккаунт с подтверждённым телефоном: регистрация с номером, код из SMS, подтверждение. */
export async function createVerified(base, srv, userId, deviceId, password, phone) {
  const client = await ChatClient.create(base, userId, deviceId, password, { phone });
  await client.raw('POST', '/account/phone/confirm', { code: smsCodeFrom(srv, phone) });
  return client;
}

/** Начало восстановления: запрос, переход по ссылке из письма. Возвращает код из SMS. */
export async function startRecovery(base, srv, userId, phone) {
  await fetch(`${base}/recovery/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }),
  });
  await confirmLink(base, userId, linkTokenFrom(srv, userId));
  return smsCodeFrom(srv, phone);
}
