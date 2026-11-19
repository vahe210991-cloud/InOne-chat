import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const server = read('../src/server.js');
const repositories = read('../../../mobile/lib/core/data/inone_repositories.dart');
const session = read('../../../mobile/lib/core/session/inone_session.dart');
const apiClient = read('../../../mobile/lib/core/network/api_client.dart');
const mobileHost = read('../../../mobile/lib/app/inone_mobile_app.dart');
const mlsBridge = read('../../../mobile/lib/core/mls/rust_mls_session_bridge.dart');

const routeEvidence = new Map([
  ['GET /healthz', /req\\.method === 'GET' && p === '\\/healthz'/u],
  ['GET /readyz', /req\\.method === 'GET' && p === '\\/readyz'/u],
  ['POST /login', /req\\.method === 'POST' && p === '\\/login'/u],
  ['POST /logout', /req\\.method === 'POST' && p === '\\/logout'/u],
  ['GET /profile', /req\\.method === 'GET' && p === '\\/profile'/u],
  ['GET /orgs/mine', /req\\.method === 'GET' && p === '\\/orgs\\/mine'/u],
  ['GET /devices/mine', /req\\.method === 'GET' && p === '\\/devices\\/mine'/u],
  ['GET /org-requests', /req\\.method === 'GET' && p === '\\/org-requests'/u],
  ['GET /config/public', /req\\.method === 'GET' && p === '\\/config\\/public'/u],
  ['POST /recovery/start', /req\\.method === 'POST' && p === '\\/recovery\\/start'/u],
  ['POST /recovery/confirm', /req\\.method === 'POST' && p === '\\/recovery\\/confirm'/u],
  ['POST /recovery/complete', /req\\.method === 'POST' && p === '\\/recovery\\/complete'/u],
  ['GET /rooms/mine', /req\\.method === 'GET' && p === '\\/rooms\\/mine'/u],
  ['GET /rooms/:id/events', /roomRoute && req\\.method === 'GET'/u],
  ['POST /mls/groups/:id/messages', /mlsMessageRoute && req\\.method === 'POST'/u],
]);

test('native Beta 1 repositories use backend routes that exist', () => {
  const declared = [
    ['GET /healthz', repositories],
    ['GET /readyz', repositories],
    ['GET /profile', repositories],
    ['GET /orgs/mine', repositories],
    ['GET /devices/mine', repositories],
    ['GET /org-requests', repositories],
    ['GET /config/public', repositories],
    ['POST /login', session],
    ['POST /logout', session],
    ['POST /recovery/start', session],
    ['POST /recovery/confirm', session],
    ['POST /recovery/complete', session],
    ['GET /rooms/mine', repositories],
    ['GET /rooms/:id/events', session],
    ['POST /mls/groups/:id/messages', session],
  ];
  const missing = declared
    .filter(([operation, source]) => {
      const evidence = routeEvidence.get(operation);
      return !source.includes(operation.split(' ').at(-1)) || !evidence?.test(server);
    })
    .map(([operation]) => operation);
  assert.deepEqual(missing, [], `Missing native mobile/backend contract: ${missing.join(', ')}`);
});

test('mobile API client enforces HTTPS, same-origin paths and no redirects', () => {
  assert.match(apiClient, /HTTPS is required/u);
  assert.match(apiClient, /Absolute URLs are not allowed/u);
  assert.match(apiClient, /followRedirects = false/u);
  assert.match(apiClient, /authorization/u);
  assert.match(apiClient, /_clearRequestSecrets/u);
});

test('native MLS remains opt-in and login fails closed if Rust cannot adopt the session', () => {
  assert.match(mobileHost, /INONE_MLS_NATIVE_ENABLED/u);
  assert.match(mobileHost, /defaultValue:\\s*false/u);
  assert.match(mobileHost, /RustMlsSessionBridge\\(\\)/u);
  assert.match(session, /await adoptMlsSession\\(native\\)/u);
  assert.match(session, /Never continue with Dart-side token rotation/u);
  assert.match(session, /_refreshToken = null/u);
  assert.match(mlsBridge, /rust\\.openSession/u);
  assert.match(mlsBridge, /rust\\.resumeSession/u);
});

test('MLS messages use the native client and backend rejects legacy room-event sends', () => {
  assert.match(mlsBridge, /sendText\\(/u);
  assert.match(mlsBridge, /enqueueText\\(/u);
  assert.match(mlsBridge, /syncJson\\(/u);
  assert.match(mlsBridge, /acknowledgeIncoming\\(/u);
  assert.match(server, /mlsMessageRoute && req\\.method === 'POST'/u);
  assert.match(server, /messages must be sent through \\/mls\\/groups\\/:id\\/messages/u);
  assert.match(server, /req\\.method === 'GET' && p === '\\/sync'/u);
});

test('production mobile source has no legacy WebView or Claude bridge runtime', () => {
  const production = [mobileHost, session, repositories, apiClient, mlsBridge].join('\\n');
  assert.doesNotMatch(production, /webview_flutter|WebViewController|ClaudeApiRoute|claudeSupportedApiCalls/u);
  assert.match(mobileHost, /InOneMobileApp/u);
});
