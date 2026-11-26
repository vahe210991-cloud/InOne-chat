import { randomBytes } from 'node:crypto';
// Связи между организациями (шаг 5.6): по умолчанию закрыты; предлагает администратор одной стороны,
// принимает администратор другой; принимать свою связь нельзя; отзыв любой стороной убирает участников другой стороны из комнат.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ANNA = '@anna-link:inone.test';
const BORIS = '@boris-link:inone.test';
const CAROL = '@carol-link:inone.test';
const DAVE = '@dave-link:inone.test';
const ORG_A = 'org-link-a';
const ORG_B = 'org-link-b';
const ROOM = '!link-room:inone.test';
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
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  const dave = await ChatClient.create(base, DAVE, 'D_PHONE', PW);
  await store.createOrganization({ orgId: ORG_A, name: 'Первая', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.createOrganization({ orgId: ORG_B, name: 'Вторая', status: 'approved', createdBy: CAROL, createdAt: 2 });
  await store.addOrgMember(ORG_A, ANNA, 'owner', 3);
  await store.addOrgMember(ORG_A, BORIS, 'admin', 4);
  await store.addOrgMember(ORG_B, CAROL, 'owner', 5);
  await store.addOrgMember(ORG_B, DAVE, 'member', 6);
  return { srv, base, store, pool: db?.pool, anna, boris, carol, dave, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function call(base, method, p, token, body) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? JSON_HEADERS : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
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

test('по умолчанию организации не общаются: участник другой организации в комнату не добавляется', async () => {
  const s = await start();
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    await assert.rejects(s.anna.addMember(ROOM, CAROL), (error) => error.status === 403, 'без связи участник другой организации не входит через MLS');
  } finally {
    await s.stop();
  }
});

test('связь открывается: предлагает администратор одной стороны, принимает администратор другой; принимать свою нельзя', async () => {
  const s = await start();
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200, 'администратор первой стороны предлагает связь');
    assert.equal(proposed.json.status, 'proposed');
    const linkId = proposed.json.linkId;
    const duplicate = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(duplicate.status, 409, 'вторая связь между теми же организациями не создаётся');
    const ownSide = await call(s.base, 'POST', `/orgs/${ORG_A}/links/${enc(linkId)}/accept`, s.anna.token, {});
    assert.equal(ownSide.status, 403, 'предлагающая сторона не принимает свою связь');
    assert.equal(ownSide.json.code, 'link_own_side');
    const memberAccepts = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.dave.token, {});
    assert.equal(memberAccepts.status, 403, 'принимает только администратор другой стороны');
    const accepted = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {});
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.status, 'active');
    await s.anna.addMember(ROOM, CAROL);
    assert.ok((await s.anna.listMembers(ROOM)).members.includes(CAROL), 'при активной связи участник другой стороны входит через MLS');
  } finally {
    await s.stop();
  }
});

test('отзыв связи любой стороной убирает участников другой стороны из комнат', async () => {
  const s = await start();
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    const linkId = (await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B })).json.linkId;
    await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {});
    await s.anna.addMember(ROOM, CAROL);
    assert.equal((await s.anna.raw('POST', `/rooms/${enc(ROOM)}/owner`, { userId: CAROL })).owner, CAROL);
    const ownerBlocked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(ownerBlocked.status, 409);
    assert.equal(ownerBlocked.json.code, 'mls_removal_required');
    assert.deepEqual(ownerBlocked.json.ownerRoomIds, [ROOM], 'room ownership must be transferred before MLS removal');

    assert.equal((await s.carol.raw('POST', `/rooms/${enc(ROOM)}/owner`, { userId: ANNA })).owner, ANNA);
    const blocked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(blocked.status, 409, 'link revoke cannot bypass MLS removal');
    assert.equal(blocked.json.code, 'mls_removal_required');
    assert.deepEqual(blocked.json.ownerRoomIds, []);
    assert.ok((await s.store.getRoom(ROOM)).members.includes(CAROL), 'membership remains until an MLS Remove Commit');
    await s.anna.removeMember(ROOM, CAROL);
    const revoked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(revoked.status, 200, 'after MLS removal either organization can revoke');
    const room = await s.store.getRoom(ROOM);
    assert.ok(!room.members.includes(CAROL), 'member was removed by MLS before link revocation');
    await assert.rejects(s.anna.addMember(ROOM, CAROL), (error) => error.status === 403, 'after revocation cross-org re-add is denied');
    const again = await call(s.base, 'POST', `/orgs/${ORG_A}/links/${enc(linkId)}/revoke`, s.boris.token, {});
    assert.equal(again.status, 409, 'отозванную связь повторно не отзывают');
  } finally {
    await s.stop();
  }
});


test('F-01: stale accept after a concurrent revoke is rejected without an accept audit event', async () => {
  const s = await start();
  let releaseAccept;
  try {
    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    const linkId = proposed.json.linkId;

    const originalGet = s.store.getOrgLink.bind(s.store);
    let staleRead;
    const staleReadReady = new Promise((resolve) => { staleRead = resolve; });
    const acceptGate = new Promise((resolve) => { releaseAccept = resolve; });
    let paused = false;
    s.store.getOrgLink = async (id) => {
      const link = await originalGet(id);
      if (id === linkId && !paused) {
        paused = true;
        staleRead();
        await acceptGate;
      }
      return link;
    };

    const staleAcceptPromise = call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {});
    await staleReadReady;
    const revoked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(revoked.status, 200, 'revocation wins while accept holds a stale proposed snapshot');

    releaseAccept();
    const staleAccept = await staleAcceptPromise;
    assert.equal(staleAccept.status, 409, 'stale accept must fail its compare-and-set transition');
    assert.equal((await originalGet(linkId)).status, 'revoked');

    const acceptEventsA = (await s.store.listAdminActions(ORG_A)).filter((event) => event.action === 'link_accept' && event.detail === linkId);
    const acceptEventsB = (await s.store.listAdminActions(ORG_B)).filter((event) => event.action === 'link_accept' && event.detail === linkId);
    assert.equal(acceptEventsA.length + acceptEventsB.length, 0, 'a rejected stale accept must not emit accept audit events');
  } finally {
    releaseAccept?.();
    await s.stop();
  }
});




test('F-04 PostgreSQL: MLS Add Commit and link revocation serialize without bypassing Remove Commit', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  let releaseAdd;
  const originalConnect = s.pool.connect.bind(s.pool);
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    const linkId = proposed.json.linkId;
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {})).status, 200);

    let signalLinkShare;
    let signalRevokeAttempt;
    const linkShareReady = new Promise((resolve) => { signalLinkShare = resolve; });
    const revokeAttempted = new Promise((resolve) => { signalRevokeAttempt = resolve; });
    const addGate = new Promise((resolve) => { releaseAdd = resolve; });

    s.pool.connect = async (...args) => {
      if (args.length > 0) return originalConnect(...args);
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      client.query = async (query, ...params) => {
        const sql = typeof query === 'string' ? query : query?.text ?? '';
        if (sql.includes('SELECT org_a, org_b FROM org_links') && sql.includes('FOR UPDATE')) signalRevokeAttempt();
        if (sql.includes('SELECT link_id FROM org_links') && sql.includes('FOR SHARE')) {
          const result = await originalQuery(query, ...params);
          signalLinkShare();
          await addGate;
          return result;
        }
        return originalQuery(query, ...params);
      };
      return client;
    };

    const adding = s.anna.addMember(ROOM, CAROL);
    await waitForSignal(linkShareReady, 'MLS Add Commit did not acquire the active-link share lock');
    const revoking = call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    await waitForSignal(revokeAttempted, 'link revocation did not attempt its exclusive link lock');
    releaseAdd();

    await adding;
    const blocked = await revoking;
    assert.equal(blocked.status, 409, 'the completed Add Commit remains in the roster and blocks link revocation');
    assert.equal(blocked.json.code, 'mls_removal_required');
    assert.ok((await s.store.getRoom(ROOM)).members.includes(CAROL));

    await s.anna.removeMember(ROOM, CAROL);
    const revoked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(revoked.status, 200, 'link revocation succeeds only after MLS Remove Commit');
  } finally {
    releaseAdd?.();
    s.pool.connect = originalConnect;
    await s.stop();
  }
});

test('F-05 PostgreSQL: an in-flight room message serializes with link revocation, which remains blocked until MLS removal', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  let releaseWrite;
  const originalConnect = s.pool.connect.bind(s.pool);
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    const linkId = proposed.json.linkId;
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {})).status, 200);
    await s.anna.addMember(ROOM, CAROL);

    let signalWriteLock;
    let signalRevokeAttempt;
    const writeLockReady = new Promise((resolve) => { signalWriteLock = resolve; });
    const revokeAttempted = new Promise((resolve) => { signalRevokeAttempt = resolve; });
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    s.pool.connect = async (...args) => {
      if (args.length > 0) return originalConnect(...args);
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      client.query = async (query, ...params) => {
        const sql = typeof query === 'string' ? query : query?.text ?? '';
        if (sql.includes('SELECT org_a, org_b FROM org_links') && sql.includes('FOR UPDATE')) signalRevokeAttempt();
        return originalQuery(query, ...params);
      };
      return client;
    };

    const writing = s.store.appendRoomEvent(
      ROOM, CAROL, 'm.room.encrypted', { ciphertext: 'opaque' }, Date.now(),
      async () => { signalWriteLock(); await writeGate; },
    );
    await waitForSignal(writeLockReady, 'message write did not reach its in-transaction boundary');
    const revoking = call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    await waitForSignal(revokeAttempted, 'link revocation did not attempt its exclusive link lock');
    releaseWrite();

    const writtenSeq = await writing;
    assert.equal(typeof writtenSeq, 'number', 'message authorized before revocation commits');
    const blocked = await revoking;
    assert.equal(blocked.status, 409, 'active MLS membership prevents revocation from silently changing the roster');
    assert.equal(blocked.json.code, 'mls_removal_required');
    assert.ok((await s.store.getRoom(ROOM)).members.includes(CAROL));
    const rows = await s.store.roomEventRows(ROOM, 0);
    assert.ok(rows.some((event) => event.sender === CAROL), 'the message committed before the revoke linearization point');

    await s.anna.removeMember(ROOM, CAROL);
    const revoked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(revoked.status, 200);
    const denied = await s.store.appendRoomEvent(ROOM, CAROL, 'm.room.encrypted', { ciphertext: 'after-revoke' }, Date.now());
    assert.equal(denied.state, 'org_not_member', 'writes after revocation are rejected');
  } finally {
    releaseWrite?.();
    s.pool.connect = originalConnect;
    await s.stop();
  }
});

test('F-06 PostgreSQL: KeyPackage claim and link revocation serialize; a stale claim cannot add a member', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  let releaseClaim;
  const originalConnect = s.pool.connect.bind(s.pool);
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    const linkId = proposed.json.linkId;
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {})).status, 200);
    await s.carol.raw('POST', '/mls/key-packages', {
      packages: [Buffer.from(`KEYPACKAGE-CAROL-${'x'.repeat(48)}`, 'utf8').toString('base64')],
    });

    let signalLinkShare;
    let signalRevokeAttempt;
    const linkShareReady = new Promise((resolve) => { signalLinkShare = resolve; });
    const revokeAttempted = new Promise((resolve) => { signalRevokeAttempt = resolve; });
    const claimGate = new Promise((resolve) => { releaseClaim = resolve; });
    s.pool.connect = async (...args) => {
      const client = await originalConnect(...args);
      const originalQuery = client.query.bind(client);
      client.query = async (query, ...params) => {
        const sql = typeof query === 'string' ? query : query?.text ?? '';
        if (sql.includes('SELECT org_a, org_b FROM org_links') && sql.includes('FOR UPDATE')) signalRevokeAttempt();
        if (sql.includes('SELECT link_id FROM org_links') && sql.includes('FOR SHARE')) {
          const result = await originalQuery(query, ...params);
          signalLinkShare();
          await claimGate;
          return result;
        }
        return originalQuery(query, ...params);
      };
      return client;
    };

    const claimId = 'link-claim-carol-0001';
    const claiming = s.anna.raw('POST', `/mls/key-packages/${enc(CAROL)}/claims`, {
      claimId,
      roomId: ROOM,
    });
    await waitForSignal(linkShareReady, 'KeyPackage claim did not lock the active organization link');
    const revoking = call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    await waitForSignal(revokeAttempted, 'link revocation did not attempt its exclusive lock');
    releaseClaim();

    const claim = await claiming;
    assert.equal(claim.packages.length, 1);
    const revoked = await revoking;
    assert.equal(revoked.status, 200, 'a claim alone does not create MLS room membership');

    s.pool.connect = originalConnect;
    const beforeEpoch = (await s.anna.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch;
    await assert.rejects(
      s.anna.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
        epoch: beforeEpoch,
        clientOperationId: claimId,
        keyPackageClaimId: claimId,
        commit: Buffer.from('COMMIT-AFTER-LINK-REVOKE').toString('base64'),
        changes: { adds: [CAROL], removes: [] },
        welcomes: claim.packages.map((item) => ({
          userId: CAROL,
          deviceId: item.deviceId,
          welcome: Buffer.from(`WELCOME-${item.deviceId}`).toString('base64'),
        })),
      }),
      (error) => error.status === 403,
      'the stale KeyPackage claim cannot bypass a revoked organization link',
    );
    assert.ok(!(await s.store.getRoom(ROOM)).members.includes(CAROL));
    assert.equal((await s.anna.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch, beforeEpoch);
  } finally {
    releaseClaim?.();
    s.pool.connect = originalConnect;
    await s.stop();
  }
});

test('F-03 PostgreSQL: injected audit failure rolls back link revocation after MLS membership removal', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  const originalConnect = s.pool.connect.bind(s.pool);
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    const linkId = proposed.json.linkId;
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {})).status, 200);
    await s.anna.addMember(ROOM, CAROL);
    await s.anna.removeMember(ROOM, CAROL);

    let injected = false;
    s.pool.connect = async (...args) => {
      if (args.length > 0) return originalConnect(...args);
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      client.query = async (query, ...params) => {
        const sql = typeof query === 'string' ? query : query?.text ?? '';
        if (!injected && sql.includes('INSERT INTO admin_action_log')) {
          injected = true;
          throw new Error('fault injection: audit insert failed');
        }
        return originalQuery(query, ...params);
      };
      return client;
    };

    const failed = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(injected, true, 'fault injection reached the audit insert inside the revoke transaction');
    assert.equal(failed.status, 500, 'failed transaction returns a safe server error');

    s.pool.connect = originalConnect;
    assert.equal((await s.store.getOrgLink(linkId)).status, 'active', 'link state rolls back');
    assert.equal((await s.store.getRoom(ROOM)).members.includes(CAROL), false, 'MLS Remove Commit remains durable');
    const revokeA = (await s.store.listAdminActions(ORG_A)).filter((event) => event.action === 'link_revoke' && event.detail === linkId);
    const revokeB = (await s.store.listAdminActions(ORG_B)).filter((event) => event.action === 'link_revoke' && event.detail === linkId);
    assert.equal(revokeA.length + revokeB.length, 0, 'no partial audit event survives');

    const retried = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(retried.status, 200, 'the same revoke can be retried after rollback');
    assert.equal((await s.store.getOrgLink(linkId)).status, 'revoked');
    assert.equal((await s.store.getRoom(ROOM)).members.includes(CAROL), false);
    assert.equal((await s.store.listAdminActions(ORG_A)).filter((event) => event.action === 'link_revoke' && event.detail === linkId).length, 1);
    assert.equal((await s.store.listAdminActions(ORG_B)).filter((event) => event.action === 'link_revoke' && event.detail === linkId).length, 1);
  } finally {
    s.pool.connect = originalConnect;
    await s.stop();
  }
});

test('F-02 PostgreSQL: link revocation clears pending cross-organization join requests without adding membership', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    assert.equal((await call(s.base, 'POST', `/rooms/${enc(ROOM)}/settings`, s.anna.token, { name: 'Связь и открытый вход', visibility: 'public', joinPolicy: 'open' })).status, 200);

    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    const linkId = proposed.json.linkId;
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {})).status, 200);

    const request = await call(s.base, 'POST', `/rooms/${enc(ROOM)}/join`, s.carol.token, {});
    assert.equal(request.status, 200);
    assert.equal(request.json.status, 'requested');
    assert.equal((await s.store.getRoom(ROOM)).members.includes(CAROL), false);

    const revoked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(revoked.status, 200);
    assert.equal((await s.store.getOrgLink(linkId)).status, 'revoked');
    assert.equal((await s.store.getRoom(ROOM)).members.includes(CAROL), false);
    assert.equal((await s.anna.raw('GET', `/rooms/${enc(ROOM)}/requests`)).requests.some((item) => item.userId === CAROL), false);
  } finally {
    await s.stop();
  }
});
