// Аккаунт для разработки: почта подтверждается фиксированным кодом (INONE_DEV_EMAIL_CODE).
// Работает только с сервером разработки; в продакшене код не принимается.
// Использование: node scripts/dev-create-account.mjs <адрес сервера> <почта> <никнейм> <пароль> [телефон]
import { pathToFileURL } from 'node:url';

export async function createDevAccount({ base, email, nickname, password, phone = '', code }) {
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  };
  let r = await post('/register/email', { email });
  if (r.status !== 202) throw new Error(`register/email: ${r.status} ${JSON.stringify(r.data)}`);
  r = await post('/register/email/confirm', { email, code });
  if (r.status !== 200) throw new Error(`confirm: ${r.status} ${JSON.stringify(r.data)}`);
  const registration = { email, registrationToken: r.data.registrationToken, password, nickname };
  if (phone) registration.phone = phone;
  r = await post('/register', registration);
  if (r.status !== 200 && r.status !== 201) throw new Error(`register: ${r.status} ${JSON.stringify(r.data)}`);
  return { email, nickname, server: r.data };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [base, email, nickname, password, phone] = process.argv.slice(2);
  const code = process.env.INONE_DEV_EMAIL_CODE ?? '';
  if (!base || !email || !nickname || !password || !/^\d{6}$/.test(code)) {
    process.stderr.write('usage: INONE_DEV_EMAIL_CODE=<6 цифр> node scripts/dev-create-account.mjs <адрес сервера> <почта> <никнейм> <пароль> [телефон]\n');
    process.exit(1);
  }
  createDevAccount({ base, email, nickname, password, phone, code })
    .then((result) => process.stdout.write(`аккаунт создан: ${result.nickname} (${result.email}); пароль не выводится\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}
