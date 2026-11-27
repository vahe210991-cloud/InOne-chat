// Ссылки-приглашения и QR-код: создание, вступление, заявка по ссылке, лимит, срок, отзыв,
// токен не хранится и не попадает в журнал.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { createServer } from '../src/server.js';
import { storeForTest } from './helpers.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ROOM = '!club:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const EVE = '@eve:inone.test';
const enc = encodeURIComponent;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function start(options = {}) {
  const { wrapStore, ...serverOptions } = options;
  const db = await storeForTest('test-pepper-0123456789-0123456789-abcd');
  const store = db && wrapStore ? wrapStore(db.store) : db?.store;
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: 'test-pepper-0123456789-0123456789-abcd', store, ...serverOptions });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function clubWith(base) {
  const users = { alice: [ALICE, 'A_PHONE'], bob: [BOB, 'B_PHONE'], carol: [CAROL, 'C_PHONE'], dave: [DAVE, 'D_PHONE'], eve: [EVE, 'E_PHONE'] };
  const c = {};
  for (const [name, [id, device]] of Object.entries(users)) c[name] = await ChatClient.create(base, id, device, PW);
  for (const client of Object.values(c)) await client.publishKeys();
  await c.alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  return c;
}

function post(client, path, body) {
  return client.raw('POST', `/rooms/${enc(ROOM)}${path}`, body);
}

function joinByToken(client, token) {
  return client.raw('POST', '/invites/join', { token });
}

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
const pkg = (name) => Buffer.from(`KEYPACKAGE-${name}-${'x'.repeat(40)}`).toString('base64');

async function approveJoinRequestViaMls(owner, requester, targetUserId, claimId) {
  await requester.raw('POST', '/mls/key-packages', { packages: [pkg(`${targetUserId}-${claimId}`)] });
  const claim = await owner.raw('POST', `/mls/key-packages/${enc(targetUserId)}/claims`, { claimId, roomId: ROOM });
  assert.ok(claim.packages.length > 0, 'requester has uploaded a KeyPackage');
  const welcomes = claim.packages.map((item) => ({
    userId: targetUserId,
    deviceId: item.deviceId,
    welcome: b64(`WELCOME-${claimId}-${item.deviceId}`),
  }));
  const epoch = (await owner.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch;
  return owner.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
    epoch,
    commit: b64(`COMMIT-${claimId}`),
    changes: { adds: [targetUserId], removes: [] },
    welcomes,
    clientOperationId: claimId,
    keyPackageClaimId: claimId,
    joinRequestUserId: targetUserId,
  });
}

function tokenOf(invite) {
  return invite.url.split('/invite/')[1];
}

function membersOf(client) {
  return client.raw('GET', `/rooms/${enc(ROOM)}/members`);
}

test('создать ссылку может только тот, у кого есть право приглашать; ответ содержит ссылку и QR-код', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(post(c.bob, '/invites', {}), (e) => e.status === 403);
    const invite = await post(c.alice, '/invites', {});
    assert.ok(invite.url.includes('/invite/'));
    assert.ok(invite.qrSvg.includes('<svg') && invite.qrSvg.includes('</svg>'));
    assert.equal(invite.requiresApproval, false);
  } finally {
    await stop();
  }
});

test('обычная ссылка создаёт MLS-заявку; после Add Commit участник читает только новые события', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', {});
    await c.alice.sendText(ROOM, 'до вступления');
    assert.equal((await joinByToken(c.dave, tokenOf(invite))).status, 'requested');
    assert.ok(!(await membersOf(c.alice)).members.includes(DAVE));
    await approveJoinRequestViaMls(c.alice, c.dave, DAVE, 'join-approval-standard-invite-0006');
    await c.alice.sync();
    await c.dave.sync();
    await c.alice.sendText(ROOM, 'после вступления');
    await c.dave.sync();
    assert.deepEqual((await c.dave.readText(ROOM)).map((m) => m.body), ['после вступления']);
  } finally {
    await stop();
  }
});

test('ссылка с заявкой: вступление создаёт заявку, одобрение добавляет', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', { requiresApproval: true });
    assert.equal((await joinByToken(c.dave, tokenOf(invite))).status, 'requested');
    assert.equal((await joinByToken(c.dave, tokenOf(invite))).status, 'requested');
    assert.deepEqual((await c.alice.raw('GET', `/rooms/${enc(ROOM)}/requests`)).requests.map((r) => r.userId), [DAVE]);
    assert.ok(!(await membersOf(c.alice)).members.includes(DAVE));
    await assert.rejects(
      post(c.alice, `/requests/${enc(DAVE)}/approve`, {}),
      (error) => error.status === 409,
      'legacy approval without MLS Add Commit is blocked',
    );
    const approval = await approveJoinRequestViaMls(c.alice, c.dave, DAVE, 'join-approval-invite-dave-0004');
    assert.equal(approval.epoch, 2);
    assert.ok((await membersOf(c.alice)).members.includes(DAVE));
  } finally {
    await stop();
  }
});

test('ссылка с лимитом вступлений: после исчерпания вступить нельзя', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', { maxUses: 1 });
    assert.equal((await joinByToken(c.dave, tokenOf(invite))).status, 'requested');
    assert.ok(!(await membersOf(c.alice)).members.includes(DAVE));
    await assert.rejects(joinByToken(c.eve, tokenOf(invite)), (e) => e.status === 404);
  } finally {
    await stop();
  }
});

test('ссылка истекает: по умолчанию через 7 дней', async () => {
  const { srv, base, stop } = await start();
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', {});
    srv.advance(6 * DAY);
    assert.equal((await joinByToken(c.dave, tokenOf(invite))).status, 'requested');
    srv.advance(2 * DAY);
    await assert.rejects(joinByToken(c.eve, tokenOf(invite)), (e) => e.status === 404);
  } finally {
    await stop();
  }
});

test('отозванная ссылка не работает; список ссылок не показывает токен', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', {});
    await post(c.alice, `/invites/${enc(invite.inviteId)}/revoke`, {});
    await assert.rejects(joinByToken(c.dave, tokenOf(invite)), (e) => e.status === 404);
    const listed = (await c.alice.raw('GET', `/rooms/${enc(ROOM)}/invites`)).invites;
    assert.equal(listed[0].revoked, true);
    assert.ok(!JSON.stringify(listed).includes(tokenOf(invite)));
  } finally {
    await stop();
  }
});

test('неверная ссылка и уже исчерпанная выглядят одинаково; участник второй раз по ссылке не вступает', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(joinByToken(c.dave, 'неверный-токен'), (e) => e.status === 404);
    const invite = await post(c.alice, '/invites', {});
    await assert.rejects(joinByToken(c.bob, tokenOf(invite)), (e) => e.status === 409);
  } finally {
    await stop();
  }
});

test('ссылка на приватную группу создаёт MLS-заявку, но не добавляет участника сама', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(post(c.dave, '/join', {}), (e) => e.status === 404);
    const invite = await post(c.alice, '/invites', {});
    assert.equal((await joinByToken(c.dave, tokenOf(invite))).status, 'requested');
    assert.ok(!(await membersOf(c.alice)).members.includes(DAVE));
  } finally {
    await stop();
  }
});

test('токен не хранится на сервере в явном виде и не попадает в журнал запросов', async () => {
  const { srv, base, stop } = await start();
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', {});
    await joinByToken(c.dave, tokenOf(invite));
    const dump = await srv.dump();
    assert.ok(!dump.includes(tokenOf(invite)));
    const { wireLog } = JSON.parse(dump);
    assert.ok(wireLog.some((entry) => entry.includes('/invites')), 'invite request uses an allowlisted static route label');
    assert.ok(!JSON.stringify(wireLog).includes(tokenOf(invite)));
  } finally {
    await stop();
  }
});

test('QR-код строится из той же ссылки', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', {});
    assert.equal(invite.qrSvg, await QRCode.toString(invite.url, { type: 'svg', margin: 1 }));
  } finally {
    await stop();
  }
});

test('неверные параметры ссылки отклоняются', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(post(c.alice, '/invites', { expiresInHours: 0 }), (e) => e.status === 400);
    await assert.rejects(post(c.alice, '/invites', { expiresInHours: 1000 }), (e) => e.status === 400);
    await assert.rejects(post(c.alice, '/invites', { maxUses: 0 }), (e) => e.status === 400);
    await assert.rejects(post(c.alice, '/invites', { requiresApproval: 'yes' }), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('параллельные вступления по ссылке с лимитом 1: вступает ровно один', async () => {
  // Пауза после чтения ссылки расширяет окно гонки: все попытки успевают прочитать ссылку до первой записи.
  // Восемь аккаунтов с одного адреса: поднимаем только лимит регистраций.
  const slowRead = (store) => ({
    ...store,
    findInviteByTokenHash: async (...args) => {
      const found = await store.findInviteByTokenHash(...args);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return found;
    },
  });
  const { base, stop } = await start({ rateLimits: { registrationsPerAddress: [{ windowMs: 60 * 60 * 1000, limit: 100 }] }, wrapStore: slowRead });
  try {
    const c = await clubWith(base);
    const invite = await post(c.alice, '/invites', { maxUses: 1 });
    const ids = [];
    const racers = [];
    for (let i = 0; i < 8; i += 1) {
      ids.push(`@racer${i}:inone.test`);
      racers.push(await ChatClient.create(base, ids[i], `R${i}_PHONE`, PW));
    }
    const attempt = (client) => joinByToken(client, tokenOf(invite)).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, status: error.status }),
    );
    const results = await Promise.all(racers.map(attempt));
    assert.equal(results.filter((r) => r.ok).length, 1);
    const requests = (await c.alice.raw('GET', `/rooms/${enc(ROOM)}/requests`)).requests;
    assert.equal(requests.length, 1);
    assert.ok(ids.includes(requests[0].userId));
    const currentMembers = (await membersOf(c.alice)).members;
    assert.equal(ids.filter((id) => currentMembers.includes(id)).length, 0);
  } finally {
    await stop();
  }
});
