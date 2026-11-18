import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const server = read('../src/server.js');
const mobileContract = read('../../../mobile/API-CONTRACTS-BETA-1.md');
const mobileApp = read('../../../mobile/lib/app/inone_mobile_app.dart');
const mobileRepositories = read('../../../mobile/lib/core/data/inone_repositories.dart');

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

test('G2 organization request routes declared by the canonical mobile contract have backend handlers', () => {
  const required = [
    ['PS-01 queue', /req\\.method === 'GET' && p === '\\/org-requests'/u],
    ['PS-02 details', /const orgReqOne = p\\.match/u],
    ['PS-02 audited document access', /const orgReqDoc = p\\.match/u],
    ['PS-03 owner decision', /const orgReqDecision = p\\.match/u],
    ['profile platform role', /info\\.platformRole = await storage\\.platformRoleOf\\(d\\.userId\\)/u],
  ];
  for (const [name, evidence] of required) {
    assert.match(server, evidence, `Missing backend route evidence: ${name}`);
  }
  assert.match(mobileContract, /\\| PS-01 \\| `GET \/org-requests`/u);
  assert.match(mobileContract, /\\| PS-02 \\| `GET \/org-requests\/:id`/u);
  assert.match(mobileContract, /\\| PS-03 \\| `POST \/org-requests\/:id\/decision`/u);
});

test('native Flutter app gates platform request navigation and uses typed repositories', () => {
  assert.match(mobileApp, /canViewPlatformRequests/u);
  assert.match(mobileApp, /canDecidePlatformRequests/u);
  assert.match(mobileApp, /InOneRequestsAdminScreen/u);
  assert.match(mobileApp, /InOneRequestAdminDetailsScreen/u);
  assert.match(mobileApp, /InOneRequestDecisionScreen/u);
  assert.match(mobileRepositories, /organizationRequests\(\)/u);
  assert.match(mobileRepositories, /organizationRequest\(String requestId\)/u);
  assert.match(mobileRepositories, /decideOrganizationRequest\(/u);
  assert.doesNotMatch(mobileApp, /WebView/u);
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

test('WebView bridge does not expose arbitrary paths or a legacy message-send fallback', () => {
  assert.match(bridge, /claudeSupportedApiCalls = <String, ClaudeApiRoute>/u);
  assert.doesNotMatch(bridge, /POST \/rooms\/:id\/events/u);
  assert.doesNotMatch(bridge, /POST \/mls\/groups\/:id\/messages/u);
  assert.match(mobileHost, /final route = call == null \? null : claudeSupportedApiCalls\[call\]/u);
});

test('organization and room role gates remain backend-owned', () => {
  assert.match(server, /not_platform_owner/u);
  assert.match(server, /missing capability: invite_members/u);
  assert.match(server, /missing capability: send_messages/u);
  assert.match(server, /org_not_member/u);
  assert.match(server, /org_role_required/u);
});
