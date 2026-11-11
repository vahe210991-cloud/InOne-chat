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
    assert.equal((await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: ROOM, orgId: ORG_A, members: [BORIS] })).status, 200);
    const outsider = await call(s.base, 'POST', `/rooms/${enc(ROOM)}/members`, s.anna.token, { userId: CAROL });
    assert.equal(outsider.status, 403, 'без связи участник другой организации не входит');
    assert.equal(outsider.json.code, 'org_not_member');
  } finally {
    await s.stop();
  }
});

test('связь открывается: предлагает администратор одной стороны, принимает администратор другой; принимать свою нельзя', async () => {
  const s = await start();
  try {
    assert.equal((await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: ROOM, orgId: ORG_A, members: [BORIS] })).status, 200);
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
    const added = await call(s.base, 'POST', `/rooms/${enc(ROOM)}/members`, s.anna.token, { userId: CAROL });
    assert.equal(added.status, 200, 'при активной связи участник другой стороны входит в комнату');
  } finally {
    await s.stop();
  }
});

test('отзыв связи любой стороной убирает участников другой стороны из комнат', async () => {
  const s = await start();
  try {
    assert.equal((await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: ROOM, orgId: ORG_A, members: [BORIS] })).status, 200);
    const linkId = (await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B })).json.linkId;
    await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {});
    assert.equal((await call(s.base, 'POST', `/rooms/${enc(ROOM)}/members`, s.anna.token, { userId: CAROL })).status, 200);
    const revoked = await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    assert.equal(revoked.status, 200, 'отзывает любая сторона');
    const room = await s.store.getRoom(ROOM);
    assert.ok(!room.members.includes(CAROL), 'участник другой стороны удалён из комнаты при отзыве');
    const back = await call(s.base, 'POST', `/rooms/${enc(ROOM)}/members`, s.anna.token, { userId: CAROL });
    assert.equal(back.status, 403, 'после отзыва участник другой стороны не возвращается');
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


test('F-02 PostgreSQL: cross-organization link revocation waits for an in-flight open join', { skip: !process.env.DATABASE_URL }, async () => {
  const s = await start();
  let releaseJoin;
  let restorePoolHooks = () => {};
  try {
    assert.equal((await call(s.base, 'POST', '/rooms', s.anna.token, { roomId: ROOM, orgId: ORG_A, members: [BORIS] })).status, 200);
    assert.equal((await call(s.base, 'POST', `/rooms/${enc(ROOM)}/settings`, s.anna.token, { name: 'Связь и открытый вход', visibility: 'public', joinPolicy: 'open' })).status, 200);

    const proposed = await call(s.base, 'POST', `/orgs/${ORG_A}/links`, s.boris.token, { targetOrgId: ORG_B });
    assert.equal(proposed.status, 200);
    const linkId = proposed.json.linkId;
    assert.equal((await call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/accept`, s.carol.token, {})).status, 200);

    const originalConnect = s.pool.connect.bind(s.pool);
    const originalPoolQuery = s.pool.query.bind(s.pool);
    restorePoolHooks = () => { s.pool.connect = originalConnect; s.pool.query = originalPoolQuery; };
    let signalShareLock;
    let signalRevokeAttempt;
    const shareLockReady = new Promise((resolve) => { signalShareLock = resolve; });
    const revokeAttempted = new Promise((resolve) => { signalRevokeAttempt = resolve; });
    const joinGate = new Promise((resolve) => { releaseJoin = resolve; });

    // Hold the open-join transaction immediately after it acquires the active-link share lock.
    s.pool.connect = async (...args) => {
      if (args.length > 0) return originalConnect(...args); // preserve node-postgres callback-style callers
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      client.query = async (query, ...params) => {
        const sql = typeof query === 'string' ? query : query?.text ?? '';
        if (sql.includes('FOR SHARE OF member, member_org, link')) {
          const result = await originalQuery(query, ...params);
          signalShareLock();
          await joinGate;
          return result;
        }
        return originalQuery(query, ...params);
      };
      return client;
    };
    s.pool.query = async (query, ...params) => {
      const sql = typeof query === 'string' ? query : query?.text ?? '';
      if (sql.includes('UPDATE org_links SET status')) signalRevokeAttempt();
      return originalPoolQuery(query, ...params);
    };

    const joining = call(s.base, 'POST', `/rooms/${enc(ROOM)}/join`, s.carol.token, {});
    await waitForSignal(shareLockReady, 'open join did not acquire the active-link share lock');
    const revoking = call(s.base, 'POST', `/orgs/${ORG_B}/links/${enc(linkId)}/revoke`, s.carol.token, {});
    await waitForSignal(revokeAttempted, 'link revocation did not attempt its conditional update');
    releaseJoin();

    const joined = await joining;
    assert.equal(joined.status, 200, 'join that acquired the active-link lock may finish first');
    const revoked = await revoking;
    assert.equal(revoked.status, 200, 'link revocation proceeds after the in-flight join commits');

    const finalRoom = await s.store.getRoom(ROOM);
    assert.equal(finalRoom.members.includes(CAROL), false, 'revocation must remove the cross-organization member added by the in-flight join');
    assert.equal((await s.store.getOrgLink(linkId)).status, 'revoked');
  } finally {
    releaseJoin?.();
    restorePoolHooks();
    await s.stop();
  }
});
