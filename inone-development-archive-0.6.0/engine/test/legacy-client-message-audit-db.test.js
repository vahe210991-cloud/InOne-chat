import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers.js';
import { inspectLegacyPendingClientMessages } from '../scripts/audit-legacy-client-messages.mjs';

const postgresTest = process.env.DATABASE_URL ? test : test.skip;

postgresTest('PostgreSQL: legacy pending audit runs in a read-only transaction', async () => {
  const db = await testDatabase();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = await client.query('SHOW transaction_read_only');
    assert.equal(readOnly.rows[0].transaction_read_only, 'on');
    const report = await inspectLegacyPendingClientMessages(client);
    await client.query('COMMIT');
    assert.equal(report.mode, 'read-only');
    assert.equal(report.pendingCount, 0);
    assert.equal(report.sampledCount, 0);
    assert.equal(report.automaticResolution, 'none');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await db.close();
  }
});
