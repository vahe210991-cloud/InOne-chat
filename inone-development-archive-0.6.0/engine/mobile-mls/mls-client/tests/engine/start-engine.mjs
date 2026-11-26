// Запускает настоящий сервер движка на свободном порту для тестов клиента. Выход — по закрытию stdin.
// Команды со стандартного входа: FLAG <ключ> <значение в JSON> меняет флаг так же, как оператор; ответ — OK.
// Путь к движку: переменная INONE_ENGINE_DIR; по умолчанию — папка engine рядом с mobile-mls.
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const engineDir = path.resolve(process.env.INONE_ENGINE_DIR ?? fileURLToPath(new URL('../../../..', import.meta.url)));
const { createServer } = await import(pathToFileURL(path.join(engineDir, 'src', 'server.js')).href);
const { createMemoryStore } = await import(pathToFileURL(path.join(engineDir, 'src', 'store-memory.js')).href);
const accessMs = process.env.INONE_ACCESS_TTL_MS ? Number(process.env.INONE_ACCESS_TTL_MS) : undefined;
const PEPPER = 'test-pepper-0123456789-0123456789-abcd';
const store = createMemoryStore({ pinPepper: PEPPER });
const srv = createServer({ defaultOrgAutoJoin: true, rateLimits: { registrationsPerAddress: [{ windowMs: 60 * 60_000, limit: 1000 }, { windowMs: 24 * 60 * 60_000, limit: 10000 }] }, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, sessionTtl: accessMs ? { accessMs } : {} });
await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
console.log(`URL=http://127.0.0.1:${srv.server.address().port}`);
const hidden = new Set();
const badMetadataRooms = new Set();
const hiddenCommits = new Set();
const failNextCommitReads = new Set();
const badEventIds = new Map();
const welcomeArchive = new Map();
const replayWelcomeByDevice = new Map();
const replayWelcomeAckAttempts = new Map();
const badWelcomeRooms = new Set();
const failNextWelcomeAcks = new Set();
let replayWelcomeId = 900000000;
const originalMlsPendingWelcomes = store.mlsPendingWelcomes.bind(store);
store.mlsPendingWelcomes = (userId, deviceId) => {
  const pending = originalMlsPendingWelcomes(userId, deviceId);
  for (const welcome of pending) welcomeArchive.set(`${userId}|${deviceId}|${welcome.roomId}`, { ...structuredClone(welcome), welcome: Buffer.from(welcome.welcome) });
  const replayRoom = replayWelcomeByDevice.get(`${userId}|${deviceId}`);
  const archived = replayRoom ? welcomeArchive.get(`${userId}|${deviceId}|${replayRoom}`) : null;
  const rows = !replayRoom || !archived
    ? pending
    : [{ ...structuredClone(archived), welcome: Buffer.from(archived.welcome), id: replayWelcomeId++ }, ...pending];
  return rows.map((row) => badWelcomeRooms.has(row.roomId)
    ? { ...row, welcome: Buffer.from('not-an-MLS-Welcome') }
    : row);
};
let dropNextCommitResponse = false;
let failNextCommitBeforeApply = false;
const originalMlsApplyCommit = store.mlsApplyCommit.bind(store);
store.mlsApplyCommit = (...args) => {
  if (failNextCommitBeforeApply) {
    failNextCommitBeforeApply = false;
    throw new Error('simulated commit failure before server acceptance');
  }
  const result = originalMlsApplyCommit(...args);
  if (dropNextCommitResponse && result?.ok && !result.replayed) {
    dropNextCommitResponse = false;
    throw new Error('simulated response loss after durable commit acceptance');
  }
  return result;
};
const originalMlsAckWelcome = store.mlsAckWelcome.bind(store);
store.mlsAckWelcome = (...args) => {
  const id = Number(args[0]);
  replayWelcomeAckAttempts.set(id, (replayWelcomeAckAttempts.get(id) || 0) + 1);
  if (failNextWelcomeAcks.has(id)) {
    failNextWelcomeAcks.delete(id);
    throw new Error('simulated transient Welcome ACK failure');
  }
  return originalMlsAckWelcome(...args);
};
const originalMlsCommitsSince = store.mlsCommitsSince.bind(store);
store.mlsCommitsSince = (roomId, since, limit) => {
  if (failNextCommitReads.has(roomId)) {
    failNextCommitReads.delete(roomId);
    throw new Error('simulated transient commit read failure');
  }
  const rows = originalMlsCommitsSince(roomId, since, limit);
  if (hiddenCommits.has(roomId)) return [];
  return badMetadataRooms.has(roomId)
    ? rows.map((row) => ({ ...row, changes: { adds: [], removes: [], removeDevices: [] }, welcomeRecipients: [] }))
    : rows;
};
const origRows = store.roomEventRows.bind(store);
store.roomEventRows = async (roomId, since, limit) => {
  const rows = (await origRows(roomId, since, limit)).filter((e) => !hidden.has(e.seq));
  const mode = badEventIds.get(roomId);
  if (!mode) return rows;
  return rows.map((event) => {
    const copy = { ...event };
    if (mode === 'missing') delete copy.event_id;
    else if (mode === 'null') copy.event_id = null;
    else if (mode === 'number') copy.event_id = 42;
    else if (mode === 'empty') copy.event_id = '';
    else if (mode === 'whitespace') copy.event_id = '   ';
    return copy;
  });
};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const parts = line.trim().split(' ');
  if (parts[0] === 'FAIL_NEXT_COMMIT_BEFORE_APPLY') {
    failNextCommitBeforeApply = true;
    console.log('OK');
    return;
  }
  if (parts[0] === 'DROP_NEXT_COMMIT_RESPONSE') {
    dropNextCommitResponse = true;
    console.log('OK');
    return;
  }
  if (parts[0] === 'COMMIT_COUNT') {
    const rows = await store.mlsCommitsSince(parts[1], 0, 1000);
    console.log(String(rows.length));
    return;
  }
  if (parts[0] === 'REPLAY_WELCOME') {
    const roomId = parts[1], userId = parts[2], deviceId = parts[3];
    const archived = welcomeArchive.get(`${userId}|${deviceId}|${roomId}`);
    if (!archived) { console.log('ERR нет ранее доставленного Welcome'); return; }
    replayWelcomeByDevice.set(`${userId}|${deviceId}`, roomId);
    console.log(`OK ${replayWelcomeId}`);
    return;
  }
  if (parts[0] === 'WELCOME_ACK_ATTEMPTED') {
    console.log((replayWelcomeAckAttempts.get(Number(parts[1])) || 0) > 0 ? 'YES' : 'NO');
    return;
  }
  if (parts[0] === 'WELCOME_ACK_COUNT') {
    console.log(String(replayWelcomeAckAttempts.get(Number(parts[1])) || 0));
    return;
  }
  if (parts[0] === 'WELCOME_ID') {
    const row = originalMlsPendingWelcomes(parts[1], parts[2]).find((item) => item.roomId === parts[3]);
    console.log(row ? String(row.id) : 'NONE');
    return;
  }
  if (parts[0] === 'WELCOME_PENDING') {
    console.log(String(originalMlsPendingWelcomes(parts[1], parts[2]).length));
    return;
  }
  if (parts[0] === 'BAD_WELCOME') {
    badWelcomeRooms.add(parts[1]);
    console.log('OK');
    return;
  }
  if (parts[0] === 'FAIL_NEXT_WELCOME_ACK') {
    failNextWelcomeAcks.add(Number(parts[1]));
    console.log('OK');
    return;
  }
  if (parts[0] === 'FAIL_NEXT_COMMIT_READ') {
    failNextCommitReads.add(parts[1]);
    console.log('OK');
    return;
  }
  if (parts[0] === 'HIDE_COMMIT') {
    hiddenCommits.add(parts[1]);
    console.log('OK');
    return;
  }
  if (parts[0] === 'SHOW_COMMIT') {
    hiddenCommits.delete(parts[1]);
    console.log('OK');
    return;
  }
  if (parts[0] === 'BAD_EVENT_ID') {
    badEventIds.set(parts[1], parts[2]);
    console.log('OK');
    return;
  }
  if (parts[0] === 'GOOD_EVENT_ID') {
    badEventIds.delete(parts[1]);
    console.log('OK');
    return;
  }
  if (parts[0] === 'BADMETADATA') {
    badMetadataRooms.add(parts[1]);
    console.log('OK');
    return;
  }
  if (parts[0] === 'ADD_MEMBER' || parts[0] === 'REMOVE_MEMBER') {
    try {
      // Deliberate test-only corruption: simulate an out-of-band DB membership change
      // so the native client can prove it detects server/MLS divergence. No API route
      // or production store operation can invoke this fixture.
      const result = store.__testOnlyForceRoomMembership(parts[1], parts[2], parts[0] === 'ADD_MEMBER');
      if (result && typeof result === 'object' && result.status) throw new Error(result.status);
      console.log('OK');
    } catch (error) {
      console.log(`ERR ${error.message}`);
    }
    return;
  }
  if (parts[0] === 'HIDE') {
    const rows = await origRows(parts[1], 0);
    const last = rows.filter((e) => e.type === 'm.room.encrypted' && e.content && e.content.mls).at(-1);
    if (!last) { console.log('ERR нет сообщения для скрытия'); return; }
    hidden.add(last.seq);
    console.log(`OK ${last.seq}`);
    return;
  }
  if (parts[0] === 'SHOW') {
    hidden.clear();
    console.log('OK');
    return;
  }
  if (parts[0] === 'MAKE_ROOM_ADMIN') {
    store.setRoomAdmin(parts[1], parts[2], true);
    console.log('OK');
    return;
  }
  if (parts[0] === 'BADCOMMIT') {
    try {
      const commits = await store.mlsCommitsSince(parts[1], 0, 1000);
      const base = commits.length ? commits[commits.length - 1].epoch : 0;
      const bad = Buffer.from('это не коммит MLS').toString('base64');
      const result = await store.mlsApplyCommit(parts[1], base, {
        senderId: parts[2],
        deviceId: parts[3],
        clientOperationId: `badcommit-${base + 1}`,
        requestFingerprint: `badcommit:${base + 1}`,
        commit: bad,
        welcomes: [],
        changes: { adds: [], removes: [] },
      }, Date.now());
      if (!result?.ok) {
        console.log(`ERR ${result?.reason ?? 'commit rejected'}`);
        return;
      }
      console.log(`OK ${result.epoch}`);
    } catch (error) {
      console.log(`ERR ${error.message}`);
    }
    return;
  }
  if (parts[0] === 'BADB64') {
    try {
      const rows = await origRows(parts[1], 0);
      const last = rows.filter((e) => e.type === 'm.room.encrypted' && e.content && e.content.mls).at(-1);
      if (!last) { console.log('ERR нет отправителя'); return; }
      const seq = await store.appendRoomEvent(parts[1], last.sender, 'm.room.encrypted', { mls: '%%%не base64%%%' }, Date.now());
      console.log(`OK ${seq}`);
    } catch (error) {
      console.log(`ERR ${error.message}`);
    }
    return;
  }
  if (parts[0] === 'CORRUPT') {
    try {
      const rows = await store.roomEventRows(parts[1], 0);
      const last = rows.filter((e) => e.type === 'm.room.encrypted' && e.content && e.content.mls).at(-1);
      if (!last) { console.log('ERR нет сообщения для порчи'); return; }
      const bytes = Buffer.from(last.content.mls, 'base64');
      bytes[bytes.length - 1] ^= 0x01;
      const seq = await store.appendRoomEvent(parts[1], last.sender, 'm.room.encrypted', { ...last.content, mls: bytes.toString('base64') }, Date.now());
      console.log(`OK ${seq}`);
    } catch (error) {
      console.log(`ERR ${error.message}`);
    }
    return;
  }
  const m = /^FLAG (\S+) (.+)$/.exec(line.trim());
  if (!m) {
    console.log('ERR неизвестная команда');
    return;
  }
  try {
    await store.setFlag(m[1], JSON.parse(m[2]), 'клиентский тест', 'проверка клиента в тестах', Date.now());
    console.log('OK');
  } catch (error) {
    console.log(`ERR ${error.message}`);
  }
});
rl.on('close', () => srv.server.close(() => process.exit(0)));
