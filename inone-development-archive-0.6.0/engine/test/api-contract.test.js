import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const server = read('../src/server.js');
const manifest = JSON.parse(read('../../../mobile/assets/ui-approval/screen-manifest.json'));
const handoffCatalog = read('../../../mobile/lib/claude_screen_catalog.dart');
const bridge = read('../../../mobile/lib/claude_ui_bridge.dart');
const mobileHost = read('../../../mobile/lib/main.dart');

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
  ['POST /approvals/:id/claim', /const ap = p\.match/u],
  ['POST /org-requests', /req\.method === 'POST' && p === '\/org-requests'/],
  ['POST /org-requests/:id/documents', /const orgReqDocs = p\.match/u],
  ['GET /org-requests', /req\.method === 'GET' && p === '\/org-requests'/],
  ['GET /org-requests/:id', /const orgReqOne = p\.match/u],
  ['GET /org-requests/:id/documents/:docId', /const orgReqDoc = p\.match/u],
  ['POST /org-requests/:id/decision', /const orgReqDecision = p\.match/u],
  ['GET /users/search?nickname=…', /req\.method === 'GET' && p === '\/users\/search'/],
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

test('legacy Flutter handoff routes have backend handlers', () => {
  const declared = [...handoffCatalog.matchAll(/api: '((?:GET|POST|PUT|DELETE) \/[^']+)'/gu)]
    .map((match) => match[1]);
  assert.ok(declared.includes('GET /rooms/mine'));
  assert.ok(declared.includes('GET /rooms/:id/events'));
  assert.ok(declared.includes('GET /orgs/mine'));
  assert.ok(declared.includes('GET /profile'));

  assert.match(server, /req\.method === 'GET' && p === '\/rooms\/mine'/u);
  assert.ok(server.includes('const roomRoute = p.match(/^\\/rooms\\/([^/]+)\\/events$/);'));
  assert.match(server, /roomRoute && req\.method === 'GET'/u);
  assert.match(server, /roomEventRows\(roomId, since\)/u);
  assert.match(server, /req\.method === 'GET' && p === '\/orgs\/mine'/u);
  assert.match(server, /req\.method === 'GET' && p === '\/profile'/u);
});

test('CH-02 message delivery uses MLS and rejects legacy room-event POST', () => {
  assert.ok(server.includes('const mlsMessageRoute = p.match(/^\\/mls\\/groups\\/([^/]+)\\/messages$/);'));
  assert.match(server, /mlsMessageRoute && req\.method === 'POST'/u);
  assert.match(server, /messages must be sent through \/mls\/groups\/:id\/messages/u);
  assert.match(server, /const mlsCommitsRoute = p\.match/u);
  assert.match(server, /const mlsAckRoute = p\.match/u);
  assert.match(server, /clientMessageId/u);
  assert.match(server, /epoch is outdated/u);
});

test('WebView bridge does not expose arbitrary paths or a legacy message-send fallback', () => {
  assert.match(bridge, /claudeSupportedApiCalls = <String, ClaudeApiRoute>/u);
  assert.doesNotMatch(bridge, /POST \/rooms\/:id\/events/u);
  assert.doesNotMatch(bridge, /POST \/mls\/groups\/:id\/messages/u);
  assert.match(bridge, /final route = call == null \? null : claudeSupportedApiCalls\[call\]/u);
});

test('organization and room role gates remain backend-owned', () => {
  assert.match(server, /not_platform_owner/u);
  assert.match(server, /missing capability: invite_members/u);
  assert.match(server, /missing capability: send_messages/u);
  assert.match(server, /org_not_member/u);
  assert.match(server, /org_role_required/u);
});
