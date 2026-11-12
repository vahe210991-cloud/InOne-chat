import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('screen API inventory covers all approved screens and keeps unconnected calls blocked', () => {
  const run = spawnSync(process.execPath, ['scripts/audit-screen-api-contracts.mjs'], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
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

  const roomList = byId.get('CH-01').actions.find((item) => item.operation === 'GET /rooms/mine');
  assert.equal(roomList?.backendHandler, 'SOURCE_CONFIRMED');
  assert.equal(roomList?.flutterScreenAllowlist, true);
  assert.equal(roomList?.callableFromScreen, true);

  const messageSend = byId.get('CH-02').htmlActions;
  assert.ok(messageSend.some((item) => item === 'POST message'));
  assert.ok(!byId.get('CH-02').actions.some((item) => item.callableFromScreen));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const bridgeRuntime = readFileSync(resolve(repoRoot, 'mobile/assets/ui-approval/interactions.js'), 'utf8');
  const roomScreen = readFileSync(resolve(repoRoot, 'mobile/assets/ui-approval/screens/chat/CH-01.html'), 'utf8');
  assert.match(bridgeRuntime, /screen:document\.body\.dataset\.screen/u);
  assert.match(bridgeRuntime, /data-api-onload/u);
  assert.match(roomScreen, /data-api-onload="GET \/rooms\/mine"/u);
  assert.ok(report.limitations.some((item) => item.includes('does not prove a live request')));
});
