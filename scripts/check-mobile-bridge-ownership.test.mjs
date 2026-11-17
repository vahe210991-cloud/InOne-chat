import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Flutter Rust bridge dependency ownership is explicit and stable', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const run = spawnSync(process.execPath, ['scripts/check-mobile-bridge-ownership.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.flutterRustBridgeCrate, 'inone_mls_frb');
  assert.equal(report.canonicalMlsClientDependency, true);
  assert.equal(report.standaloneMlsBridgeIsDependency, false);
  assert.equal(report.frbOpaqueSession, true);
  assert.equal(report.workflowCrateDir, 'rust');
  assert.equal(report.workflowCrateName, 'inone_mls_frb');
});
