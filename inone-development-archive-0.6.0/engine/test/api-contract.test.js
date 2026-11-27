import { readFileSync } from 'node:fs';
import './feed-rules.test.js';
import './feed-encrypted-object-store.test.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const server = read('../src/server.js');
const manifest = JSON.parse(read('../../../мусорный ящик/HTML-архив/mobile-assets/ui-approval/screen-manifest.json'));
const nativeApp = read('../../../mobile/lib/app/inone_mobile_app.dart');
const mobileHost = read('../../../mobile/lib/main.dart');
const mobilePubspec = read('../../../mobile/pubspec.yaml');

const routeEvidence = new Map([
  ['POST /login', /req\.method === 'POST' && p === '\/login'/],
  ['POST /register/email', /req\.method === 'POST' && p === '\/register\/email'/],
  ['POST /register/email/confirm', /req\.method === 'POST' && p === '\/register\/email\/confirm'/],
  ['POST /register', /req\.method === 'POST' && p === '\/register'/],
  ['POST /auth/nonce', /req\.method === 'POST' && p === '\/auth\/nonce'/],
  ['POST /auth/provider/verify', /req\.method === 'POST' && p === '\/auth\/provider\/verify'/],
  ['POST /register/provider', /req\.method === 'POST' && p === '\/register\/provider'/],
  ['POST /recovery/start', /req\.method === 'POST' && p === '\/recovery\/start'/],
  ['POST /recovery/confirm', /req\.method === 'POST' && p === '\/recovery\/confirm'/],
  ['POST /recovery/complete', /req\.method === 'POST' && p === '\/recovery\/complete'/],
  ['POST /recovery/cancel-by-code', /req\.method === 'POST' && p === '\/recovery\/cancel-by-code'/],
  ['POST /admission/cancel', /req\.method === 'POST' && p === '\/admission\/cancel'/],
  ['POST /logout', /req\.method === 'POST' && p === '\/logout'/],
  ['GET /rooms/mine', /req\.method === 'GET' && p === '\/rooms\/mine'/],
  ['GET /rooms/:id/events', /roomRoute && req\.method === 'GET'/u],
  ['GET /orgs/mine', /req\.method === 'GET' && p === '\/orgs\/mine'/],
  ['GET /profile', /req\.method === 'GET' && p === '\/profile'/],
  ['POST /approvals/:id/claim', /const ap = p\.match/u],
  ['POST /org-requests', /req\.method === 'POST' && p === '\/org-requests'/],
  ['POST /org-requests/:id/documents', /const orgReqDocs = p\.match/u],
  ['GET /org-requests', /req\.method === 'GET' && p === '\/org-requests'/],
  ['GET /org-requests/:id', /const orgReqOne = p\.match/u],
  ['GET /org-requests/:id/documents/:docId', /const orgReqDoc = p\.match/u],
  ['POST /org-requests/:id/decision', /const orgReqDecision = p\.match/u],
  ['GET /users/search?nickname=…', /req\.method === 'GET' && p === '\/users\/search'/],
  ['GET /users/search', /req\.method === 'GET' && p === '\/users\/search'/],
  ['PUT /devices/me/push', /req\.method === 'PUT' \|\| req\.method === 'DELETE'/],
  ['DELETE /devices/me/push', /req\.method === 'PUT' \|\| req\.method === 'DELETE'/],
  ['GET /config/public', /req\.method === 'GET' && p === '\/config\/public'/],
  ['GET /config', /req\.method === 'GET' && p === '\/config'/],
]);

const declaredOperations = (value) => value
  .split(/[→·|]/u)
  .map((item) => item.trim())
  .filter((item) => /^(GET|POST|PUT|DELETE)\s+\//u.test(item));

test('every operation declared by the v0.8 approval manifest has a backend handler', () => {
  assert.equal(manifest.screens.length, 24);
  const missing = [];
  for (const screen of manifest.screens) {
    for (const operation of declaredOperations(screen.api ?? '')) {
      const evidence = routeEvidence.get(operation);
      if (!evidence || !evidence.test(server)) missing.push(`${screen.id}: ${operation}`);
    }
  }
  assert.deepEqual(missing, [], `Missing backend route evidence: ${missing.join(', ')}`);
  assert.match(server, /if \(req\.method === 'POST' && orgReqDocs\)/u);
  assert.match(server, /if \(req\.method === 'GET' && orgReqOne\)/u);
  assert.match(server, /if \(req\.method === 'GET' && orgReqDoc\)/u);
  assert.match(server, /if \(req\.method === 'POST' && orgReqDecision\)/u);
  assert.match(server, /action === 'claim'/u);
});

test('production Flutter entry uses native Dart UI and keeps MLS disabled by default', () => {
  assert.ok(mobileHost.includes('Firebase.initializeApp()'));
  assert.ok(mobileHost.includes('Platform.isAndroid || Platform.isIOS'));
  assert.ok(mobileHost.includes('runApp(InOneMobileApp(enablePush: supportsPush))'));
  assert.ok(nativeApp.includes('const _nativeMlsEnabled = bool.fromEnvironment'));
  assert.ok(nativeApp.includes('defaultValue: false'));
  assert.equal(mobilePubspec.includes('webview_flutter:'), false);
  assert.equal(mobileHost.includes('WebView'), false);
});


test('CH-02 message delivery uses MLS and rejects legacy room-event POST', () => {
  assert.ok(server.includes('const mlsMessageRoute = p.match(/^\\/mls\\/groups\\/([^/]+)\\/messages$/);'));
  assert.match(server, /mlsMessageRoute && req\.method === 'POST'/u);
  assert.match(server, /messages must be sent through \/mls\/groups\/:id\/messages/u);
  assert.match(server, /roomRoute && req\.method === 'GET'/u);
  assert.match(server, /return send\(res, 409, \{ error: 'messages must be sent through \/mls\/groups\/:id\/messages' \}\)/u);
  assert.match(server, /const mlsCommitsRoute = p\.match/u);
  assert.match(server, /const mlsAckRoute = p\.match/u);
  assert.match(server, /req\.method === 'GET' && p === '\/sync'/u);
  assert.match(server, /number\('since'\)/u);
  assert.match(server, /number\('signal_since'\)/u);
  assert.match(server, /const readRoute = p\.match/u);
  assert.match(server, /clientMessageId/u);
  assert.match(server, /epoch is outdated/u);
});

test('organization and room role gates remain backend-owned', () => {
  assert.match(server, /not_platform_owner/u);
  assert.match(server, /missing capability: invite_members/u);
  assert.match(server, /missing capability: send_messages/u);
  assert.match(server, /org_not_member/u);
  assert.match(server, /org_role_required/u);
});
