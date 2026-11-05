// Безопасность миграций (пункт 6 приоритетов): каждый файл миграции отмечен в программе обновления, номера идут
// без пропусков, версия схемы совпадает с последней миграцией. Ссылки в schema.sql на старые миграции не требуются:
// это оформление файла, а не безопасность (см. migrate.test.js: новая база из схемы получает все миграции).
// Миграция без отметки тихо не применилась бы на существующих базах; эта проверка такой случай ловит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCHEMA_VERSION } from '../src/migrate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationNames = readdirSync(path.join(root, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.slice(0, -4))
  .sort();

test('каждый файл миграции отмечен в программе обновления, и отметок нет лишних', () => {
  const migrateSource = readFileSync(path.join(root, 'src', 'migrate.js'), 'utf8');
  const markers = [...migrateSource.matchAll(/^\s+'(\d{4}-[a-z0-9-]+)':/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(markers)].sort(), migrationNames, 'отметки в migrate.js совпадают с файлами миграций');
  assert.equal(markers.length, new Set(markers).size, 'ни одна отметка не повторяется');
});

test('номера миграций идут без пропусков и повторов', () => {
  const numbers = migrationNames.map((n) => Number(n.slice(0, 4)));
  assert.equal(new Set(numbers).size, numbers.length, 'номера не повторяются');
  for (let i = 1; i < numbers.length; i++) assert.equal(numbers[i], numbers[i - 1] + 1, `пропуск после ${migrationNames[i - 1]}`);
});

test('версия схемы совпадает с последней миграцией', () => {
  assert.equal(SCHEMA_VERSION, migrationNames.at(-1), 'последняя миграция — текущая версия схемы');
});
