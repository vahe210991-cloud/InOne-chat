import { randomBytes } from 'node:crypto';
// Единое правило доступа (шаг 5.2), входы в комнату: открытая группа, заявка и одобрение, приглашение.
// Посторонний организации не входит ни одним способом; участник организации входит.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ANNA = '@anna-join:inone.test';
const BORIS = '@boris-join:inone.test';
const ORG = 'org-join';
const enc = encodeURIComponent;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const anna = await ChatClient.create(base, ANNA, 'A_PHONE', PW);
  const boris = await ChatClient.create(base, BORIS, 'B_PHONE', PW);
  await store.createOrganization({ orgId: ORG, name: 'Тест входов', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.addOrgMember(ORG, ANNA, 'owner', 2);
  return { srv, base, store, pool: db?.pool, anna, boris, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function post(base, token, p, body) {
  const res = await fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...JSON_HEADERS }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
const keyPackage = (value) => b64(`KEYPACKAGE-${value}-${'x'.repeat(48)}`);

async function approveJoinRequestViaMls(owner, requester, roomId, targetUserId, claimId) {
  await requester.raw('POST', '/mls/key-packages', { packages: [keyPackage(`${targetUserId}-${claimId}`)] });
  const claim = await owner.raw('POST', `/mls/key-packages/${enc(targetUserId)}/claims`, { claimId, roomId });
  const epoch = (await owner.raw('GET', `/mls/groups/${enc(roomId)}/epoch`)).epoch;
  const welcomes = claim.packages.map((item) => ({
    userId: targetUserId,
    deviceId: item.deviceId,
    welcome: b64(`WELCOME-${claimId}-${item.deviceId}`),
  }));
  return owner.raw('POST', `/mls/groups/${enc(roomId)}/commits`, {
    epoch,
    commit: b64(`COMMIT-${claimId}`),
    changes: { adds: [targetUserId], removes: [] },
    welcomes,
    clientOperationId: claimId,
    keyPackageClaimId: claimId,
    joinRequestUserId: targetUserId,
  });
}

async function waitForSignal(signal, description) {
  let timeout;
  try {
    await Promise.race([
      signal,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(description)), 10000); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test('открытая группа: посторонний организации не входит; после добавления в организацию входит', async () => {
  const s = await start();
  try {
    const room = '!join-open:inone.test';
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Открытая', visibility: 'public', joinPolicy: 'open' })).status, 200);
    const outsider = await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    assert.equal(outsider.status, 403, 'посторонний организации не входит в открытую группу');
    assert.equal(outsider.json.code, 'org_not_member');
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    const joined = await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    assert.equal(joined.status, 200);
    assert.equal(joined.json.status, 'requested', 'участник организации создаёт запрос, а не меняет состав напрямую');
    assert.equal((await s.anna.raw('GET', `/rooms/${enc(room)}/members`)).members.includes(BORIS), false);
    await approveJoinRequestViaMls(s.anna, s.boris, room, BORIS, 'org-join-approval-boris-0001');
    assert.equal((await s.anna.raw('GET', `/rooms/${enc(room)}/members`)).members.includes(BORIS), true);
  } finally {
    await s.stop();
  }
});

test('legacy direct join-request approval fails closed and preserves the pending request', async () => {
  const s = await start();
  try {
    const room = '!join-approval:inone.test';
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'По заявке', visibility: 'public', joinPolicy: 'approval' })).status, 200);
    const request = await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    assert.equal(request.json.status, 'requested', 'заявка подана');
    const refused = await post(s.base, s.anna.token, `/rooms/${enc(room)}/requests/${enc(BORIS)}/approve`, {});
    assert.equal(refused.status, 409, 'legacy direct approval is disabled until an MLS Add Commit + Welcome is submitted');
    assert.equal(refused.json.code, 'mls_approval_required');
    assert.equal((await s.anna.raw('GET', `/rooms/${enc(room)}/members`)).members.includes(BORIS), false, 'direct route must not mutate membership');
    const pending = await s.anna.raw('GET', `/rooms/${enc(room)}/requests`);
    assert.ok(pending.requests.some((item) => item.userId === BORIS), 'request remains pending for native MLS approval');
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    const stillDisabled = await post(s.base, s.anna.token, `/rooms/${enc(room)}/requests/${enc(BORIS)}/approve`, {});
    assert.equal(stillDisabled.status, 409, 'organization eligibility does not re-enable unsafe direct approval');
    assert.equal(stillDisabled.json.code, 'mls_approval_required');
    assert.ok((await s.anna.raw('GET', `/rooms/${enc(room)}/requests`)).requests.some((item) => item.userId === BORIS), 'request remains pending until the MLS commit transaction');
  } finally {
    await s.stop();
  }
});

test('приглашение: вступить по нему может только участник организации', async () => {
  const s = await start();
  try {
    const room = '!join-invite:inone.test';
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    const invite = await post(s.base, s.anna.token, `/rooms/${enc(room)}/invites`, {});
    assert.equal(invite.status, 200, 'приглашение создано');
    const token = String(invite.json.url ?? '').split('/invite/')[1];
    assert.ok(token, 'у приглашения есть токен');
    const outsider = await post(s.base, s.boris.token, '/invites/join', { token });
    assert.equal(outsider.status, 403, 'посторонний организации не входит по приглашению');
    assert.equal(outsider.json.code, 'org_not_member');
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    const joined = await post(s.base, s.boris.token, '/invites/join', { token });
    assert.equal(joined.status, 200);
    assert.equal(joined.json.status, 'requested', 'участник организации создаёт заявку по ссылке');
    await approveJoinRequestViaMls(s.anna, s.boris, room, BORIS, 'org-invite-approval-boris-0002');
    assert.equal((await s.anna.raw('GET', `/rooms/${enc(room)}/members`)).members.includes(BORIS), true);
  } finally {
    await s.stop();
  }
});


test('F-02: simultaneous open joins serialize capacity and organization authorization', async () => {
  const s = await start();
  try {
    const carol = await ChatClient.create(s.base, '@carol-join:inone.test', 'C_PHONE', PW);
    const room = '!join-open-race:inone.test';
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    await s.store.addOrgMember(ORG, '@carol-join:inone.test', 'member', 4);
    await s.store.setOrgSetting({ orgId: ORG, field: 'maxGroupMembers', value: 2, actor: ANNA, at: 5 });

    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Группа с лимитом', visibility: 'public', joinPolicy: 'open' })).status, 200);

    // Force both requests to reach the atomic store operation before either is allowed to proceed.
    const atomicJoin = s.store.joinPublicRoomOpen.bind(s.store);
    let arrivals = 0;
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    s.store.joinPublicRoomOpen = async (args) => {
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
      return atomicJoin(args);
    };

    const results = await Promise.all([
      post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {}),
      post(s.base, carol.token, `/rooms/${enc(room)}/join`, {}),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort((a, b) => a - b), [200, 409]);
    assert.equal(results.filter((result) => result.json.status === 'joined').length, 1);
    assert.equal(results.filter((result) => result.json.error === 'group is full').length, 1);
    const snapshot = await s.store.getRoom(room);
    assert.equal(snapshot.members.length, 2, 'room must never exceed its configured capacity');
  } finally {
    await s.stop();
  }
});


test('F-02: open join revalidates organization membership after the route preflight', async () => {
  const s = await start();
  try {
    const room = '!join-open-auth-race:inone.test';
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Проверка доступа', visibility: 'public', joinPolicy: 'open' })).status, 200);

    // Simulate revocation after the HTTP handler has loaded the public room,
    // but immediately before the atomic store operation checks authorization.
    const atomicJoin = s.store.joinPublicRoomOpen.bind(s.store);
    let revoked = false;
    s.store.joinPublicRoomOpen = async (args) => {
      if (args.userId === BORIS && !revoked) {
        revoked = true;
        await s.store.removeOrgMember(ORG, BORIS);
      }
      return atomicJoin(args);
    };

    const denied = await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    assert.equal(denied.status, 403);
    assert.equal(denied.json.code, 'org_not_member');
    const snapshot = await s.store.getRoom(room);
    assert.equal(snapshot.members.includes(BORIS), false, 'a user whose organization membership was revoked must not be added');
  } finally {
    await s.stop();
  }
});


test('F-02 PostgreSQL: revocation waits for an in-flight open join and removes its room membership', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  let releaseJoin;
  let restorePoolHooks = () => {};
  try {
    const room = '!join-open-remove-race:inone.test';
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Гонка отзыва', visibility: 'public', joinPolicy: 'open' })).status, 200);

    const originalConnect = s.pool.connect.bind(s.pool);
    restorePoolHooks = () => { s.pool.connect = originalConnect; };
    let signalShareLock;
    let signalRevokeAttempt;
    const shareLockReady = new Promise((resolve) => { signalShareLock = resolve; });
    const revokeAttempted = new Promise((resolve) => { signalRevokeAttempt = resolve; });
    const joinGate = new Promise((resolve) => { releaseJoin = resolve; });

    // Pause the real transaction immediately after PostgreSQL grants FOR SHARE.
    // This keeps the authorization lock held until the revocation UPDATE is issued.
    s.pool.connect = async (...args) => {
      if (args.length > 0) return originalConnect(...args); // preserve node-postgres callback-style callers
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      client.query = async (query, ...params) => {
        const sql = typeof query === 'string' ? query : query?.text ?? '';
        if (sql.includes('FOR SHARE') && sql.includes('org_members')) {
          const result = await originalQuery(query, ...params);
          signalShareLock();
          await joinGate;
          return result;
        }
        if (sql.includes('FOR UPDATE') && sql.includes('org_members')) signalRevokeAttempt();
        return originalQuery(query, ...params);
      };
      return client;
    };

    const joining = post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {});
    await waitForSignal(shareLockReady, 'open join did not acquire the organization membership share lock');
    const removing = s.store.removeOrgMember(ORG, BORIS);
    await waitForSignal(revokeAttempted, 'organization revocation did not attempt its update lock');
    releaseJoin();

    const joined = await joining;
    assert.equal(joined.status, 200, 'join already holding the authorization lock may finish first');
    await removing;

    assert.equal(await s.store.orgRoleOf(ORG, BORIS), null, 'organization membership is revoked');
    const snapshot = await s.store.getRoom(room);
    assert.equal(snapshot.members.includes(BORIS), false, 'revocation must remove the membership inserted by the in-flight join');
  } finally {
    releaseJoin?.();
    restorePoolHooks();
    await s.stop();
  }
});
