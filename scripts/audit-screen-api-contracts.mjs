#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('mobile/assets/ui-approval/screen-manifest.json'));
const catalog = read('mobile/lib/claude_screen_catalog.dart');
const bridge = read('mobile/lib/claude_ui_bridge.dart');
const server = read('inone-development-archive-0.6.0/engine/src/server.js');

const routeEvidence = new Map([
  ['POST /login', /req\.method === 'POST' && p === '\/login'/u],
  ['POST /register/email', /req\.method === 'POST' && p === '\/register\/email'/u],
  ['POST /register/email/confirm', /req\.method === 'POST' && p === '\/register\/email\/confirm'/u],
  ['POST /register', /req\.method === 'POST' && p === '\/register'/u],
  ['POST /auth/nonce', /req\.method === 'POST' && p === '\/auth\/nonce'/u],
  ['POST /auth/provider/verify', /req\.method === 'POST' && p === '\/auth\/provider\/verify'/u],
  ['POST /register/provider', /req\.method === 'POST' && p === '\/register\/provider'/u],
  ['POST /recovery/start', /req\.method === 'POST' && p === '\/recovery\/start'/u],
  ['POST /recovery/confirm', /req\.method === 'POST' && p === '\/recovery\/confirm'/u],
  ['POST /recovery/complete', /req\.method === 'POST' && p === '\/recovery\/complete'/u],
  ['POST /recovery/cancel-by-code', /req\.method === 'POST' && p === '\/recovery\/cancel-by-code'/u],
  ['POST /admission/cancel', /req\.method === 'POST' && p === '\/admission\/cancel'/u],
  ['POST /logout', /req\.method === 'POST' && p === '\/logout'/u],
  ['POST /direct-chats/open', /req\.method === 'POST' && p === '\/direct-chats\/open'/u],
  ['GET /contacts', /req\.method === 'GET' && p === '\/contacts'/u],
  ['POST /contacts/:userId/accept', /contactAction && req\.method === 'POST'/u],
  ['POST /contacts/:userId/block', /contactAction && req\.method === 'POST'/u],
  ['GET /rooms/mine', /req\.method === 'GET' && p === '\/rooms\/mine'/u],
  ['GET /rooms/:id/events', /roomRoute && req\.method === 'GET'/u],
  ['GET /orgs/mine', /req\.method === 'GET' && p === '\/orgs\/mine'/u],
  ['GET /profile', /req\.method === 'GET' && p === '\/profile'/u],
  ['POST /approvals/:id/claim', /const ap = p\.match/u],
  ['POST /org-requests', /req\.method === 'POST' && p === '\/org-requests'/u],
  ['POST /org-requests/:id/documents', /const orgReqDocs = p\.match/u],
  ['GET /org-requests', /req\.method === 'GET' && p === '\/org-requests'/u],
  ['GET /org-requests/:id', /const orgReqOne = p\.match/u],
  ['GET /org-requests/:id/documents/:docId', /const orgReqDoc = p\.match/u],
  ['POST /org-requests/:id/decision', /const orgReqDecision = p\.match/u],
  ['GET /users/search', /req\.method === 'GET' && p === '\/users\/search'/u],
  ['PUT /devices/me/push', /req\.method === 'PUT' \|\| req\.method === 'DELETE'/u],
  ['DELETE /devices/me/push', /req\.method === 'PUT' \|\| req\.method === 'DELETE'/u],
  ['GET /config/public', /req\.method === 'GET' && p === '\/config\/public'/u],
  ['GET /config', /req\.method === 'GET' && p === '\/config'/u],
  ['POST /rooms', /req\.method === 'POST' && p === '\/rooms'/u],
  ['GET /rooms/:id/members', /memberRoute && req\.method === 'GET'/u],
  ['POST /rooms/:id/settings', /settingsRoute && req\.method === 'POST'/u],
  ['PUT /rooms/:id/name', /nameRoute && req\.method === 'PUT'/u],
]);

const routeKeys = [...bridge.matchAll(/^\s*'((?:GET|POST|PUT|DELETE) \/[^']+)'\s*:/gmu)].map((m) => m[1]);
const screenAllowlist = new Map();
for (const m of bridge.matchAll(/^\s*'([^']+)':\s*\{([^}]+)\}/gmu)) {
  screenAllowlist.set(m[1], new Set([...m[2].matchAll(/'((?:GET|POST|PUT|DELETE) \/[^']+)'/gu)].map((x) => x[1])));
}

const sources = new Map();
for (const item of [...manifest.screens, ...(manifest.approved ?? [])]) {
  sources.set(item.id, {
    id: item.id,
    name: item.name ?? item.title ?? item.id,
    file: item.file ?? item.path,
    manifestApi: item.api ?? null,
  });
}
for (const line of catalog.split('\n').filter((value) => value.includes('ClaudeScreenSource(id:'))) {
  const m = line.match(/ClaudeScreenSource\(id:\s*'([^']+)',.*?path:\s*'([^']+)'(?:,.*?api:\s*'([^']+)')?/u);
  if (!m) continue;
  const existing = sources.get(m[1]) ?? { id: m[1], name: m[1], file: m[2], manifestApi: null };
  existing.catalogApi = m[3] ?? null;
  sources.set(m[1], existing);
}

const operationsFrom = (value) => [...String(value ?? '').matchAll(/\b(GET|POST|PUT|DELETE)\s+(\/[^\s·|→]+)/gu)]
  .map((m) => `${m[1]} ${m[2]}`);
const rows = [];
for (const source of [...sources.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  const relative = source.file?.startsWith('screens/') ? `mobile/assets/ui-approval/${source.file}` : `mobile/assets/ui-approval/${source.file ?? ''}`;
  const html = read(relative);
  const htmlActions = [...html.matchAll(/\bdata-api(?:-onload)?\s*=\s*(["'])(.*?)\1/gu)].map((m) => m[2].trim());
  const declared = [...new Set([
    ...operationsFrom(source.manifestApi),
    ...operationsFrom(source.catalogApi),
    ...htmlActions.filter((v) => /^(GET|POST|PUT|DELETE) \//u.test(v)),
  ])];
  const actions = declared.map((operation) => {
    const known = routeEvidence.get(operation);
    const backend = known?.test(server) ?? false;
    const bridgeGlobal = routeKeys.includes(operation);
    const bridgeScreen = screenAllowlist.get(source.id)?.has(operation) ?? false;
    return {
      operation,
      backendHandler: backend ? 'SOURCE_CONFIRMED' : 'NOT_FOUND_IN_ROUTE_EVIDENCE',
      flutterGlobalAllowlist: bridgeGlobal,
      flutterScreenAllowlist: bridgeScreen,
      callableFromScreen: backend && bridgeGlobal && bridgeScreen,
      status: !backend ? 'BLOCKED_BACKEND_EVIDENCE' :
        !bridgeGlobal ? 'BACKEND_ONLY_BRIDGE_MISSING' :
        !bridgeScreen ? 'BACKEND_AND_GLOBAL_BRIDGE_ONLY_SCREEN_BINDING_MISSING' :
        'SCREEN_TO_BACKEND_ROUTE_WIRED_SOURCE_LEVEL',
    };
  });
  rows.push({
    screenId: source.id,
    name: source.name,
    html: relative,
    manifestApi: source.manifestApi,
    catalogApi: source.catalogApi ?? null,
    htmlActions,
    actions,
    pickActions: [...html.matchAll(/\bdata-pick\s*=\s*(["'])(.*?)\1/gu)].map((m) => m[2]),
    navigationTargets: [...html.matchAll(/\bdata-go\s*=\s*(["'])(.*?)\1/gu)].map((m) => m[2]),
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceSha: process.env.INONE_SOURCE_SHA ?? 'UNSPECIFIED_LOCAL_CHECKOUT',
  backendSource: 'inone-development-archive-0.6.0/engine/src/server.js',
  flutterBridgeSource: 'mobile/lib/claude_ui_bridge.dart + mobile/lib/main.dart',
  screenCount: rows.length,
  actionCount: rows.reduce((n, row) => n + row.actions.length, 0),
  rows,
  limitations: [
    'SOURCE_CONFIRMED means route handler evidence exists in source; it does not prove a live request reached a running backend.',
    'Runtime receipt requires an integration/E2E run with server-side request evidence on the same source SHA.',
    'Non-HTTP HTML actions such as POST message or unresolved route descriptions are retained in htmlActions but not treated as callable API contracts.',
  ],
};
const output = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--write')) {
  writeFileSync(resolve(root, 'development/reports/generated-screen-api-inventory.json'), output);
}
process.stdout.write(output);
