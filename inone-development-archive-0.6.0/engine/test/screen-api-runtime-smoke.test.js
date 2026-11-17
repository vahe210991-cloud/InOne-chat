import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = 'screen-api-smoke-pepper-0123456789-abcdef';

async function start() {
  const store = createMemoryStore({ pinPepper: PEPPER });
  const app = createServer({
    pinPepper: PEPPER,
    registrationMode: 'open',
    requirePhone: false,
    store,
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  return {
    base: `http://127.0.0.1:${app.server.address().port}`,
    stop: () => new Promise((resolve, reject) =>
      app.server.close((error) => error ? reject(error) : resolve())),
  };
}

test('screen API smoke requests reach the live HTTP server and receive route responses', async () => {
  const app = await start();
  try {
    const cases = [
      ['GET', '/config/public', 200],
      ['GET', '/config', 401],
      ['GET', '/rooms/mine', 401],
      ['GET', '/orgs/mine', 401],
      ['GET', '/profile', 401],
      ['GET', '/org-requests', 401],
      ['GET', '/users/search?nickname=probe', 401],
    ];
    for (const [method, path, expectedStatus] of cases) {
      const response = await fetch(`${app.base}${path}`, { method });
      assert.equal(
        response.status,
        expectedStatus,
        `${method} ${path} must be handled by the backend route`,
      );
      await response.arrayBuffer();
    }
  } finally {
    await app.stop();
  }
});
