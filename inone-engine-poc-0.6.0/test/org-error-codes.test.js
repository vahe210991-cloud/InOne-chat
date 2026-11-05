// Контракт ошибок организаций (шаг 5.9): каждый код, который отдаёт сервер, описан в каталоге и в ORG_API.md,
// и наоборот — каждый код каталога реально отдаётся сервером.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORG_ERROR_CODES } from '../src/org-error-codes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(path.join(root, 'src/server.js'), 'utf8');
const apiDoc = readFileSync(path.join(root, 'ORG_API.md'), 'utf8');
const ORG_LIKE = /^(org_|last_owner$|owns_rooms$|link_|not_platform_owner$)/;

test('каждый код организаций, который отдаёт сервер, есть в каталоге и в документе', () => {
  const served = new Set([...server.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]).filter((c) => ORG_LIKE.test(c)));
  for (const code of served) {
    assert.ok(ORG_ERROR_CODES.includes(code), `код ${code} отдаётся сервером, но не описан в каталоге`);
    assert.ok(apiDoc.includes(code), `код ${code} не описан в ORG_API.md`);
  }
});

test('каждый код каталога реально отдаётся сервером', () => {
  for (const code of ORG_ERROR_CODES) {
    assert.ok(server.includes(`code: '${code}'`), `код ${code} в каталоге, но сервер его не отдаёт`);
  }
});
