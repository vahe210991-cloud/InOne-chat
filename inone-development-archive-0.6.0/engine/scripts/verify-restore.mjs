// Сверка восстановления: уникальная цель, одинаковые таблицы/строки и обязательная история миграций.
import pg from 'pg';

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('использование: node scripts/verify-restore.mjs <исходная база> <копия>');
  process.exit(2);
}

async function tableNames(client) {
  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return rows.map((r) => r.table_name);
}

async function rowCounts(client, names) {
  const counts = {};
  for (const name of names) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${quoted}`);
    counts[name] = rows[0].n;
  }
  return counts;
}

async function databaseIdentity(client) {
  const { rows } = await client.query(
    "SELECT current_database() AS database, COALESCE(inet_server_addr()::text, 'local') AS address, COALESCE(inet_server_port(), 0) AS port",
  );
  return rows[0];
}

async function migrationVersions(client, label) {
  const { rows: existence } = await client.query(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present",
  );
  if (!existence[0].present) {
    throw new Error(`${label}: обязательная таблица public.schema_migrations отсутствует`);
  }
  const { rows } = await client.query('SELECT version FROM public.schema_migrations ORDER BY version');
  if (rows.length === 0) {
    throw new Error(`${label}: история миграций пуста; это не подтверждённая база InOne`);
  }
  return rows.map((r) => r.version);
}

const a = new pg.Client({ connectionString: source });
const b = new pg.Client({ connectionString: target });
let aConnected = false;
let bConnected = false;
try {
  await a.connect();
  aConnected = true;
  await b.connect();
  bConnected = true;

  const identityA = await databaseIdentity(a);
  const identityB = await databaseIdentity(b);
  if (JSON.stringify(identityA) === JSON.stringify(identityB)) {
    throw new Error('исходная и целевая базы совпадают; для проверки восстановления нужны две разные базы');
  }

  const namesA = await tableNames(a);
  const namesB = await tableNames(b);
  const problems = [];
  if (namesA.join() !== namesB.join()) problems.push(`таблицы различаются: ${namesA.length} и ${namesB.length}`);
  const countsA = await rowCounts(a, namesA);
  const countsB = await rowCounts(b, namesB);
  for (const name of namesA) {
    if (countsA[name] !== countsB[name]) problems.push(`${name}: ${countsA[name]} строк в исходной базе, ${countsB[name]} в копии`);
  }
  const versionsA = await migrationVersions(a, 'исходная база');
  const versionsB = await migrationVersions(b, 'целевая база');
  if (JSON.stringify(versionsA) !== JSON.stringify(versionsB)) {
    problems.push(`версии миграций различаются: ${JSON.stringify(versionsA)} и ${JSON.stringify(versionsB)}`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    const total = Object.values(countsA).reduce((sum, count) => sum + count, 0);
    console.log(`сверка пройдена: таблиц ${namesA.length}, строк ${total}, миграций ${versionsA.length}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'ошибка сверки восстановления');
  process.exitCode = 1;
} finally {
  if (aConnected) await a.end();
  if (bConnected) await b.end();
}
