// Сверка копии с исходной базой: одинаковые таблицы, одинаковое число строк в каждой, одинаковые версии миграций.
// Использование: node scripts/verify-restore.mjs <адрес исходной базы> <адрес копии>
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
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${name}"`);
    counts[name] = rows[0].n;
  }
  return counts;
}

async function migrationVersions(client) {
  try {
    const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    return rows.map((r) => r.version);
  } catch {
    return null;
  }
}

const a = new pg.Client({ connectionString: source });
const b = new pg.Client({ connectionString: target });
await a.connect();
await b.connect();
try {
  const namesA = await tableNames(a);
  const namesB = await tableNames(b);
  const problems = [];
  if (namesA.join() !== namesB.join()) problems.push(`таблицы различаются: ${namesA.length} и ${namesB.length}`);
  const countsA = await rowCounts(a, namesA);
  const countsB = await rowCounts(b, namesB);
  for (const name of namesA) {
    if (countsA[name] !== countsB[name]) problems.push(`${name}: ${countsA[name]} строк в исходной базе, ${countsB[name]} в копии`);
  }
  const versionsA = await migrationVersions(a);
  const versionsB = await migrationVersions(b);
  if (JSON.stringify(versionsA) !== JSON.stringify(versionsB)) {
    problems.push(`версии миграций различаются: ${JSON.stringify(versionsA)} и ${JSON.stringify(versionsB)}`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    const total = Object.values(countsA).reduce((s, n) => s + n, 0);
    console.log(`сверка пройдена: таблиц ${namesA.length}, строк ${total}, миграций ${versionsA?.length ?? 0}`);
  }
} finally {
  await a.end();
  await b.end();
}
