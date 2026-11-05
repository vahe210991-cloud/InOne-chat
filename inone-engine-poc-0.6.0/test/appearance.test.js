import { randomBytes } from 'node:crypto';
// Оформление группы: описание, фон, аватар, обложка, файлы и собственные стикеры.
// Смена вида группы не удаляет файлы: они ждут замены под новый вид тем же идентификатором.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!club:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const EVE = '@eve:inone.test';
const enc = encodeURIComponent;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function clubWith(base) {
  const users = { alice: [ALICE, 'A_PHONE'], bob: [BOB, 'B_PHONE'], carol: [CAROL, 'C_PHONE'], dave: [DAVE, 'D_PHONE'], eve: [EVE, 'E_PHONE'] };
  const c = {};
  for (const [name, [id, device]] of Object.entries(users)) c[name] = await ChatClient.create(base, id, device, PW);
  for (const client of Object.values(c)) await client.publishKeys();
  await c.alice.createRoom(ROOM, [ALICE, BOB, CAROL]);
  return c;
}

const post = (client, path, body) => client.raw('POST', `/rooms/${enc(ROOM)}${path}`, body);
const get = (client, path) => client.raw('GET', `/rooms/${enc(ROOM)}${path}`);
const put = (client, path, body) => client.raw('PUT', `/rooms/${enc(ROOM)}${path}`, body);
const del = (client, path) => client.raw('DELETE', `/rooms/${enc(ROOM)}${path}`);
const grant = (owner, userId, capabilities) => post(owner, '/capabilities', { userId, capabilities });

function pngFile(marker) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(marker, 'utf8')]);
}

function plainUpload(data, kind = 'avatar', extra = {}) {
  return { kind, encrypted: false, contentType: 'image/png', dataBase64: data.toString('base64'), ...extra };
}

function encryptedUpload(data, kind = 'avatar', extra = {}) {
  return { kind, encrypted: true, contentType: 'application/octet-stream', dataBase64: data.toString('base64'), ...extra };
}

const upload = (client, body) => post(client, '/assets', body);
const makePublic = (owner) => post(owner, '/settings', { visibility: 'public' });
const makePrivate = (owner) => post(owner, '/settings', { visibility: 'private' });

test('менять оформление может тот, у кого есть право edit_group_appearance', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(post(c.bob, '/appearance', { description: 'Наш двор' }), (e) => e.status === 403);
    assert.equal((await post(c.alice, '/appearance', { description: 'Наш двор' })).description, 'Наш двор');
    await grant(c.alice, BOB, ['send_messages', 'edit_group_appearance']);
    await post(c.bob, '/appearance', { description: 'Обновили' });
    assert.equal((await get(c.carol, '/members')).appearance.description, 'Обновили');
  } finally {
    await stop();
  }
});

test('описание ограничено 500 символами; фон — только цвет #RRGGBB или сброс', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(post(c.alice, '/appearance', { description: 'я'.repeat(501) }), (e) => e.status === 400);
    await assert.rejects(post(c.alice, '/appearance', { backgroundColor: 'red' }), (e) => e.status === 400);
    assert.equal((await post(c.alice, '/appearance', { backgroundColor: '#ff8800' })).backgroundColor, '#ff8800');
    assert.equal((await post(c.alice, '/appearance', { backgroundColor: null })).backgroundColor, null);
    await assert.rejects(post(c.alice, '/appearance', {}), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('аватар публичной группы — настоящее изображение; подделка и слишком большой файл отклоняются', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice);
    const avatar = await upload(c.alice, plainUpload(pngFile('ОБЫЧНЫЙ')));
    assert.ok(avatar.assetId.startsWith('ast_'));
    await assert.rejects(upload(c.alice, { kind: 'avatar', encrypted: false, contentType: 'image/png', dataBase64: Buffer.from('это не картинка').toString('base64') }), (e) => e.status === 400);
    await assert.rejects(upload(c.alice, { kind: 'avatar', encrypted: false, contentType: 'image/jpeg', dataBase64: pngFile('X').toString('base64') }), (e) => e.status === 400);
    await assert.rejects(upload(c.alice, plainUpload(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(600 * 1024)]))), (e) => e.status === 413);
  } finally {
    await stop();
  }
});

test('в приватной группе файлы загружаются только зашифрованными, в публичной — только открытыми', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await assert.rejects(upload(c.alice, plainUpload(pngFile('ОБЫЧНЫЙ'))), (e) => e.status === 400);
    assert.ok((await upload(c.alice, encryptedUpload(Buffer.from('шифротекст-1357')))).assetId);
    await makePublic(c.alice);
    await assert.rejects(upload(c.alice, encryptedUpload(Buffer.from('x'))), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('публичная группа: файл виден постороннему; после перехода в приватную — постороннему не виден, участнику ждёт замены', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice);
    const file = await upload(c.alice, plainUpload(pngFile('ПУБЛИЧНЫЙ-ФАЙЛ')));
    assert.equal((await get(c.dave, `/assets/${enc(file.assetId)}`)).dataBase64, pngFile('ПУБЛИЧНЫЙ-ФАЙЛ').toString('base64'));
    await makePrivate(c.alice);
    await assert.rejects(get(c.dave, `/assets/${enc(file.assetId)}`), (e) => e.status === 404);
    await assert.rejects(get(c.bob, `/assets/${enc(file.assetId)}`), (e) => e.status === 409);
    const sealed = await upload(c.alice, encryptedUpload(Buffer.from('обложка-шифр-2468'), 'cover'));
    await assert.rejects(get(c.dave, `/assets/${enc(sealed.assetId)}`), (e) => e.status === 404);
    assert.equal((await get(c.bob, `/assets/${enc(sealed.assetId)}`)).dataBase64, Buffer.from('обложка-шифр-2468').toString('base64'));
  } finally {
    await stop();
  }
});

test('при переходе в приватную группу файлы остаются и ждут замены тем же идентификатором', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice);
    const avatar = await upload(c.alice, plainUpload(pngFile('ОБЫЧНЫЙ-АВАТАР')));
    await post(c.alice, '/appearance', { avatarAssetId: avatar.assetId });
    const sticker = await upload(c.alice, plainUpload(pngFile('СТИКЕР'), 'sticker', { shortcode: 'wave' }));
    assert.deepEqual((await get(c.bob, '/stickers')).stickers.map((s) => s.shortcode), ['wave']);

    await makePrivate(c.alice);
    const members = (await get(c.carol, '/members')).appearance;
    assert.equal(members.avatarAssetId, avatar.assetId, 'ссылка на аватар сохраняется');
    assert.deepEqual(members.pending, [avatar.assetId]);
    assert.deepEqual((await get(c.bob, '/stickers')).stickers.map((s) => s.shortcode), [], 'открытый стикер не отдаётся приватной группе');
    assert.deepEqual((await get(c.alice, '/assets/pending')).assets.map((a) => a.assetId).sort(), [avatar.assetId, sticker.assetId].sort());
    await assert.rejects(get(c.bob, `/assets/${enc(avatar.assetId)}`), (e) => e.status === 409);

    await assert.rejects(put(c.alice, `/assets/${enc(avatar.assetId)}`, plainUpload(pngFile('ОТКРЫТЫЙ'))), (e) => e.status === 400);
    await assert.rejects(put(c.alice, `/assets/${enc(avatar.assetId)}`, encryptedUpload(Buffer.from('x'), 'cover')), (e) => e.status === 400);
    await put(c.alice, `/assets/${enc(avatar.assetId)}`, encryptedUpload(Buffer.from('ЗАШИФРОВАНО-7788')));
    await put(c.alice, `/assets/${enc(sticker.assetId)}`, encryptedUpload(Buffer.from('СТИКЕР-ШИФР'), 'sticker', { shortcode: 'wave' }));

    const after = await get(c.bob, `/assets/${enc(avatar.assetId)}`);
    assert.equal(after.encrypted, true);
    assert.equal(after.dataBase64, Buffer.from('ЗАШИФРОВАНО-7788').toString('base64'));
    assert.deepEqual((await get(c.carol, '/members')).appearance.pending, []);
    assert.deepEqual((await get(c.bob, '/stickers')).stickers.map((s) => s.shortcode), ['wave']);
  } finally {
    await stop();
  }
});

test('при возврате в публичную группу зашифрованный файл ждёт открытой загрузки', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    const cover = await upload(c.alice, encryptedUpload(Buffer.from('ОБЛОЖКА-ШИФР'), 'cover'));
    await post(c.alice, '/appearance', { coverAssetId: cover.assetId });
    await makePublic(c.alice);
    assert.deepEqual((await get(c.carol, '/members')).appearance.pending, [cover.assetId]);
    await assert.rejects(get(c.dave, `/assets/${enc(cover.assetId)}`), (e) => e.status === 409);
    await put(c.alice, `/assets/${enc(cover.assetId)}`, plainUpload(pngFile('ОБЛОЖКА-ОТКРЫТАЯ'), 'cover'));
    assert.equal((await get(c.dave, `/assets/${enc(cover.assetId)}`)).dataBase64, pngFile('ОБЛОЖКА-ОТКРЫТАЯ').toString('base64'));
  } finally {
    await stop();
  }
});

test('аватар нельзя поставить обложкой; замена не меняет вид файла', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice);
    const avatar = await upload(c.alice, plainUpload(pngFile('ОБЫЧНЫЙ')));
    await assert.rejects(post(c.alice, '/appearance', { coverAssetId: avatar.assetId }), (e) => e.status === 400);
    const cover = await upload(c.alice, plainUpload(pngFile('ОБЛОЖКА'), 'cover'));
    await assert.rejects(put(c.alice, `/assets/${enc(cover.assetId)}`, plainUpload(pngFile('X'), 'avatar')), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('собственные стикеры: добавляет тот, у кого есть право оформления; имя уникально; число ограничено', async () => {
  const { base, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice);
    await assert.rejects(upload(c.bob, plainUpload(pngFile('S1'), 'sticker', { shortcode: 'smile' })), (e) => e.status === 403);
    const smile = await upload(c.alice, plainUpload(pngFile('S1'), 'sticker', { shortcode: 'smile' }));
    await assert.rejects(upload(c.alice, plainUpload(pngFile('S2'), 'sticker', { shortcode: 'smile' })), (e) => e.status === 409);
    await assert.rejects(upload(c.alice, plainUpload(pngFile('S3'), 'sticker', { shortcode: 'Bad Code' })), (e) => e.status === 400);
    assert.deepEqual((await get(c.bob, '/stickers')).stickers.map((s) => s.shortcode), ['smile']);
    for (let i = 0; i < 49; i += 1) {
      await upload(c.alice, plainUpload(pngFile(`S${i}`), 'sticker', { shortcode: `pack${String(i).padStart(2, '0')}` }));
    }
    await assert.rejects(upload(c.alice, plainUpload(pngFile('LAST'), 'sticker', { shortcode: 'last_one' })), (e) => e.status === 409);
    await del(c.alice, `/assets/${enc(smile.assetId)}`);
    assert.equal((await get(c.bob, '/stickers')).stickers.some((s) => s.shortcode === 'smile'), false);
  } finally {
    await stop();
  }
});

test('удалённый файл не остаётся на сервере; журнал запросов не хранит содержимое файлов', async () => {
  const { srv, base, db, stop } = await start();
  try {
    const c = await clubWith(base);
    await makePublic(c.alice);
    const secret = pngFile('СЕКРЕТНЫЙ-АВАТАР-9182');
    const avatar = await upload(c.alice, plainUpload(secret));
    const { wireLog } = JSON.parse(await srv.dump());
    assert.ok(!JSON.stringify(wireLog).includes(secret.toString('base64')));
    await del(c.alice, `/assets/${enc(avatar.assetId)}`);
    await assert.rejects(get(c.carol, `/assets/${enc(avatar.assetId)}`), (e) => e.status === 404);
    if (db) assert.equal((await db.pool.query('SELECT COUNT(*) AS n FROM group_assets')).rows[0].n, '0');
  } finally {
    await stop();
  }
});
