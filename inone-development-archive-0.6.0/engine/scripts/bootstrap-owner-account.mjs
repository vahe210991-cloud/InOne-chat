// Первичный аккаунт владельца в базе сервера. Запускает оператор один раз. Пароль — через переменную окружения, не в аргументах.
// INONE_OWNER_PASSWORD='...' INONE_OWNER_PIN='12345678' INONE_OWNER_PIN_CONFIRM='12345678' DATABASE_URL=... INONE_PIN_PEPPER=... node scripts/bootstrap-owner-account.mjs <почта> <никнейм> <телефон> --i-confirm-email-is-mine
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { createStore } from '../src/store.js';
import { bootstrapOwnerAccount } from '../src/bootstrap-owner.js';
import { createLogger } from '../src/logger.js';
import { DEFAULT_PHONE_COUNTRIES } from '../src/phone-international.js';

const list = (text) => (text ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const confirm = args.includes('--i-confirm-email-is-mine');
  const [email, nickname, phone = ''] = args.filter((a) => !a.startsWith('--'));
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const pepper = process.env.INONE_PIN_PEPPER ?? '';
  const password = process.env.INONE_OWNER_PASSWORD ?? '';
  const pin = process.env.INONE_OWNER_PIN ?? '';
  const pinConfirmation = process.env.INONE_OWNER_PIN_CONFIRM ?? '';
  if (!databaseUrl || !pepper || !password || !pin || !pinConfirmation || !email || !nickname || !phone || !confirm) {
    process.stderr.write("usage: INONE_OWNER_PASSWORD='...' INONE_OWNER_PIN='12345678' INONE_OWNER_PIN_CONFIRM='12345678' DATABASE_URL=... INONE_PIN_PEPPER=... node scripts/bootstrap-owner-account.mjs <почта> <никнейм> <телефон> --i-confirm-email-is-mine\n");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const logger = createLogger({ level: 'info' });
  try {
    const store = createStore({ pool, pinPepper: pepper });
    const result = await bootstrapOwnerAccount({
      store, email, nickname, password, phone, pin, pinConfirmation, pinPepper: pepper, confirmOwnerEmail: confirm,
      allowedCountries: list(process.env.INONE_PHONE_ALLOWED_COUNTRIES ?? DEFAULT_PHONE_COUNTRIES.join(',')),
      blockedCountries: list(process.env.INONE_PHONE_BLOCKED_COUNTRIES),
      log: (entry) => logger.info(entry.event, entry),
    });
    process.stdout.write(`аккаунт создан: ${result.nickname}, идентификатор ${result.userId}; пароль не выводится\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
