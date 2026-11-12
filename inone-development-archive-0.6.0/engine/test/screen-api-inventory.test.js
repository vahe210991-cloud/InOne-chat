import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('screen API inventory covers all approved screens and keeps unconnected calls blocked', () => {
  const run = spawnSync(process.execPath, ['scripts/audit-screen-api-contracts.mjs'], {
    cwd: new URL('../../../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.screenCount, 31);
  const byId = new Map(report.rows.map((row) => [row.screenId, row]));
  assert.ok(byId.has('SC-01'));
  assert.ok(byId.has('CH-02'));
  assert.ok(byId.has('PR-01'));

  const login = byId.get('SC-01').actions.find((item) => item.operation === 'POST /login');
  assert.equal(login?.backendHandler, 'SOURCE_CONFIRMED');
  assert.equal(login?.flutterScreenAllowlist, true);
  assert.equal(login?.callableFromScreen, true);

  const provider = byId.get('SC-05').actions.find((item) => item.operation === 'POST /auth/nonce');
  assert.equal(provider?.backendHandler, 'SOURCE_CONFIRMED');
  assert.equal(provider?.callableFromScreen, false);

  const messageSend = byId.get('CH-02').htmlActions;
  assert.ok(messageSend.some((item) => item === 'POST message'));
  assert.ok(!byId.get('CH-02').actions.some((item) => item.callableFromScreen));
  assert.ok(report.limitations.some((item) => item.includes('does not prove a live request')));
});
