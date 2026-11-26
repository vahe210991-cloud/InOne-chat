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


test('F-02: simultaneous MLS Add Commit approvals serialize group capacity', async () => {
  const s = await start();
  try {
    const carol = await ChatClient.create(s.base, '@carol-join:inone.test', 'C_PHONE', PW);
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    await s.store.addOrgMember(ORG, carol.userId, 'member', 4);
    await s.store.setOrgSetting({ orgId: ORG, field: 'maxGroupMembers', value: 2, actor: ANNA, at: 5 });

    const room = '!join-open-race:inone.test';
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Группа с лимитом', visibility: 'public', joinPolicy: 'open' })).status, 200);
    assert.equal((await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {})).json.status, 'requested');
    assert.equal((await post(s.base, carol.token, `/rooms/${enc(room)}/join`, {})).json.status, 'requested');

    const epoch = (await s.anna.raw('GET', `/mls/groups/${enc(room)}/epoch`)).epoch;
    async function prepare(requester, targetUserId, claimId) {
      await requester.raw('POST', '/mls/key-packages', { packages: [keyPackage(`${targetUserId}-${claimId}`)] });
      const claim = await s.anna.raw('POST', `/mls/key-packages/${enc(targetUserId)}/claims`, { claimId, roomId: room });
      return {
        epoch,
        clientOperationId: claimId,
        keyPackageClaimId: claimId,
        joinRequestUserId: targetUserId,
        commit: b64(`COMMIT-${claimId}`),
        changes: { adds: [targetUserId], removes: [] },
        welcomes: claim.packages.map((item) => ({
          userId: targetUserId,
          deviceId: item.deviceId,
          welcome: b64(`WELCOME-${claimId}-${item.deviceId}`),
        })),
      };
    }
    const [borisCommit, carolCommit] = await Promise.all([
      prepare(s.boris, BORIS, 'join-race-boris-0001'),
      prepare(carol, carol.userId, 'join-race-carol-0001'),
    ]);
    const route = `/mls/groups/${enc(room)}/commits`;
    const attempts = await Promise.all([
      s.anna.raw('POST', route, borisCommit).then((value) => ({ ok: true, value }), (error) => ({ ok: false, status: error.status })),
      s.anna.raw('POST', route, carolCommit).then((value) => ({ ok: true, value }), (error) => ({ ok: false, status: error.status })),
    ]);
    assert.equal(attempts.filter((result) => result.ok).length, 1, 'only one approval can consume the final room slot');
    assert.equal(attempts.filter((result) => !result.ok && result.status === 409).length, 1);
    const snapshot = await s.store.getRoom(room);
    assert.equal(snapshot.members.length, 2, 'room must never exceed its configured capacity');
    assert.equal([BORIS, carol.userId].filter((id) => snapshot.members.includes(id)).length, 1);
  } finally {
    await s.stop();
  }
});

test('F-02: a pending open join cannot be approved after organization membership is revoked', async () => {
  const s = await start();
  try {
    const room = '!join-open-auth-race:inone.test';
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Проверка доступа', visibility: 'public', joinPolicy: 'open' })).status, 200);
    assert.equal((await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {})).json.status, 'requested');

    const removed = await s.store.removeOrgMemberAtomic({
      orgId: ORG, actor: ANNA, target: BORIS, action: 'member_remove', at: 10,
    });
    assert.equal(removed.ok, true, 'organization access can be revoked while the user is only pending');
    await assert.rejects(
      approveJoinRequestViaMls(s.anna, s.boris, room, BORIS, 'org-join-after-revoke-0003'),
      (error) => error.status === 409 || error.status === 403,
      'the stale join request cannot produce an MLS Welcome after organization access is revoked',
    );
    const snapshot = await s.store.getRoom(room);
    assert.equal(snapshot.members.includes(BORIS), false);
  } finally {
    await s.stop();
  }
});

test('F-02 PostgreSQL: organization revocation cannot create MLS membership from a pending join request', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  try {
    const room = '!join-open-remove-race:inone.test';
    await s.store.addOrgMember(ORG, BORIS, 'member', 3);
    assert.equal((await post(s.base, s.anna.token, '/rooms', { roomId: room, orgId: ORG })).status, 200);
    assert.equal((await post(s.base, s.anna.token, `/rooms/${enc(room)}/settings`, { name: 'Гонка отзыва', visibility: 'public', joinPolicy: 'open' })).status, 200);
    assert.equal((await post(s.base, s.boris.token, `/rooms/${enc(room)}/join`, {})).json.status, 'requested');

    const removed = await s.store.removeOrgMemberAtomic({
      orgId: ORG, actor: ANNA, target: BORIS, action: 'member_remove', at: 11,
    });
    assert.equal(removed.ok, true);
    await assert.rejects(
      approveJoinRequestViaMls(s.anna, s.boris, room, BORIS, 'org-join-postgres-revoked-0004'),
      (error) => error.status === 409 || error.status === 403,
    );
    assert.equal((await s.store.getRoom(room)).members.includes(BORIS), false);
  } finally {
    await s.stop();
  }
});

