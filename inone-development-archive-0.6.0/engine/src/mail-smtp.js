// Почта через SMTP: коды подтверждения и ссылки. Работает с любым SMTP-сервером (свой или провайдера).
// Адрес, пароль и текст письма в журнал не пишутся. Ошибка отправки — MailUnavailableError с кратким кодом причины.
import nodemailer from 'nodemailer';

export class MailUnavailableError extends Error {
  constructor(reason) {
    super('mail is temporarily unavailable');
    this.name = 'MailUnavailableError';
    this.code = 'MAIL_UNAVAILABLE';
    this.reason = reason;
  }
}

function classify(error) {
  if (error?.code === 'EAUTH') return 'auth';
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EDNS'].includes(error?.code)) return 'connection';
  if (error?.code === 'EENVELOPE') return 'envelope';
  return 'other';
}

export function createSmtpMailer({ host, port = 587, secure = false, requireTls = true, user = '', password = '', from, logger = null, timeoutMs = 10000 }) {
  if (!host) throw new Error('smtp: host is required');
  if (!from) throw new Error('smtp: from is required');
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: requireTls && !secure,
    auth: user ? { user, pass: password } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    tls: { minVersion: 'TLSv1.2' },
  });
  return {
    async send({ to, subject, text, html }) {
      try {
        const info = await transport.sendMail({ from, to, subject, text, html });
        // Nodemailer can resolve sendMail() with rejected recipients in its result.
        // Each queue row has exactly one recipient, so only an explicit acceptance
        // of that address is a successful SMTP hand-off.
        const recipient = to.trim().toLowerCase();
        const accepted = Array.isArray(info.accepted) &&
          info.accepted.some((address) => String(address).trim().toLowerCase() === recipient);
        if (!accepted) {
          const error = new Error('SMTP server did not accept the recipient');
          error.code = 'EENVELOPE';
          throw error;
        }
        logger?.info('mail sent', { messageId: info.messageId ?? null });
        return { messageId: info.messageId ?? null };
      } catch (error) {
        const reason = classify(error);
        logger?.error('mail failed', { reason });
        throw new MailUnavailableError(reason);
      }
    },
    close() {
      transport.close();
    },
  };
}
