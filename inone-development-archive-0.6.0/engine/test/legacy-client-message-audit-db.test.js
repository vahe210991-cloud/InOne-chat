import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers.js';
import { inspectLegacyPendingClientMessages } from '../scripts/audit-legacy-client-messages.mjs';

const postgresTest = process.env.DATABASE_URL ? test : test.skip;

postgresTest('PostgreSQL: legacy pending audit runs in a read-only transaction', async () => {
  const db = await testDatabase();
  try {
    await db.pool.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const report = await inspectLegacyPendingClientMessages(db.pool);
    await db.pool.query('COMMIT');
    assert.equal(report.mode, 'read-only');
    assert.equal(report.pendingCount, 0);
    assert.equal(report.sampledCount, 0);
    assert.equal(report.automaticResolution, 'none');
  } catch (error) {
    await db.pool.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.close();
  }
});
