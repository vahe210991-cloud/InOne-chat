import { createHash } from 'node:crypto';
import pg from 'pg';

const SAMPLE_LIMIT = 500;

const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * Read-only inventory of legacy reservations that have no event sequence.
 * This deliberately does not attempt to infer an event association.
 */
export async function inspectLegacyPendingClientMessages(client) {
  const countResult = await client.query(
    'SELECT count(*)::text AS pending_count FROM mls_client_messages WHERE seq IS NULL',
  );
  const pendingCount = Number(countResult.rows[0]?.pending_count ?? 0);
  if (!Number.isSafeInteger(pendingCount) || pendingCount < 0) {
    throw new Error('invalid pending reservation count returned by PostgreSQL');
  }

  const sampleResult = await client.query(
    `SELECT room_id, user_id, client_message_id
       FROM mls_client_messages
      WHERE seq IS NULL
      ORDER BY room_id, user_id, client_message_id
      LIMIT $1`,
    [SAMPLE_LIMIT],
  );

  return {
    format: 'inone.legacy-client-message-pending-audit.v1',
    mode: 'read-only',
    pendingCount,
    sampleLimit: SAMPLE_LIMIT,
    sampledCount: sampleResult.rows.length,
    truncated: pendingCount > sampleResult.rows.length,
    automaticResolution: 'none',
    resolutionStatus: 'manual-review-required',
    reason: 'Legacy pending rows have no seq and room_events has no client_message_id or reservation reference; matching an event cannot be proven from persisted data.',
    sample: sampleResult.rows.map((row) => ({
      roomKey: digest(row.room_id),
      ownerKey: digest(row.user_id),
      reservationKey: digest(`${row.room_id}\0${row.user_id}\0${row.client_message_id}`),
    })),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required; no database was contacted');
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const report = await inspectLegacyPendingClientMessages(client);
    await client.query('COMMIT');
    transactionOpen = false;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`legacy pending audit failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
