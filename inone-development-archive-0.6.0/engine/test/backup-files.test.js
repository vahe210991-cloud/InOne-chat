import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/migrate.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin(sql) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

async function countPublicTables(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const { rows } = await c.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')");
    return rows[0].n;
  } finally { await c.end(); }
}

function runBackup(databaseUrl, filesDir, backupDir) {
  return execFileSync('bash', [path.join(root, 'scripts/backup-db.sh')], {
    env: { ...process.env, DATABASE_URL: databaseUrl, FILES_DIR: filesDir, BACKUP_DIR: backupDir },
    encoding: 'utf8',
  }).trim().split(/\r?\n/);
}

function writeChecksum(file) {
  execFileSync('bash', ['-lc', `cd "${path.dirname(file)}" && sha256sum "${path.basename(file)}" > "${path.basename(file)}.sha256"`]);
}

dbTest('FILES_DIR: архив создаётся и полностью восстанавливается в пустой каталог', async () => {
  const tag = `${process.pid}_${randomBytes(4).toString('hex')}`;
  const sourceName = `inone_files_src_${tag}`;
  const targetName = `inone_files_dst_${tag}`;
  const failedName = `inone_files_failed_${tag}`;
  const sourceUrl = withDatabase(process.env.DATABASE_URL, sourceName);
  const targetUrl = withDatabase(process.env.DATABASE_URL, targetName);
  const failedUrl = withDatabase(process.env.DATABASE_URL, failedName);
  const temp = mkdtempSync(path.join(tmpdir(), 'inone-files-backup-'));
  const filesSource = path.join(temp, 'source');
  const filesTarget = path.join(temp, 'restored');
  const failedFilesTarget = path.join(temp, 'failed-restored');
  const backupDir = path.join(temp, 'backups');
  mkdirSync(filesSource);
  mkdirSync(backupDir);
  mkdirSync(filesTarget);
  mkdirSync(failedFilesTarget);
  const objectId = randomBytes(32).toString('hex');
  const payload = randomBytes(8192);
  writeFileSync(path.join(filesSource, objectId), payload);
  await admin(`CREATE DATABASE ${sourceName}`);
  try {
    const pool = new pg.Pool({ connectionString: sourceUrl });
    try { await migrate(pool); } finally { await pool.end(); }
    const [dump, archive] = runBackup(sourceUrl, filesSource, backupDir);
    assert.ok(dump.endsWith('.dump'));
    assert.ok(archive.endsWith('.tar.gz'));
    await admin(`CREATE DATABASE ${targetName}`);
    await admin(`CREATE DATABASE ${failedName}`);
    execFileSync('bash', [path.join(root, 'scripts/restore-db.sh'), dump, targetUrl, archive, filesTarget], { encoding: 'utf8' });
    assert.deepEqual(readFileSync(path.join(filesTarget, objectId)), payload);
    assert.deepEqual(readdirSync(filesTarget), [objectId]);
    assert.ok((await countPublicTables(targetUrl)) > 0);

    // A failed PostgreSQL restore must roll back both the DB transaction and published files.
    const invalidDump = path.join(temp, 'invalid.dump');
    writeFileSync(invalidDump, 'not a PostgreSQL custom archive');
    writeChecksum(invalidDump);
    const failed = spawnSync('bash', [path.join(root, 'scripts/restore-db.sh'), invalidDump, failedUrl, archive, failedFilesTarget], { encoding: 'utf8' });
    assert.notEqual(failed.status, 0, 'invalid PostgreSQL dump is rejected');
    assert.equal(await countPublicTables(failedUrl), 0, 'PostgreSQL transaction remains empty');
    assert.deepEqual(readdirSync(failedFilesTarget), [], 'files published before failed DB restore are rolled back');
  } finally {
    await admin(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`).catch(() => {});
    await admin(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`).catch(() => {});
    await admin(`DROP DATABASE IF EXISTS ${failedName} WITH (FORCE)`).catch(() => {});
    rmSync(temp, { recursive: true, force: true });
  }
});

dbTest('FILES_DIR: архив с traversal-путём отклоняется до изменения БД и каталога', async () => {
  const tag = `${process.pid}_${randomBytes(4).toString('hex')}`;
  const sourceName = `inone_files_bad_src_${tag}`;
  const targetName = `inone_files_bad_dst_${tag}`;
  const sourceUrl = withDatabase(process.env.DATABASE_URL, sourceName);
  const targetUrl = withDatabase(process.env.DATABASE_URL, targetName);
  const temp = mkdtempSync(path.join(tmpdir(), 'inone-files-traversal-'));
  const sourceFiles = path.join(temp, 'source');
  const evilFiles = path.join(temp, 'evil');
  const targetFiles = path.join(temp, 'target');
  const backupDir = path.join(temp, 'backups');
  for (const dir of [sourceFiles, evilFiles, targetFiles, backupDir]) mkdirSync(dir);
  writeFileSync(path.join(sourceFiles, randomBytes(32).toString('hex')), 'legitimate');
  writeFileSync(path.join(evilFiles, 'payload'), 'must-not-escape');
  await admin(`CREATE DATABASE ${sourceName}`);
  await admin(`CREATE DATABASE ${targetName}`);
  try {
    const pool = new pg.Pool({ connectionString: sourceUrl });
    try { await migrate(pool); } finally { await pool.end(); }
    const [dump] = runBackup(sourceUrl, sourceFiles, backupDir);
    const evilArchive = path.join(temp, 'traversal.tar.gz');
    execFileSync('tar', ['-czPf', evilArchive, '-C', evilFiles, '--transform=s|payload|../escape|', 'payload']);
    writeChecksum(evilArchive);
    const result = spawnSync('bash', [path.join(root, 'scripts/restore-db.sh'), dump, targetUrl, evilArchive, targetFiles], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'опасный архив отвергнут');
    assert.match(result.stderr, /небезопасный путь/);
    assert.equal(await countPublicTables(targetUrl), 0, 'PostgreSQL не изменена');
    assert.deepEqual(readdirSync(targetFiles), [], 'каталог назначения остался пустым');
    assert.equal(readdirSync(temp).includes('escape'), false, 'файл не записан за пределы каталога');
  } finally {
    await admin(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`).catch(() => {});
    await admin(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`).catch(() => {});
    rmSync(temp, { recursive: true, force: true });
  }
});

dbTest('FILES_DIR: архив с символической ссылкой и повреждённый gzip отклоняются', async () => {
  const tag = `${process.pid}_${randomBytes(4).toString('hex')}`;
  const sourceName = `inone_files_link_src_${tag}`;
  const targetName = `inone_files_link_dst_${tag}`;
  const sourceUrl = withDatabase(process.env.DATABASE_URL, sourceName);
  const targetUrl = withDatabase(process.env.DATABASE_URL, targetName);
  const temp = mkdtempSync(path.join(tmpdir(), 'inone-files-invalid-'));
  const sourceFiles = path.join(temp, 'source');
  const linkFiles = path.join(temp, 'links');
  const targetFiles = path.join(temp, 'target');
  const backupDir = path.join(temp, 'backups');
  for (const dir of [sourceFiles, linkFiles, targetFiles, backupDir]) mkdirSync(dir);
  writeFileSync(path.join(sourceFiles, randomBytes(32).toString('hex')), 'ok');
  writeFileSync(path.join(linkFiles, 'payload'), 'linked');
  await admin(`CREATE DATABASE ${sourceName}`);
  await admin(`CREATE DATABASE ${targetName}`);
  try {
    const pool = new pg.Pool({ connectionString: sourceUrl });
    try { await migrate(pool); } finally { await pool.end(); }
    const [dump] = runBackup(sourceUrl, sourceFiles, backupDir);
    const linkArchive = path.join(temp, 'links.tar.gz');
    execFileSync('bash', ['-lc', `ln -s /tmp/inone-outside "${linkFiles}/link" && tar -czf "${linkArchive}" -C "${linkFiles}" link`]);
    writeChecksum(linkArchive);
    const linkResult = spawnSync('bash', [path.join(root, 'scripts/restore-db.sh'), dump, targetUrl, linkArchive, targetFiles], { encoding: 'utf8' });
    assert.notEqual(linkResult.status, 0);
    assert.match(linkResult.stderr, /ссылки или специальные файлы/);
    assert.equal(await countPublicTables(targetUrl), 0);

    const corrupt = path.join(temp, 'corrupt.tar.gz');
    writeFileSync(corrupt, 'not a gzip archive');
    writeChecksum(corrupt);
    const corruptResult = spawnSync('bash', [path.join(root, 'scripts/restore-db.sh'), dump, targetUrl, corrupt, targetFiles], { encoding: 'utf8' });
    assert.notEqual(corruptResult.status, 0);
    assert.match(corruptResult.stderr, /некорректен или повреждён/);
    assert.equal(await countPublicTables(targetUrl), 0);
    assert.deepEqual(readdirSync(targetFiles), []);
  } finally {
    await admin(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`).catch(() => {});
    await admin(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`).catch(() => {});
    rmSync(temp, { recursive: true, force: true });
  }
});
