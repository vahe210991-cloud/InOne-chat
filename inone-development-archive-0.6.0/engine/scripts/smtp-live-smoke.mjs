// Explicit opt-in live SMTP smoke test. Sends one harmless message to INONE_SMTP_TEST_TO.
import { randomUUID } from 'node:crypto';
import { createSmtpMailer } from '../src/mail-smtp.js';

const required = ['INONE_SMTP_HOST', 'INONE_SMTP_FROM', 'INONE_SMTP_TEST_TO'];
for (const key of required) {
  if (!process.env[key]?.trim()) {
    console.error(`missing required environment variable: ${key}`);
    process.exit(2);
  }
}
const port = Number(process.env.INONE_SMTP_PORT ?? 587);
const secure = process.env.INONE_SMTP_SECURE === 'true';
const requireTls = process.env.INONE_SMTP_REQUIRE_TLS !== 'false';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('INONE_SMTP_PORT must be a valid TCP port');
  process.exit(2);
}
if (process.env.INONE_SMTP_USER && !process.env.INONE_SMTP_PASSWORD) {
  console.error('INONE_SMTP_PASSWORD is required when INONE_SMTP_USER is set');
  process.exit(2);
}
if (!secure && !requireTls) {
  console.error('live SMTP smoke test requires TLS; use implicit TLS or STARTTLS');
  process.exit(2);
}

const mailer = createSmtpMailer({
  host: process.env.INONE_SMTP_HOST,
  port,
  secure,
  requireTls,
  user: process.env.INONE_SMTP_USER ?? '',
  password: process.env.INONE_SMTP_PASSWORD ?? '',
  from: process.env.INONE_SMTP_FROM,
  timeoutMs: Number(process.env.INONE_SMTP_TIMEOUT_MS ?? 15000),
});
const id = randomUUID();
try {
  const result = await mailer.send({
    to: process.env.INONE_SMTP_TEST_TO,
    subject: `InOne SMTP delivery smoke test ${id}`,
    text: `This is an explicitly requested InOne SMTP connectivity test. Reference: ${id}. No account or recovery action is associated with this message.`,
  });
  console.log(`SMTP server accepted the test message (messageId=${result.messageId ?? 'not-provided'}).`);
  console.log('This confirms SMTP hand-off only; it does not prove inbox placement or recipient visibility.');
} catch (error) {
  console.error(`SMTP smoke test failed (reason=${error?.reason ?? 'other'}).`);
  process.exitCode = 1;
} finally {
  mailer.close();
}
