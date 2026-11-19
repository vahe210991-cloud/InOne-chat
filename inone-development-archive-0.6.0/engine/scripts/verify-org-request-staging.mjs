import { randomUUID } from 'node:crypto';

const baseUrl = process.env.INONE_STAGING_BASE_URL;
const ownerToken = process.env.INONE_STAGING_OWNER_TOKEN;
const adminToken = process.env.INONE_STAGING_ADMIN_TOKEN;
const userToken = process.env.INONE_STAGING_USER_TOKEN;
const outsiderToken = process.env.INONE_STAGING_OUTSIDER_TOKEN;

function requireValue(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required staging variable: ${name}`);
  }
  return value.trim();
}

const base = new URL(requireValue(baseUrl, 'INONE_STAGING_BASE_URL'));
if (base.protocol !== 'https:' || base.username || base.password ||
    base.search || base.hash || base.pathname !== '/') {
  throw new Error('INONE_STAGING_BASE_URL must be an HTTPS origin without credentials, path, query or fragment');
}

const tokens = {
  owner: requireValue(ownerToken, 'INONE_STAGING_OWNER_TOKEN'),
  admin: requireValue(adminToken, 'INONE_STAGING_ADMIN_TOKEN'),
  user: requireValue(userToken, 'INONE_STAGING_USER_TOKEN'),
  ...(outsiderToken ? { outsider: outsiderToken.trim() } : {}),
};

async function request(token, method, path, body) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Staging returned non-JSON for ${method} ${path} (HTTP ${response.status})`);
  }
  return { status: response.status, json };
}

function assertStatus(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${result.status}`);
  }
}

function requestIds(result, label) {
  if (!Array.isArray(result.json?.requests)) {
    throw new Error(`${label}: response has no requests array`);
  }
  return result.json.requests.map((item) => item.requestId);
}

const suffix = randomUUID();
const created = await request(tokens.user, 'POST', '/org-requests', {
  name: `G2 staging authorization ${suffix}`,
});
assertStatus(created, 200, 'user creates an organization request');
const requestId = created.json?.requestId;
if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) {
  throw new Error('Staging did not return a valid requestId');
}

for (const role of ['owner', 'admin', 'user']) {
  const queue = await request(tokens[role], 'GET', '/org-requests');
  assertStatus(queue, 200, `${role} reads request queue`);
  if (!requestIds(queue, `${role} queue`).includes(requestId)) {
    throw new Error(`${role} cannot see the newly created request`);
  }
  const detail = await request(tokens[role], 'GET', `/org-requests/${encodeURIComponent(requestId)}`);
  assertStatus(detail, 200, `${role} reads request details`);
}

for (const role of ['admin', 'user']) {
  const denied = await request(
    tokens[role],
    'POST',
    `/org-requests/${encodeURIComponent(requestId)}/decision`,
    { decision: 'reject' },
  );
  assertStatus(denied, 403, `${role} decision is forbidden`);
  if (denied.json?.code !== 'not_platform_owner') {
    throw new Error(`${role} decision did not return not_platform_owner`);
  }
}

if (tokens.outsider) {
  const outsiderQueue = await request(tokens.outsider, 'GET', '/org-requests');
  assertStatus(outsiderQueue, 200, 'outsider reads own queue');
  if (requestIds(outsiderQueue, 'outsider queue').includes(requestId)) {
    throw new Error('outsider can enumerate another applicant request');
  }
  const outsiderDetail = await request(
    tokens.outsider,
    'GET',
    `/org-requests/${encodeURIComponent(requestId)}`,
  );
  assertStatus(outsiderDetail, 404, 'outsider cannot read another applicant details');
  const outsiderDecision = await request(
    tokens.outsider,
    'POST',
    `/org-requests/${encodeURIComponent(requestId)}/decision`,
    { decision: 'reject' },
  );
  assertStatus(outsiderDecision, 403, 'outsider cannot decide a request');
}

const ownerDecision = await request(
  tokens.owner,
  'POST',
  `/org-requests/${encodeURIComponent(requestId)}/decision`,
  { decision: 'reject' },
);
assertStatus(ownerDecision, 200, 'owner rejects the staging fixture request');
if (ownerDecision.json?.status !== 'rejected') {
  throw new Error('owner decision did not persist the rejected state');
}

console.log(JSON.stringify({
  result: 'passed',
  requestId,
  testedRoles: Object.keys(tokens),
  checks: [
    'owner/admin/user queue and details access',
    'admin/user decision denied with 403',
    ...(tokens.outsider ? ['outsider queue isolation, details 404 and decision 403'] : []),
    'owner decision accepted and persisted',
  ],
}, null, 2));
