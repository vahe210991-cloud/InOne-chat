import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const packageLock = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

test('the active Beta 1.0 backend has a canonical, non-POC package identity', () => {
  assert.equal(packageJson.name, 'inone-backend');
  assert.match(packageJson.description, /canonical InOne Beta 1\.0 Node\.js backend/i);
  assert.doesNotMatch(packageJson.name, /poc|archive|temporary/i);
  assert.doesNotMatch(packageJson.description, /temporary|variant A|proof.of.concept/i);
});

test('the npm lockfile root identity matches the backend package', () => {
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.packages[''].name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
});
