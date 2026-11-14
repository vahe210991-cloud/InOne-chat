import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('refresh rotation rolls back token consumption if inserting the replacement session fails', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql === 'SELECT device_key FROM refresh_tokens WHERE token_hash = $1') {
        return { rows: [{ device_key: 'user|device' }] };
      }
      if (sql === 'SELECT revoked FROM devices WHERE device_key = $1 FOR UPDATE') {
        return { rows: [{ revoked: false }] };
      }
      if (sql.startsWith('SELECT device_key, expires_at, used_at FROM refresh_tokens')) {
        return { rows: [{ device_key: 'user|device', expires_at: 9_999_999, used_at: null }] };
      }
      if (sql.startsWith('UPDATE refresh_tokens SET used_at')) return { rowCount: 1 };
      if (sql.startsWith('INSERT INTO tokens')) throw new Error('simulated replacement-token insert failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const pool = { async connect() { return client; } };
  const store = createStore({ pool, pinPepper: 'test-pepper-0123456789-0123456789-abcd' });

  await assert.rejects(
    store.rotateSession('old-refresh-token', 1000, 60_000, 86_400_000),
    /simulated replacement-token insert failure/,
  );
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.some((sql) => sql.startsWith('UPDATE refresh_tokens SET used_at')),
    'the old token is consumed inside the attempted transaction');
  assert.ok(statements.includes('ROLLBACK'),
    'failure to insert the replacement token rolls back consumption of the old token');
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(statements.at(-1), 'RELEASE');
});
