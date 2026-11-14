import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('organization setting and its audit row roll back together', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT org_id FROM organizations')) return { rows: [{ org_id: 'org-1' }], rowCount: 1 };
      if (sql.startsWith('SELECT role FROM org_members')) return { rows: [{ role: 'owner' }] };
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

test('organization approval, owner membership and decision log roll back together', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT role FROM platform_roles')) return { rows: [{ role: 'owner' }] };
      if (sql.startsWith('SELECT applicant_id, name, status')) return { rows: [{ applicant_id: '@applicant', name: 'Org', status: 'pending' }] };
      if (sql.startsWith('INSERT INTO org_request_log')) throw new Error('simulated approval audit failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const store = createStore({ pool: { async connect() { return client; } }, pinPepper: 'a'.repeat(48) });
  await assert.rejects(store.approveOrgRequest({ requestId: 'request-1', decidedBy: '@platform-owner', decidedAt: 1 }), /simulated approval audit failure/);
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(statements.at(-1), 'RELEASE');
});

test('owner role change and admin audit row roll back together', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT org_id FROM organizations')) return { rows: [{ org_id: 'org-1' }], rowCount: 1 };
      if (sql.startsWith('SELECT user_id, role FROM org_members')) return { rows: [{ user_id: '@owner', role: 'owner' }, { user_id: '@target', role: 'member' }] };
      if (sql.startsWith('INSERT INTO admin_action_log')) throw new Error('simulated role audit failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const store = createStore({ pool: { async connect() { return client; } }, pinPepper: 'a'.repeat(48) });
  await assert.rejects(store.changeOrgMemberRole({ orgId: 'org-1', userId: '@target', actorId: '@owner', role: 'admin', at: 1 }), /simulated role audit failure/);
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(statements.at(-1), 'RELEASE');
});

test('organization link proposal and both audit rows roll back together', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT role FROM org_members')) return { rows: [{ role: 'owner' }] };
      if (sql.startsWith('SELECT org_id, status FROM organizations')) return { rows: [{ org_id: 'org-a', status: 'approved' }, { org_id: 'org-b', status: 'approved' }] };
      if (sql.startsWith('INSERT INTO org_links')) return { rows: [{ link_id: 'link-1' }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO admin_action_log')) throw new Error('simulated second-side audit failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const store = createStore({ pool: { async connect() { return client; } }, pinPepper: 'a'.repeat(48) });
  await assert.rejects(store.createOrgLink({ linkId: 'link-1', proposingOrg: 'org-a', otherOrg: 'org-b', proposedBy: '@owner', createdAt: 1 }), /simulated second-side audit failure/);
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
});

test('link revocation and cross-organization membership cleanup roll back with audit failure', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT org_id FROM organizations')) return { rows: [{ org_id: 'org-a' }], rowCount: 1 };
      if (sql.startsWith('SELECT org_a, org_b, proposed_by_org, status')) return { rows: [{ org_a: 'org-a', org_b: 'org-b', proposed_by_org: 'org-a', status: 'active' }] };
      if (sql.startsWith('SELECT role FROM org_members')) return { rows: [{ role: 'owner' }] };
      if (sql.startsWith('UPDATE org_links')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO admin_action_log')) throw new Error('simulated link audit failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const store = createStore({ pool: { async connect() { return client; } }, pinPepper: 'a'.repeat(48) });
  await assert.rejects(store.transitionOrgLinkStatus({ linkId: 'link-1', orgId: 'org-a', fromStatus: 'active', status: 'revoked', decidedBy: '@owner', decidedAt: 2 }), /simulated link audit failure/);
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
});

test('member addition and its audit row roll back together', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT user_id, role FROM org_members')) return { rows: [{ user_id: '@owner', role: 'owner' }] };
      if (sql.startsWith('SELECT status FROM organizations')) return { rows: [{ status: 'approved' }] };
      if (sql.startsWith('SELECT 1 FROM accounts')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO admin_action_log')) throw new Error('simulated member audit failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const store = createStore({ pool: { async connect() { return client; } }, pinPepper: 'a'.repeat(48) });
  await assert.rejects(store.addOrgMemberWithAudit({ orgId: 'org-1', userId: '@new', role: 'member', actorId: '@owner', at: 1 }), /simulated member audit failure/);
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
});

test('member removal and its audit row roll back together', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT org_id FROM organizations')) return { rows: [{ org_id: 'org-1' }], rowCount: 1 };
      if (sql.startsWith('SELECT user_id, role FROM org_members')) return { rows: [{ user_id: '@owner', role: 'owner' }, { user_id: '@target', role: 'member' }] };
      if (sql.startsWith('SELECT COUNT(*)::int AS n FROM rooms')) return { rows: [{ n: 0 }] };
      if (sql.startsWith('INSERT INTO admin_action_log')) throw new Error('simulated member removal audit failure');
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const store = createStore({ pool: { async connect() { return client; } }, pinPepper: 'a'.repeat(48) });
  await assert.rejects(store.removeOrgMemberWithAudit({ orgId: 'org-1', userId: '@target', actorId: '@owner', at: 1 }), /simulated member removal audit failure/);
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
});

test('device revocation rolls back credentials and MLS cleanup as one transaction', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT user_id, device_id FROM devices')) {
        return { rows: [{ user_id: '@alice', device_id: 'phone-1' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO mls_device_removals')) {
        throw new Error('simulated MLS removal marker failure');
      }
      return { rows: [], rowCount: 1 };
    },
    release() { statements.push('RELEASE'); },
  };
  const store = createStore({ pool: { async connect() { return client; } }, pinPepper: 'a'.repeat(48) });
  await assert.rejects(store.revokeDevice('@alice|phone-1', 1234), /simulated MLS removal marker failure/);
  assert.ok(statements.includes('BEGIN'));
  for (const table of ['tokens', 'refresh_tokens', 'device_keys', 'one_time_keys', 'inbox', 'push_tokens', 'device_signing_keys', 'mls_key_packages', 'mls_welcomes']) {
    assert.ok(statements.some((sql) => sql.startsWith(`DELETE FROM ${table}`)), `${table} cleanup is in the transaction`);
  }
  assert.ok(statements.some((sql) => sql.startsWith('UPDATE devices SET revoked')));
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(statements.at(-1), 'RELEASE');
});
