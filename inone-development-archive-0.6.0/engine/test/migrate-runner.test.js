import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';

test('legacy migration marker discovery rolls back as one transaction on interruption', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql === 'SELECT version FROM schema_migrations') return { rows: [] };
      if (sql.includes("to_regclass('accounts')")) return { rows: [{ has_accounts: true }] };
      if (sql.startsWith('SELECT ') && sql.endsWith(' AS present')) return { rows: [{ present: true }] };
      if (sql.startsWith('INSERT INTO schema_migrations')) throw new Error('simulated marker write failure');
      return { rows: [] };
    },
    release() { statements.push('RELEASE'); },
  };
  const pool = { async connect() { return client; } };

  await assert.rejects(migrate(pool), /simulated marker write failure/);
  assert.ok(statements.includes('BEGIN'), 'marker discovery starts a transaction');
  assert.ok(statements.includes('ROLLBACK'), 'partial marker discovery is rolled back');
  assert.equal(statements.includes('COMMIT'), false, 'partial marker discovery is never committed');
  assert.equal(statements.at(-1), 'RELEASE', 'client is always released');
});
