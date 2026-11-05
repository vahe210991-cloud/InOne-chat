// Общий слой экранов (этап 0.7.0): заголовки и токен, очистка при 401, сеть, каталог ошибок,
// состояния экрана, запрет браузерного хранилища для токена.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, errorText, ERROR_TEXT } from '../client-screens/common/api.mjs';
import { STATE, idle, loading, ready, failed } from '../client-screens/common/state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSource = readFileSync(path.join(root, 'src/server.js'), 'utf8');

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { status, body, throws } = await handler(url, init);
    if (throws) throw new Error('network down');
    return { status, text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetchImpl, calls };
}

test('токен уходит в заголовке только после входа; лишние слеши в адресе убираются', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
  const api = createApi({ baseUrl: 'http://engine.test/', fetchImpl });
  await api.request('GET', '/orgs/mine');
  assert.equal(calls[0].url, 'http://engine.test/orgs/mine');
  assert.equal(calls[0].init.headers.authorization, undefined, 'до входа заголовка нет');
  api.setToken('secret-token-value');
  await api.request('GET', '/orgs/mine');
  assert.equal(calls[1].init.headers.authorization, 'Bearer secret-token-value');
});

test('токен не сохраняется в браузерном хранилище: проверка файлов экранов', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(mjs|js|html)$/.test(f)) files.push(p);
    }
  };
  walk(path.join(root, 'client-screens'));
  assert.ok(files.length >= 2, 'файлы общего слоя найдены');
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const code = text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/.test(code), `${path.basename(f)}: без браузерного хранилища`);
  }
});

test('при 401 токен очищается, показывается текст и вызывается обработчик выхода один раз', async () => {
  let signedOut = 0;
  const { fetchImpl } = fakeFetch(() => ({ status: 401, body: { error: 'unauthorized', code: 'token_expired' } }));
  const api = createApi({ baseUrl: 'http://engine.test', fetchImpl, onUnauthorized: () => { signedOut += 1; } });
  api.setToken('abc');
  const r = await api.request('GET', '/orgs/mine');
  assert.equal(r.ok, false);
  assert.equal(r.error, ERROR_TEXT.token_expired);
  assert.equal(api.hasToken(), false, 'токен сброшен');
  assert.equal(signedOut, 1, 'обработчик вызван один раз');
});

test('сеть недоступна: статус 0 и понятный текст; ответ не JSON не ломает разбор', async () => {
  const down = createApi({ baseUrl: 'http://engine.test', fetchImpl: fakeFetch(() => ({ throws: true })).fetchImpl });
  const r1 = await down.request('GET', '/x');
  assert.equal(r1.status, 0);
  assert.equal(r1.error, 'Нет связи с сервером.');
  const broken = createApi({ baseUrl: 'http://engine.test', fetchImpl: fakeFetch(() => ({ status: 500, body: '<html>oops</html>' })).fetchImpl });
  const r2 = await broken.request('GET', '/x');
  assert.equal(r2.data, null);
  assert.equal(r2.error, 'Ошибка 500.');
});

test('каталог ошибок покрывает все коды, которые отдаёт сервер', () => {
  const codes = [...new Set([...serverSource.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(codes.length >= 18, `кодов в сервере: ${codes.length}`);
  for (const code of codes) {
    assert.ok(ERROR_TEXT[code], `нет текста для кода ${code}`);
  }
});

test('тексты для 429, 503 и лимита группы', () => {
  assert.equal(errorText(429, null), 'Слишком много запросов. Подождите и попробуйте снова.');
  assert.equal(errorText(503, null), 'Сервис временно недоступен.');
  assert.equal(errorText(409, { error: 'group is full' }), 'Группа достигла лимита участников.');
});

test('состояния экрана: пусто, готово, загрузка с прежними данными, ошибка', () => {
  assert.equal(idle().status, STATE.IDLE);
  assert.equal(ready([]).status, STATE.EMPTY);
  assert.equal(ready([1]).status, STATE.READY);
  assert.deepEqual(loading(ready([1])).data, [1], 'при загрузке прежние данные остаются');
  assert.equal(failed('ошибка').status, STATE.ERROR);
});
