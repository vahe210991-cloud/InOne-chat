import { randomBytes } from 'node:crypto';
// Резервная копия и восстановление на настоящей PostgreSQL: копия снимается, восстанавливается в пустую базу,
// сверка подтверждает строки и миграции; повреждённая копия не восстанавливается; хранятся последние копии.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { createStore } from '../src/store.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PEPPER = randomBytes(24).toString('hex');
const PROBE = '@backup-probe:inone.test';

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin(sql) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

dbTest('копия восстанавливается в пустую базу без потерь; повреждённая копия отвергается', async () => {
  const tag = `${process.pid}_${Date.now() % 100000}`;
  const srcName = `inone_backup_src_${tag}`;
  const dstName = `inone_backup_dst_${tag}`;
  const badName = `inone_backup_bad_${tag}`;
  const dir = mkdtempSync(path.join(tmpdir(), 'inone-backup-'));
  const srcUrl = withDatabase(process.env.DATABASE_URL, srcName);
  await admin(`CREATE DATABASE ${srcName}`);
  try {
    const pool = new pg.Pool({ connectionString: srcUrl });
    try {
      await migrate(pool);
      const store = createStore({ pool, pinPepper: PEPPER });
      await store.addAccount(PROBE, 'x');
      await store.addDevice(PROBE, 'P_PHONE');
    } finally {
      await pool.end();
    }
    const dumpPath = execFileSync('bash', [path.join(root, 'scripts/backup-db.sh')], {
      env: { ...process.env, DATABASE_URL: srcUrl, BACKUP_DIR: dir },
      encoding: 'utf8',
    }).trim();

    await admin(`CREATE DATABASE ${dstName}`);
    const dstUrl = withDatabase(process.env.DATABASE_URL, dstName);
    execFileSync('bash', [path.join(root, 'scripts/restore-db.sh'), dumpPath, dstUrl], { encoding: 'utf8' });
    const verified = execFileSync('node', [path.join(root, 'scripts/verify-restore.mjs'), srcUrl, dstUrl], { encoding: 'utf8' });
    assert.match(verified, /сверка пройдена/);
    const dstPool = new pg.Pool({ connectionString: dstUrl });
    try {
      const { rows } = await dstPool.query('SELECT user_id FROM accounts WHERE user_id = $1', [PROBE]);
      assert.equal(rows.length, 1, 'пробный аккаунт восстановлен');
    } finally {
      await dstPool.end();
    }

    const bad = path.join(dir, 'damaged.dump');
    const data = readFileSync(dumpPath);
    data[Math.floor(data.length / 2)] ^= 0xff;
    writeFileSync(bad, data);
    // Контрольная сумма повреждённой копии должна называть свой файл, а не исходный дамп.
    writeFileSync(`${bad}.sha256`, readFileSync(`${dumpPath}.sha256`, 'utf8').split(path.basename(dumpPath)).join(path.basename(bad)));
    await admin(`CREATE DATABASE ${badName}`);
    const refused = spawnSync('bash', [path.join(root, 'scripts/restore-db.sh'), bad, withDatabase(process.env.DATABASE_URL, badName)], { encoding: 'utf8' });
    assert.notEqual(refused.status, 0, 'повреждённая копия не восстанавливается');
    assert.match(refused.stderr, /контрольная сумма/, 'причина названа: контрольная сумма');
  } finally {
    for (const name of [srcName, dstName, badName]) await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

dbTest('хранение: остаются последние копии, старые удаляются вместе с контрольными суммами', async () => {
  const dbName = `inone_backup_keep_${process.pid}_${randomBytes(4).toString('hex')}`;
  const dbUrl = withDatabase(process.env.DATABASE_URL, dbName);
  const dir = mkdtempSync(path.join(tmpdir(), 'inone-keep-'));
  await admin(`CREATE DATABASE ${dbName}`);
  try {
    for (let i = 0; i < 3; i++) {
      execFileSync('bash', [path.join(root, 'scripts/backup-db.sh')], {
        env: { ...process.env, DATABASE_URL: dbUrl, BACKUP_DIR: dir, BACKUP_KEEP: '2' },
        encoding: 'utf8',
      });
    }
    const files = readdirSync(dir);
    assert.equal(files.filter((f) => f.endsWith('.dump')).length, 2);
    assert.equal(files.filter((f) => f.endsWith('.dump.sha256')).length, 2);
  } finally {
    await admin(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});
