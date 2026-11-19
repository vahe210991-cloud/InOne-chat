import assert from 'node:assert/strict';

const baseUrl = process.env.INONE_STAGING_BASE_URL?.trim();
const credentials = {
  applicant: process.env.INONE_STAGING_APPLICANT_TOKEN,
  ordinary: process.env.INONE_STAGING_ORDINARY_TOKEN,
  admin: process.env.INONE_STAGING_ADMIN_TOKEN,
  owner: process.env.INONE_STAGING_OWNER_TOKEN,
};

if (!baseUrl || !Object.values(credentials).every((value) => typeof value === 'string' && value.length >= 32)) {
  throw new Error(
    'Set INONE_STAGING_BASE_URL and all four INONE_STAGING_*_TOKEN variables; tokens are never printed.',
  );
}
const parsedBase = new URL(baseUrl);
assert.equal(parsedBase.protocol, 'https:', 'staging authorization smoke test requires HTTPS');

async function api(method, path, token, body) {
  const response = await fetch(new URL(path, parsedBase), {
    method,
    redirect: 'manual',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    // Binary or empty responses are intentionally not printed by this smoke test.
  }
  return { status: response.status, json };
}

async function requireRole(name, expected) {
  const result = await api('GET', '/profile', credentials[name]);
  assert.equal(result.status, 200, `${name} token must authenticate`);
  assert.equal(result.json?.platformRole ?? null, expected, `${name} platform role mismatch`);
}

await Promise.all([
  requireRole('applicant', null),
  requireRole('ordinary', null),
  requireRole('admin', 'admin'),
  requireRole('owner', 'owner'),
]);

const created = await api('POST', '/org-requests', credentials.applicant, {
  name: `G2 staging authorization smoke ${new Date().toISOString()}`,
});
assert.equal(created.status, 200, 'applicant must be able to create a request');
const requestId = created.json?.requestId;
assert.equal(typeof requestId, 'string', 'backend must return a request id');

const [applicantQueue, ordinaryQueue, adminQueue, ownerQueue] = await Promise.all([
  api('GET', '/org-requests', credentials.applicant),
  api('GET', '/org-requests', credentials.ordinary),
  api('GET', '/org-requests', credentials.admin),
  api('GET', '/org-requests', credentials.owner),
]);
for (const [name, result] of Object.entries({
  applicantQueue,
  ordinaryQueue,
  adminQueue,
  ownerQueue,
})) {
  assert.equal(result.status, 200, `${name} must return an authorized queue response`);
}
assert.ok(applicantQueue.json.requests.some((item) => item.requestId === requestId));
assert.ok(!ordinaryQueue.json.requests.some((item) => item.requestId === requestId));
assert.ok(adminQueue.json.requests.some((item) => item.requestId === requestId));
assert.ok(ownerQueue.json.requests.some((item) => item.requestId === requestId));

const [applicantDetail, ordinaryDetail, adminDetail, ownerDetail] = await Promise.all([
  api('GET', `/org-requests/${requestId}`, credentials.applicant),
  api('GET', `/org-requests/${requestId}`, credentials.ordinary),
  api('GET', `/org-requests/${requestId}`, credentials.admin),
  api('GET', `/org-requests/${requestId}`, credentials.owner),
]);
assert.equal(applicantDetail.status, 200);
assert.equal(ordinaryDetail.status, 404, 'ordinary user must not read another account request');
assert.equal(adminDetail.status, 200, 'admin has read-only detail access');
assert.equal(ownerDetail.status, 200, 'owner can inspect the request');

const [applicantDecision, ordinaryDecision, adminDecision] = await Promise.all([
  api('POST', `/org-requests/${requestId}/decision`, credentials.applicant, { decision: 'reject' }),
  api('POST', `/org-requests/${requestId}/decision`, credentials.ordinary, { decision: 'reject' }),
  api('POST', `/org-requests/${requestId}/decision`, credentials.admin, { decision: 'reject' }),
]);
assert.equal(applicantDecision.status, 403, 'applicant cannot decide');
assert.equal(ordinaryDecision.status, 403, 'ordinary user cannot decide');
assert.equal(adminDecision.status, 403, 'admin cannot decide');

const ownerDecision = await api(
  'POST',
  `/org-requests/${requestId}/decision`,
  credentials.owner,
  { decision: 'approve' },
);
assert.equal(ownerDecision.status, 200, 'only owner can approve the staging smoke request');
assert.equal(ownerDecision.json?.status, 'approved');

console.log(
  JSON.stringify({
    result: 'passed',
    requestId,
    checks: [
      'role identity',
      'applicant and ordinary-user queue isolation',
      'admin/owner read access',
      'cross-account detail denial',
      'applicant/ordinary/admin decision denial',
      'owner-only approval',
    ],
  }, null, 2),
);
