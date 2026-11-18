import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const baseUrl = process.env.INONE_SMOKE_BASE_URL;
const email = process.env.INONE_SMOKE_EMAIL;
const locale = process.env.INONE_SMOKE_LOCALE ?? 'ru';
const createAccount = process.env.INONE_SMOKE_CREATE_ACCOUNT === 'true';

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exitCode = 1;
}

if (!baseUrl || !email) {
  fail('set INONE_SMOKE_BASE_URL and INONE_SMOKE_EMAIL; do not put credentials in source files');
} else {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    fail('INONE_SMOKE_BASE_URL must be an absolute URL');
  }

  if (base && (base.username || base.password || base.search || base.hash || !['http:', 'https:'].includes(base.protocol))) {
    fail('base URL must not contain credentials, query parameters or a fragment');
  }
  if (base && base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    fail('HTTPS is required except for a local loopback test server');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) {
    fail('INONE_SMOKE_EMAIL must be a valid single-line email address');
  }
  if (!['hy', 'ru', 'en'].includes(locale)) fail('INONE_SMOKE_LOCALE must be hy, ru or en');
  if (createAccount && (!process.env.INONE_SMOKE_NICKNAME || !process.env.INONE_SMOKE_PASSWORD)) {
    fail('account creation requires INONE_SMOKE_NICKNAME and INONE_SMOKE_PASSWORD');
  }

  if (!process.exitCode) {
    const api = async (path, payload) => {
      const response = await fetch(new URL(path, base), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await response.text();
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`server returned non-JSON response (HTTP ${response.status})`); }
      if (!response.ok) {
        const safeError = typeof body.error === 'string' ? body.error : 'request rejected';
        throw new Error(`${path} failed (HTTP ${response.status}): ${safeError}`);
      }
      return body;
    };

    try {
      const started = await api('/register/email', { email, locale });
      if (started.ok !== true) throw new Error('registration email request was not accepted');
      process.stdout.write(`Verification request accepted for ${email}. Check Inbox and Spam for the InOne code.\n`);

      const rl = createInterface({ input: stdin, output: stdout });
      let code;
      try {
        code = (await rl.question('Enter the 6-digit code from the email: ')).trim();
      } finally {
        rl.close();
      }
      if (!/^\d{6}$/.test(code)) throw new Error('verification code must contain exactly 6 digits');

      const confirmed = await api('/register/email/confirm', { email, code });
      if (typeof confirmed.registrationToken !== 'string' || confirmed.registrationToken.length < 20) {
        throw new Error('server did not issue a valid registration token');
      }

      if (createAccount) {
        const registration = {
          email,
          registrationToken: confirmed.registrationToken,
          nickname: process.env.INONE_SMOKE_NICKNAME,
          password: process.env.INONE_SMOKE_PASSWORD,
        };
        if (process.env.INONE_SMOKE_PHONE) registration.phone = process.env.INONE_SMOKE_PHONE;
        const created = await api('/register', registration);
        if (typeof created.userId !== 'string' || created.verificationLevel !== 1) {
          throw new Error('registration endpoint returned an unexpected account result');
        }
        process.stdout.write(`PASS: email verified and test account created (${created.nickname ?? 'nickname hidden'}).\n`);
      } else {
        process.stdout.write('PASS: real registration email was received, the code was accepted, and a one-time registration token was issued. No account was created.\n');
        process.stdout.write('The unused registration token expires in 30 minutes. To test full account creation, rerun with INONE_SMOKE_CREATE_ACCOUNT=true and the required registration fields.\n');
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : 'live registration smoke test failed');
    }
  }
}
