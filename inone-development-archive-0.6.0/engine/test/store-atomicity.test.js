import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('organization setting and its audit row roll back together', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT max_group_members')) return { rows: [] };
      if (sql.startsWith('INSERT INTO org_settings (')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO org_settings_log')) throw new Error('simulated audit insert failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const pool = { async connect() { return client; } };
  const store = createStore({ pool, pinPepper: 'a'.repeat(48) });

  await assert.rejects(
    store.setOrgSetting({ orgId: 'org-1', field: 'channelsEnabled', value: false, actor: '@admin', at: 1 }),
    /simulated audit insert failure/,
  );
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(statements.at(-1), 'RELEASE');
});

test('organization setting rejects unknown SQL column selectors', async () => {
  const pool = { async connect() { throw new Error('transaction must not start'); } };
  const store = createStore({ pool, pinPepper: 'a'.repeat(48) });
  await assert.rejects(
    store.setOrgSetting({ orgId: 'org-1', field: 'arbitrary_column', value: 1, actor: '@admin', at: 1 }),
    /invalid organization setting field/,
  );
});
