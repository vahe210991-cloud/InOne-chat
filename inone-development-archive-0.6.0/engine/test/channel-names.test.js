import { randomBytes } from 'node:crypto';
// Каналы: название уникально среди каналов (без учёта регистра и лишних пробелов). Названия групп могут повторяться.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  return { alice, bob, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

const room = (c, roomId, kind, name) => c.raw('POST', '/rooms', { roomId, ...(kind ? { kind } : {}), ...(name !== undefined ? { name } : {}) });
const rename = (c, roomId, name) => c.raw('PUT', `/rooms/${enc(roomId)}/name`, { name });

test('два канала с одинаковым названием не создаются; регистр и лишние пробелы не важны', async () => {
  const s = await start();
  try {
    await room(s.alice, '!news1:inone.test', 'channel', 'Новости');
    await assert.rejects(room(s.alice, '!news2:inone.test', 'channel', 'Новости'), (e) => e.status === 409);
    await assert.rejects(room(s.bob, '!news3:inone.test', 'channel', '  НОВОСТИ  '), (e) => e.status === 409);
  } finally {
    await s.stop();
  }
});

test('группы с одинаковым названием создаются', async () => {
  const s = await start();
  try {
    await room(s.alice, '!family1:inone.test', 'group', 'Семья');
    await room(s.bob, '!family2:inone.test', undefined, 'Семья');
  } finally {
    await s.stop();
  }
});

test('канал без названия не создаётся; название длиннее 64 символов не принимается', async () => {
  const s = await start();
  try {
    await assert.rejects(room(s.alice, '!nameless:inone.test', 'channel'), (e) => e.status === 400);
    await assert.rejects(room(s.alice, '!long:inone.test', 'channel', 'я'.repeat(65)), (e) => e.status === 400);
  } finally {
    await s.stop();
  }
});

test('переименование канала в занятое название отклоняется; в своё же — проходит; группа может взять название канала', async () => {
  const s = await start();
  try {
    await room(s.alice, '!announce:inone.test', 'channel', 'Анонс');
    await room(s.alice, '!leisure:inone.test', 'channel', 'Досуг');
    await assert.rejects(rename(s.alice, '!leisure:inone.test', 'анонс'), (e) => e.status === 409, 'занятое название канала');
    assert.equal((await rename(s.alice, '!leisure:inone.test', 'досуг')).name, 'досуг', 'своё название в другом регистре');
    await room(s.alice, '!anons-group:inone.test', 'group', 'Анонс');
    assert.equal((await rename(s.alice, '!anons-group:inone.test', 'Досуг')).name, 'Досуг', 'группа может носить название канала');
  } finally {
    await s.stop();
  }
});

test('переименовать может только владелец', async () => {
  const s = await start();
  try {
    await room(s.alice, '!owned:inone.test', 'group', 'Клуб');
    await assert.rejects(rename(s.bob, '!owned:inone.test', 'Чужой клуб'), (e) => e.status === 403);
  } finally {
    await s.stop();
  }
});
