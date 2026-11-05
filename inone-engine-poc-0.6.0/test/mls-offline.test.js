import { randomBytes } from 'node:crypto';
// Оффлайн-доставка MLS: участник, который долго был без связи, догоняет группу по эпохам.
// Клиент идёт по эпохам: сообщения эпохи N читаются до коммита N -> N+1. Сервер отдаёт и сообщения, и коммиты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { readPrivateMessageHeader } from '../src/mls-wire.js';
import { storeForTest } from './helpers.js';
import { createIdentity, parseKeyPackage, createGroupState, addMember, joinFromWelcome, processCommit, encryptText, decryptText } from './mls-reference-client.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!offline:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const enc = encodeURIComponent;

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

/** Группа из двух участников: Алиса создала, Боб вступил (эпоха 1). Карол зарегистрирована и ждёт приглашения. */
async function setup() {
  const s = await start();
  const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
  const carol = await ChatClient.create(s.base, CAROL, 'C_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE]);
  const aliceId = await createIdentity('alice');
  const bobId = await createIdentity('bob');
  const carolId = await createIdentity('carol');
  await bob.raw('POST', '/mls/key-packages', { packages: [bobId.keyPackageB64] });
  await carol.raw('POST', '/mls/key-packages', { packages: [carolId.keyPackageB64] });
  let aliceState = await createGroupState(aliceId, ROOM);
  const addBob = await addMember(aliceState, parseKeyPackage((await alice.raw('GET', `/mls/key-packages/${enc(BOB)}`)).packages[0].package));
  await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
    epoch: 0, commit: addBob.commitB64, changes: { adds: [BOB], removes: [] },
    welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: addBob.welcomeB64 }],
  });
  aliceState = addBob.newState;
  const welcome = (await bob.raw('GET', '/mls/welcomes')).welcomes[0];
  const bobEpoch1 = await joinFromWelcome(welcome.welcome, bobId);
  await bob.raw('POST', `/mls/welcomes/${welcome.id}/ack`, {});
  return { ...s, alice, bob, aliceState, bobEpoch1 };
}

test('участник без связи догоняет группу: сообщения по эпохам и коммиты с сервера', async () => {
  const g = await setup();
  try {
    // Боб без связи: ни одного запроса от него. Алиса пишет в эпохе 1, добавляет Кэрол, пишет в эпохе 2.
    let aliceState = g.aliceState;
    const m1 = await encryptText(aliceState, 'раз'); aliceState = m1.newState;
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: m1.messageB64 });
    const m2 = await encryptText(aliceState, 'два'); aliceState = m2.newState;
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: m2.messageB64 });
    const carolPackage = (await g.alice.raw('GET', `/mls/key-packages/${enc(CAROL)}`)).packages[0];
    const addCarol = await addMember(aliceState, parseKeyPackage(carolPackage.package));
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 1, commit: addCarol.commitB64, changes: { adds: [CAROL], removes: [] },
      welcomes: [{ userId: CAROL, deviceId: 'C_PHONE', welcome: addCarol.welcomeB64 }],
    });
    aliceState = addCarol.newState;
    const m3 = await encryptText(aliceState, 'три'); aliceState = m3.newState;
    await g.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: m3.messageB64 });

    // Боб вернулся: забирает события и коммиты, которые пришли за время отсутствия.
    const events = (await g.bob.raw('GET', `/rooms/${enc(ROOM)}/events`)).events
      .filter((e) => e.type === 'm.room.encrypted' && typeof e.content?.mls === 'string');
    const commits = (await g.bob.raw('GET', `/mls/groups/${enc(ROOM)}/commits?since=1`)).commits;
    assert.equal(events.length, 3, 'все три сообщения пришли');
    assert.equal(commits.length, 1, 'коммит добавления Кэрол пришёл');

    // Клиент идёт по эпохам: сообщения эпохи N расшифровываются до коммита N -> N+1.
    const byEpoch = new Map();
    for (const ev of events) {
      const { epoch } = readPrivateMessageHeader(Buffer.from(ev.content.mls, 'base64')).value;
      byEpoch.set(epoch, [...(byEpoch.get(epoch) ?? []), ev]);
    }
    let state = g.bobEpoch1;
    let epoch = 1;
    const texts = [];
    for (;;) {
      for (const ev of byEpoch.get(epoch) ?? []) {
        const r = await decryptText(state, ev.content.mls);
        state = r.newState;
        texts.push(r.text);
      }
      const next = commits.find((c) => c.epoch === epoch + 1);
      if (!next) break;
      state = await processCommit(state, next.commit);
      epoch += 1;
    }
    assert.deepEqual(texts, ['раз', 'два', 'три'], 'все сообщения прочитаны по порядку');
    assert.equal(epoch, 2, 'Боб догнал эпоху 2');
  } finally {
    await g.stop();
  }
});
