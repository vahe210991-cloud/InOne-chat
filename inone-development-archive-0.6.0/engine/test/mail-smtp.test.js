import { randomBytes } from 'node:crypto';
// Почта через SMTP: письмо с кодом доходит, ошибки короткие и без секретов, журнал чистый.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { createSmtpMailer } from '../src/mail-smtp.js';
import { createLogger } from '../src/logger.js';

const FIXTURE_1 = randomBytes(16).toString('hex');
const USER = 'mailer';
const PASS = 'MAIL-SECRET-PASSWORD-1';
const FROM = 'InOne <noreply@inone.example>';


/** Decode text MIME alternatives from Nodemailer test capture. */
function decodedMimeBodies(raw) {
  return raw.split(/\r\n--[^\r\n]+(?:--)?\r\n/g).map((part) => {
    const separator = part.indexOf('\r\n\r\n');
    if (separator < 0) return '';
    const headers = part.slice(0, separator);
    const body = part.slice(separator + 4).trim();
    if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    return body;
  }).join('\n');
}

function startSmtp() {
  const received = [];
  const server = new SMTPServer({
    disabledCommands: ['STARTTLS'],
    onAuth(auth, session, callback) {
      if (auth.username === USER && auth.password === PASS) return callback(null, { user: auth.username });
      return callback(new Error('bad credentials'));
    },
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', (chunk) => { raw += chunk; });
      stream.on('end', () => { received.push({ envelope: session.envelope, raw }); callback(); });
    },
    logger: false,
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.server.address().port;
      resolve({ server, port, received, stop: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('письмо с кодом уходит через SMTP и содержит код', async () => {
  const smtp = await startSmtp();
  try {
    const mailer = createSmtpMailer({ host: '127.0.0.1', port: smtp.port, requireTls: false, user: USER, password: PASS, from: FROM, timeoutMs: 3000 });
    await mailer.send({ to: 'anna@example.test', subject: 'Կոդի հաստատում', text: 'Ձեր կոդը՝ 482913', html: '<!doctype html><html lang="hy"><body><strong>482913</strong></body></html>' });
    assert.equal(smtp.received.length, 1);
    assert.deepEqual(smtp.received[0].envelope.rcptTo.map((r) => r.address), ['anna@example.test']);
    assert.match(smtp.received[0].raw, /text\/html/i);
    const decoded = decodedMimeBodies(smtp.received[0].raw);
    assert.match(decoded, /482913/);
    assert.match(decoded, /Ձեր կոդը/);
    assert.match(smtp.received[0].raw, /multipart\/alternative/i);
    mailer.close();
  } finally {
    await smtp.stop();
  }
});

test('неверный пароль: ошибка с кратким кодом причины, без пароля и адреса', async () => {
  const smtp = await startSmtp();
  try {
    const mailer = createSmtpMailer({ host: '127.0.0.1', port: smtp.port, requireTls: false, user: USER, password: FIXTURE_1, from: FROM, timeoutMs: 3000 });
    const err = await mailer.send({ to: 'anna@example.test', subject: 'Код', text: 'Ваш код: 482913' }).catch((e) => e);
    assert.equal(err.code, 'MAIL_UNAVAILABLE');
    assert.equal(err.reason, 'auth');
    assert.ok(!JSON.stringify({ message: err.message, code: err.code, reason: err.reason }).includes(FIXTURE_1));
    assert.ok(!String(err.message).includes('anna@example.test'));
    assert.equal(smtp.received.length, 0);
    mailer.close();
  } finally {
    await smtp.stop();
  }
});

test('сервер недоступен: ошибка MAIL_UNAVAILABLE за ограниченное время', async () => {
  const smtp = await startSmtp();
  const port = smtp.port;
  await smtp.stop();
  const mailer = createSmtpMailer({ host: '127.0.0.1', port, requireTls: false, user: USER, password: PASS, from: FROM, timeoutMs: 2000 });
  const started = Date.now();
  const err = await mailer.send({ to: 'anna@example.test', subject: 'Код', text: 'Ваш код: 482913' }).catch((e) => e);
  assert.equal(err.code, 'MAIL_UNAVAILABLE');
  assert.equal(err.reason, 'connection');
  assert.ok(Date.now() - started < 5000, 'ошибка приходит без зависания');
  mailer.close();
});

test('журнал не содержит код, текст письма, адрес и пароль', async () => {
  const smtp = await startSmtp();
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
  try {
    const ok = createSmtpMailer({ host: '127.0.0.1', port: smtp.port, requireTls: false, user: USER, password: PASS, from: FROM, logger, timeoutMs: 3000 });
    await ok.send({ to: 'anna@example.test', subject: 'Код', text: 'Ваш код: 771155' });
    const bad = createSmtpMailer({ host: '127.0.0.1', port: smtp.port, requireTls: false, user: USER, password: FIXTURE_1, from: FROM, logger, timeoutMs: 3000 });
    await bad.send({ to: 'anna@example.test', subject: 'Код', text: 'Ваш код: 771155' }).catch(() => {});
    const all = lines.join('\n');
    assert.ok(all.includes('mail sent'), 'успешная отправка записана');
    assert.ok(all.includes('mail failed'), 'ошибка записана');
    assert.ok(!all.includes('771155'), 'код не попадает в журнал');
    assert.ok(!all.includes(PASS) && !all.includes(FIXTURE_1), 'пароль не попадает в журнал');
    assert.ok(!all.includes('anna@example.test'), 'адрес не попадает в журнал');
    ok.close();
    bad.close();
  } finally {
    await smtp.stop();
  }
});

test('адаптер не создаётся без сервера или адреса отправителя', () => {
  assert.throws(() => createSmtpMailer({ from: FROM }), /host is required/);
  assert.throws(() => createSmtpMailer({ host: '127.0.0.1' }), /from is required/);
});
