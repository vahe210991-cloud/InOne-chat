import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../scripts/verify-org-request-staging-auth.mjs');

test('controlled G2 staging authorization smoke script has valid Node syntax', () => {
  const result = spawnSync(process.execPath, ['--check', script], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
