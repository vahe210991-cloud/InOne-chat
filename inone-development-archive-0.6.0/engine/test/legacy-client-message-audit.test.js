import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLegacyPendingClientMessages } from '../scripts/audit-legacy-client-messages.mjs';

test('legacy pending audit reports unresolved inventory without exposing raw identifiers', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('count(*)')) return { rows: [{ pending_count: '2' }] };
      return {
        rows: [
          { room_id: '!private-room', user_id: '@alice:inone.test', client_message_id: 'secret-client-id-1' },
          { room_id: '!private-room', user_id: '@bob:inone.test', client_message_id: 'secret-client-id-2' },
        ],
      };
    },
  };

  const report = await inspectLegacyPendingClientMessages(client);

  assert.equal(report.mode, 'read-only');
  assert.equal(report.pendingCount, 2);
  assert.equal(report.sampledCount, 2);
  assert.equal(report.truncated, false);
  assert.equal(report.automaticResolution, 'none');
  assert.equal(report.resolutionStatus, 'manual-review-required');
  assert.equal(report.sample.length, 2);
  assert.ok(report.sample.every((row) => /^[a-f0-9]{16}$/.test(row.roomKey)));
  assert.ok(report.sample.every((row) => /^[a-f0-9]{16}$/.test(row.ownerKey)));
  assert.ok(report.sample.every((row) => /^[a-f0-9]{16}$/.test(row.reservationKey)));
  const serialized = JSON.stringify(report);
  for (const secret of ['!private-room', '@alice:inone.test', 'secret-client-id-1']) {
    assert.equal(serialized.includes(secret), false, 'report must not disclose raw database identifiers');
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql }) => /^\s*SELECT\b/i.test(sql)), 'audit must issue SELECT statements only');
  assert.deepEqual(calls[1].values, [500]);
});

test('legacy pending audit marks a sample as truncated without attempting recovery', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('count(*)')) return { rows: [{ pending_count: '501' }] };
      return { rows: Array.from({ length: 500 }, (_, i) => ({
        room_id: `!room-${i}`, user_id: '@user:inone.test', client_message_id: `client-${i}`,
      })) };
    },
  };

  const report = await inspectLegacyPendingClientMessages(client);
  assert.equal(report.pendingCount, 501);
  assert.equal(report.sampledCount, 500);
  assert.equal(report.truncated, true);
  assert.equal(report.automaticResolution, 'none');
});
