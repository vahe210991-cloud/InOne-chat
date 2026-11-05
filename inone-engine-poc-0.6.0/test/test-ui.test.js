// Тестовый экран «Мои организации» (шаг 5.9): выключен по умолчанию; включён — отдаёт только свои файлы;
// логика выбора и текстов ошибок; в продакшене включить нельзя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { errorText, canSelect, selectable, ORG_ERROR_TEXT } from '../client-test-ui/org-picker.mjs';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = 'test-pepper-0123456789-0123456789-abcd';

async function serve(testUi) {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, testUi });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { base, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('тестовый экран выключен по умолчанию: файлы не отдаются', async () => {
  const s = await serve(false);
  try {
    assert.equal((await fetch(`${s.base}/test-ui/orgs.html`)).status, 404);
  } finally {
    await s.stop();
  }
});

test('тестовый экран включён: страница и логика отдаются; чужие пути — нет', async () => {
  const s = await serve(true);
  try {
    const page = await fetch(`${s.base}/test-ui/orgs.html`);
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const id of ['base-url', 'token', 'load-orgs', 'org-list', 'chosen', 'leave-org', 'error-box']) {
      assert.ok(html.includes(`id="${id}"`), `на странице есть элемент ${id}`);
    }
    const script = await fetch(`${s.base}/test-ui/org-picker.mjs`);
    assert.equal(script.status, 200);
    assert.ok((await script.text()).includes('export function errorText'));
    assert.equal((await fetch(`${s.base}/test-ui/server.js`)).status, 404, 'файлов вне списка нет');
    assert.equal((await fetch(`${s.base}/test-ui/..%2Fsrc%2Fserver.js`)).status, 404, 'обход каталога не работает');
  } finally {
    await s.stop();
  }
});

test('логика экрана: тексты ошибок по коду, выбор только одобренных', () => {
  assert.equal(errorText(403, { code: 'org_not_member' }), ORG_ERROR_TEXT.org_not_member);
  assert.equal(errorText(409, { error: 'group is full' }), 'Группа достигла лимита участников.');
  assert.equal(errorText(500, { error: 'boom' }), 'Ошибка 500: boom');
  assert.equal(errorText(500, {}), 'Ошибка 500.');
  const orgs = [{ orgId: 'a', status: 'approved' }, { orgId: 'b', status: 'pending' }, { orgId: 'c', status: 'rejected' }];
  assert.equal(canSelect(orgs[1]), false, 'ожидающую организацию выбрать нельзя');
  assert.deepEqual(selectable(orgs).map((o) => o.orgId), ['a']);
});

test('в продакшене тестовый экран включить нельзя; вне продакшена — можно', () => {
  const prod = {
    NODE_ENV: 'production',
    INONE_PIN_PEPPER: 'prod-pepper-7f3a9c1e5b2d8046a1c9e7f0b3d5a2c8',
    INONE_PUBLIC_URL: 'https://inone.example',
    INONE_REGISTRATION_MODE: 'verified',
    INONE_FILES_DIR: '/var/lib/inone/files',
    INONE_MAIL_TRANSPORT: 'smtp',
    INONE_SMTP_HOST: 'smtp.example',
    INONE_SMTP_FROM: 'no-reply@inone.example',
    INONE_DOCS_SECRET: 'docs-secret-9f2e7c1a4b8d6035e1f0a9c7b2d4e6f8',
    DATABASE_URL: 'postgresql://db.example/inone',
  };
  assert.throws(() => loadConfig({ ...prod, INONE_TEST_UI: '1' }), /INONE_TEST_UI/);
  assert.doesNotThrow(() => loadConfig({ ...prod }));
  assert.equal(loadConfig({ NODE_ENV: 'development', INONE_TEST_UI: '1', DATABASE_URL: 'postgresql://db.example/inone' }).testUi, true);
});
