// ============================================================================
// HTTP/API слой InOne. Постоянное хранилище передаётся через store из src/main.js.
// createMemoryStore оставлен только для тестов и локальной разработки; production запускается через main.js.
//
// Что проверяется здесь:
//  - вход по паролю; токен привязан к устройству;
//  - вход с нового устройства подтверждается кодом с существующего устройства;
//  - PIN: хранится хэшем с секретным перцем, блокируется после неверных попыток;
//  - отключение устройства: его токены и ключи перестают работать;
//  - восстановление после кражи: код на почте, задержка 48 часов,
//    отмена с любого устройства, PIN (если задан), отключение всех устройств;
//  - в беседах принимаются только зашифрованные события.
// ============================================================================
import { parseKeyPackages, parseCommitRequest, parseApplicationRequest, MLS_UNUSED_MAX } from './mls-rules.js';
import { readPrivateMessageHeader } from './mls-wire.js';
import { normalizeRoomName } from './room-names.js';
import { hashPassword, checkPassword, MIN_PASSWORD_LENGTH, newUserId } from './account-rules.js';
import { ALLOWED_CONTENT_TYPES, MAX_STICKERS_PER_GROUP, assetMatchesVisibility, assetVisibleTo, createAssetId, validateAppearance, validateAssetUpload } from './group-appearance.js';
import QRCode from 'qrcode';
import { createInviteId, createInviteToken, hashInviteToken, inviteUsable, validateInviteOptions } from './room-rules.js';
import { deleteWindowClosed, editWindowClosed, readByOthers, validateRoomSettings } from './room-rules.js';
import { MESSAGE_KINDS, effectiveCapabilities, hasCapability, normalizeCapabilities } from './room-permissions.js';
import { createFsObjectStore, createMemoryObjectStore } from './object-store.js';
import { effectiveFlags, publicFlags, validateFlag } from './flags.js';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual, createPublicKey, createVerify } from 'node:crypto';
import { createMemoryStore } from './store-memory.js';
import { LOGIN_POLICY } from './login-throttle.js';
import { windowOpen, requestCode, confirmLink, checkCode, completeRecovery, cancelWindow, issueIdentity, checkIdentity, closeWindowIfDue } from './recovery-rules.js';
import { createMemorySms } from './sms.js';
import { isPhone, requestPhoneCode, checkPhoneCode } from './phone-rules.js';
import { normalizePhone } from './phone-international.js';
import { DEFAULT_RATE_LIMITS } from './rate-limit.js';
import { normalizeEmail, isEmail, validateNickname } from './identity-rules.js';
import { requestEmailCode, checkEmailCode, useEmailToken } from './email-code-rules.js';
import { createProviderVerifier, fetchProviderKeys } from './provider-auth.js';

export const RECOVERY_DELAY_MS = 48 * 60 * 60 * 1000;
// POST, разрешённые в окне восстановления: чтение чужих ключей и отмена (право отмены проверяет маршрут, D8).
const WINDOW_POST_OK = new Set(['/keys/query', '/recovery/cancel']);
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
export const MAX_APPROVAL_CODE_ATTEMPTS = 3;
export const MAX_PENDING_APPROVALS = 3;
export const FREE_PIN_ATTEMPTS = 5;
export const TO_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // недоставленная очередь хранится не дольше 30 дней (спецификация)
const SEND_DEDUP_MS = 7 * 24 * 60 * 60 * 1000;             // повтор отправки с тем же номером считается дублем 7 дней
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

const sha = (v) => createHash('sha256').update(v).digest('hex');
const mlsCommitFingerprint = (roomId, senderId, deviceId, request) => {
  const welcomes = request.welcomes
    .map((w) => ({ userId: w.userId, deviceId: w.deviceId, welcome: w.welcome.toString('base64') }))
    .sort((a, b) => a.userId.localeCompare(b.userId) || a.deviceId.localeCompare(b.deviceId) || a.welcome.localeCompare(b.welcome));
  return sha(JSON.stringify({
    version: 1, roomId, senderId, deviceId,
    clientOperationId: request.clientOperationId,
    keyPackageClaimId: request.keyPackageClaimId,
    epoch: request.epoch,
    commit: request.commit.toString('base64'),
    changes: {
      adds: [...request.changes.adds].sort(),
      removes: [...request.changes.removes].sort(),
      removeDevices: [...request.changes.removeDevices].sort(),
    },
    welcomes,
  }));
};
/** Ключевой хэш (HMAC с секретным перцем). Без перца значение из базы не проверить и не подобрать (C-08). */
const keyedHash = (pepper, label, value) => createHmac('sha256', pepper).update(`${label}|${value}`).digest('hex');
const sameHex = (a, b) => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Длительность блокировки PIN: 1, 2, 4… минуты, не больше суток. */
export function lockDurationMs(attempt) {
  const steps = Math.max(0, attempt - FREE_PIN_ATTEMPTS);
  return Math.min(MAX_LOCK_MS, 60_000 * 2 ** Math.min(steps, 20));
}

/** Слабый PIN не принимается. Логика та же, что в основном проекте (pin-lock.service.ts). */
export function weakPinReason(pin) {
  if (!/^\d+$/.test(pin)) return 'PIN must contain digits only';
  if (pin.length < 6 || pin.length > 12) return 'PIN must be 6-12 digits';
  if (/^(\d)\1+$/.test(pin)) return 'PIN is too simple (one repeated digit)';
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) {
    return 'PIN is too simple (a straight run of digits)';
  }
  for (let size = 2; size <= pin.length / 2; size++) {
    if (pin.length % size === 0 && pin === pin.slice(0, size).repeat(pin.length / size)) {
      return 'PIN is too simple (a repeating pattern)';
    }
  }
  return null;
}





// Фиктивный хэш для неизвестных логинов: проверка занимает то же время, что и для настоящих (C-04).
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString('hex'));

// PIN: сначала HMAC с секретным перцем (он лежит в окружении, не в базе), потом scrypt.
// Так утёкшая база сама по себе не позволяет перебрать PIN.
const pepperedPin = (pepper, pin) => createHmac('sha256', pepper).update(pin).digest();
function hashPin(pepper, pin) {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}$${scryptSync(pepperedPin(pepper, pin), salt, 32).toString('base64')}`;
}
function checkPin(pepper, pin, stored) {
  const [saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(pepperedPin(pepper, pin), Buffer.from(saltB64, 'base64'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Страница подтверждения восстановления: открытие ссылки ничего не меняет, подтверждает только кнопка (POST).
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const htmlPage = (title, bodyHtml) =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body></html>`;

// Тестовый экран (шаг 5.9): только при testUi, только файлы из списка; в продакшене выключен.
const TEST_UI_FILES = {
  'orgs.html': { dir: 'client-test-ui', name: 'orgs.html', type: 'text/html; charset=utf-8' },
  'org-picker.mjs': { dir: 'client-test-ui', name: 'org-picker.mjs', type: 'text/javascript; charset=utf-8' },
  'auth/index.html': { dir: 'client-screens', name: 'auth/index.html', type: 'text/html; charset=utf-8' },
  'auth/screens.mjs': { dir: 'client-screens', name: 'auth/screens.mjs', type: 'text/javascript; charset=utf-8' },
  'auth/flow.mjs': { dir: 'client-screens', name: 'auth/flow.mjs', type: 'text/javascript; charset=utf-8' },
  'common/api.mjs': { dir: 'client-screens', name: 'common/api.mjs', type: 'text/javascript; charset=utf-8' },
  'common/state.mjs': { dir: 'client-screens', name: 'common/state.mjs', type: 'text/javascript; charset=utf-8' },
  'common/device.mjs': { dir: 'client-screens', name: 'common/device.mjs', type: 'text/javascript; charset=utf-8' },
};
export function createServer({ pinPepper, mailer: externalMailer, store, trustProxy = false, sms, requirePhone = false, registrationMode = 'verified', sessionTtl = {}, objectStore, objectSecret = randomBytes(32).toString('hex'), filesDir = null, quotaBytes = null, pushSender = null, docsSecret = null, defaultOrgAutoJoin = false, testUi = false, providers = {}, providerKeysSource = null, publicUrl = 'https://inone.test', fileBaseUrl = null, rateLimits = {}, bodyLimit = 4 * 1024 * 1024, logger = null, wireLogLimit = 2000, smsEnabled = true, phoneBlockedCountries = [], phoneAllowedCountries = [], devEmailCode = '' } = {}) {
  // Аккаунты и PIN: в базе (store.js) или в памяти по умолчанию (store-memory.js).
  const storage = store ?? createMemoryStore({ pinPepper });
  // SMS-поставщик подключается снаружи; по умолчанию сообщения складываются в список (для тестов).
  const smsSender = sms ?? createMemorySms();
  // Лимиты запросов (D5): регистрация с адреса, восстановление с адреса, SMS на один номер. Окна хранятся в базе.
  const limitTable = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  const checkRate = async (name, key) => {
    let allowed = true;
    let retryAt = null;
    for (const { windowMs, limit } of limitTable[name]) {
      const hit = await storage.rateHit(`${name}|${key}|${windowMs}`, now(), windowMs, limit);
      if (!hit.allowed) {
        allowed = false;
        retryAt = retryAt === null ? hit.retryAt : Math.max(retryAt, hit.retryAt);
      }
    }
    return { allowed, retryAt };
  };
  // Адрес источника. За обратным прокси берём адрес из X-Forwarded-For, только если сервер за прокси (D7).
  const clientIp = (req) => {
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    return forwarded || req.socket.remoteAddress || 'unknown';
  };
  if (!pinPepper || pinPepper.length < 32) {
    // Без перца сервер не запускается: иначе PIN легко перебрать после утечки базы.
    throw new Error('PIN_PEPPER обязателен и не короче 32 символов');
  }

  let offset = 0;                                  // сдвиг часов для тестов
  // Правило App Store 4.8: если предложен вход через Google, обязателен и Sign in with Apple.
  if (providers.google?.clientIds?.length && !providers.apple?.clientIds?.length) {
    throw new Error('Sign in with Apple must be enabled together with Google sign-in (App Store guideline 4.8)');
  }
  const verifyProviderToken = createProviderVerifier({
    providers,
    keysSource: providerKeysSource ?? fetchProviderKeys,
    nowMs: () => now(),
  });
  const now = () => Date.now() + offset;

  const outbox = [];               // письма (в продакшене — почтовый сервис)
  const wireLog = [];              // что пришло на сервер, с замазанными секретами
  let pinChecks = 0;               // сколько раз реально проверяли PIN (для теста перебора)

  const key = (u, d) => `${u}|${d}`;
  const send = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end(JSON.stringify(obj));
  };
  // Устройства лежат в хранилище. Сервер не знает, с каким устройством какой собеседник общается,
  // поэтому сообщает всем активным устройствам, что список устройств изменился.
  const markChanged = async (userId) => {
    for (const rec of await storage.activeDevices()) {
      await storage.enqueue(key(rec.userId, rec.deviceId), 'device_list', { userId }, userId, now() + TO_DEVICE_TTL_MS);
    }
  };
  const markRoomChanged = async (roomId, userIds) => {
    for (const rec of await storage.activeDevices()) {
      if (userIds.includes(rec.userId)) await storage.enqueue(key(rec.userId, rec.deviceId), 'room', { roomId }, roomId, now() + TO_DEVICE_TTL_MS);
    }
  };
  const alertDevices = async (userId, content) => {
    for (const rec of await storage.devicesOfUser(userId)) {
      if (!rec.revoked) await storage.enqueue(key(rec.userId, rec.deviceId), 'security', { body: content }, null, now() + TO_DEVICE_TTL_MS);
    }
  };
  // Отправитель писем подключается снаружи. В разработке и тестах письма складываются в список.
  const mailer = externalMailer ?? { send: async (m) => { outbox.push(m); } };
  const mailTo = (to, subject, text) => mailer.send({ to, subject, text });
  // Письмо владельцу аккаунта — на подтверждённую почту. У аккаунтов без профиля адресом остаётся идентификатор.
  const mail = async (userId, subject, text) => {
    const profile = await storage.profileGet(userId);
    // Служебные письма — на основную почту и, если она задана, на запасную.
    const backup = await storage.backupEmailGet(userId);
    await mailTo(profile?.email ?? userId, subject, text);
    if (backup) await mailTo(backup.email, subject, text);
  };
  const revokeDevice = async (rec) => {
    // Credential revocation, pending MLS cleanup and group-removal markers are one store transaction.
    await storage.revokeDevice(key(rec.userId, rec.deviceId), now());
  };
  // Код восстановления хранится только как ключевой хэш; сам код есть лишь в письме (C-08).
  const recoveryCodeHash = (userId, code) => keyedHash(pinPepper, `recovery:${userId}`, code);
  const phoneCodeHash = (userId, code) => keyedHash(pinPepper, `phone:${userId}`, code);
  const recoveryLinkHash = (userId, token) => keyedHash(pinPepper, `recovery-link:${userId}`, token);
  const recoveryCancelHash = (userId, code) => keyedHash(pinPepper, `recovery-cancel:${userId}`, code);
  // Почтовые коды регистрации хранятся только как ключевые хэши; сам код есть лишь в письме.
  const emailCodeHash = (email, code) => keyedHash(pinPepper, `email-code:${email}`, code);
  const emailTokenHash = (email, token) => keyedHash(pinPepper, `email-token:${email}`, token);
  // Внутренний идентификатор аккаунта случайный и непубличный: почта и никнейм его не содержат.
  // Подтверждение действий над провайдерами (этап 2, решения владельца): пока пароль активен — пароль;
  // после привязки Google или Apple пароль отключён полностью — подтверждение кодом с почты, привязанным к действию.
  const STEPUP_ACTIONS = ['link-provider', 'remove-provider', 'set-backup-email', 'remove-backup-email', 'enable-biometric', 'disable-biometric'];
  const stepupActionText = {
    'link-provider': 'привязка аккаунта Google или Apple',
    'remove-provider': 'отвязка аккаунта Google или Apple',
    'set-backup-email': 'добавление или смена запасной почты',
    'remove-backup-email': 'удаление запасной почты',
    'enable-biometric': 'включение подтверждения Face ID или Touch ID',
    'disable-biometric': 'отключение подтверждения Face ID или Touch ID',
  };
  const stepupKey = (userId) => `stepup|${userId}`;
  const stepupCodeHash = (userId, action, code) => keyedHash(pinPepper, `stepup-code:${userId}:${action}`, code);
  const stepupTokenHash = (userId, action, token) => keyedHash(pinPepper, `stepup-token:${userId}:${action}`, token);
  // Пароль принимается, только пока аккаунт не привязан к внешнему провайдеру.
  const passwordSignInAllowed = async (userId) => (await storage.providerLinksOf(userId)).length === 0;
  const verifyStepUp = async (userId, action, body, deviceId = null) => {
    // Биометрический грант (этап 2б): одноразовый, только для своего действия и своего устройства.
    if (typeof body.bioGrant === 'string' && body.bioGrant !== '') {
      return (await consumeBioGrant(userId, action, body.bioGrant, deviceId)) ? { ok: true } : { ok: false, status: 403, error: 'biometric confirmation invalid' };
    }
    if (await passwordSignInAllowed(userId)) {
      const stored = await storage.accountHash(userId);
      if (typeof body.password === 'string' && checkPassword(body.password, stored)) return { ok: true };
      return { ok: false, status: 403, error: 'password required' };
    }
    const token = typeof body.stepupToken === 'string' ? body.stepupToken : '';
    if (token === '') return { ok: false, status: 403, error: 'email confirmation required' };
    const used = await storage.emailCodeUpdate(stepupKey(userId), (e) => {
      const out = useEmailToken(e, {
        nowMs: now(),
        tokenOk: !!e.tokenHash && sameHex(stepupTokenHash(userId, action, token), e.tokenHash),
      });
      return { next: out.next, result: out.outcome };
    });
    if (used === 'ok') return { ok: true };
    if (used === 'expired') return { ok: false, status: 410, error: 'confirmation expired' };
    return { ok: false, status: 403, error: 'confirmation invalid' };
  };
  // Отложенный вход (решение владельца): аккаунт без активных устройств, только почта — 48 часов;
  // аккаунт с привязкой Google или Apple — сразу.
  const DEVICE_WAIT_MS = 48 * 60 * 60 * 1000;
  const deviceWaitCodeHash = (userId, deviceId, code) => keyedHash(pinPepper, `device-wait:${userId}:${deviceId}`, code);
  // Запасная почта (решение владельца): необязательна; коды подтверждения действий идут на неё, если она задана.
  const backupKey = (userId, email) => `backup|${userId}|${email}`;
  const backupCodeHash = (userId, email, code) => keyedHash(pinPepper, `backup-code:${userId}:${email}`, code);
  const confirmationEmail = async (userId) => {
    const backup = await storage.backupEmailGet(userId);
    if (backup) return backup.email;
    return (await storage.profileGet(userId))?.email ?? userId;
  };
  // Биометрическое подтверждение (этап 2б, решение владельца): ключ устройства защищён биометрией на устройстве;
  // сервер хранит только открытый ключ и проверяет подпись на одноразовом вызове.
  const BIO_ACTIONS = ['link-provider', 'remove-provider', 'set-backup-email', 'remove-backup-email', 'approve-device', 'enable-biometric', 'disable-biometric'];
  const bioMessage = (userId, deviceId, action, nonce) => `inone-stepup-v1|${userId}|${deviceId}|${action}|${nonce}`;
  const verifyBioSignature = (jwk, message, signatureB64) => {
    try {
      return createVerify('SHA256').update(message).verify({ key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'der' }, Buffer.from(signatureB64, 'base64url'));
    } catch {
      return false;
    }
  };
  // Грант погашается один раз и только для своего действия и своего устройства.
  const consumeBioGrant = async (userId, action, grant, deviceId) => {
    if (typeof grant !== 'string' || grant === '') return false;
    const spent = await storage.consumeAuthToken('bio-grant', authTokenHash('bio-grant', grant), now());
    if (!spent || spent.userId !== userId) return false;
    const p = JSON.parse(spent.payload);
    return p.action === action && p.deviceId === deviceId;
  };
  // Одноразовые токены этапа 2 (nonce, билет регистрации, подтверждение входа): только ключевые хэши.
  const authTokenHash = (kind, token) => keyedHash(pinPepper, `auth:${kind}`, token);
  const newAuthToken = () => randomBytes(32).toString('base64url');
  // Сводка по аккаунту: уровень 0 — без подтверждённой почты, 1 — почта подтверждена, 2 — ещё и внешний аккаунт («Проверено»).
  const accountLevelInfo = async (userId) => {
    const profile = await storage.profileGet(userId);
    const links = await storage.providerLinksOf(userId);
    const backup = await storage.backupEmailGet(userId);
    const verificationLevel = profile?.emailVerified ? (links.length > 0 ? 2 : 1) : 0;
    return {
      userId,
      nickname: profile?.nickname ?? null,
      email: profile?.email ?? null,
      verificationLevel,
      providers: links.map((l) => l.provider),
      backupEmail: backup ? { email: backup.email, verified: backup.verified } : null,
      securityHints: backup ? [] : ['no_backup_email'],
    };
  };
  // Код подтверждения телефона: не чаще трёх раз в час. outcome: sent | limit (D5).
  const sendPhoneCode = async (userId, phone) => {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const outcome = await storage.phoneUpdate(userId, (p0) => {
      const out = requestPhoneCode(p0, { nowMs: now(), phone, codeHash: phoneCodeHash(userId, code) });
      return { next: out.next, result: out.outcome };
    });
    if (outcome === 'sent') await smsSender.send(phone, `Код: ${code}. Введите его в InOne, чтобы подтвердить номер.`);
    return outcome;
  };
  const identityCodeHash = (userId, code) => keyedHash(pinPepper, `identity:${userId}`, code);
  // Токены и устройства лежат в хранилище; токен там хранится как ключевой хэш (C-08).
  // Через 48 часов после восстановления старые устройства отключаются, если их не отменили (D5, D8).
  // Окно хранится в базе: переживает перезапуск сервера.
  const finalizeRecoveryIfDue = async (userId) => {
    if (!userId) return;
    const result = await storage.finalizeRecoveryDevices(userId, now());
    if (result.dueSince === null) return;
    await mail(userId, 'Старые устройства отключены', 'Прошло 48 часов после восстановления. Устройства, существовавшие до восстановления, отключены.');
  };
  const authed = async (req) => {
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const dk = raw ? await storage.deviceKeyForToken(raw, now()) : null;
    if (dk) await finalizeRecoveryIfDue((await storage.deviceRecord(dk))?.userId);
    const rec = dk ? await storage.deviceRecord(dk) : null;
    return rec && !rec.revoked ? rec : null;
  };
  if (!objectStore) objectStore = filesDir ? createFsObjectStore(filesDir) : createMemoryObjectStore();
  // Документы заявок шифруются на диске сервера (AES-256-GCM); ключ выводится из секрета, который задаёт оператор.
    const docsKey = docsSecret ? createHash('sha256').update(String(docsSecret)).digest() : null;
    const encryptDoc = (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', docsKey, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    };
    const decryptDoc = (blob) => {
      const decipher = createDecipheriv('aes-256-gcm', docsKey, blob.subarray(0, 12));
      decipher.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
    };
  const ACCESS_TTL_MS = sessionTtl.accessMs ?? 15 * 60_000;           // токен доступа: 15 минут (в тестах можно короче)
  const REFRESH_TTL_MS = sessionTtl.refreshMs ?? 30 * 24 * 3600_000;  // токен обновления: 30 дней, одноразовый, с ротацией
  const issueSession = (dk) => storage.issueSession(dk, now(), ACCESS_TTL_MS, REFRESH_TTL_MS);
  const sessionBody = (s, deviceId) => ({
    token: s.accessToken,
    refreshToken: s.refreshToken,
    expiresAt: new Date(s.accessExpiresAt).toISOString(),
    refreshExpiresAt: new Date(s.refreshExpiresAt).toISOString(),
    deviceId,
  });
  // Окно восстановления: пока оно открыто, любое устройство аккаунта только читает (D5, D8).
  const inRecoveryWindow = async (req) => {
    const raw = (req.headers.authorization || '').replace('Bearer ', '');
    const dk = raw ? await storage.deviceKeyForToken(raw, now()) : null;
    const d = dk ? await storage.deviceRecord(dk) : null;
    if (!d || d.revoked) return false;
    return windowOpen(await storage.recoveryGet(d.userId), now());
  };
  const activeCount = (userId) => storage.activeDeviceCount(userId);

  /**
   * Проверка PIN с блокировкой. Правила и защита от гонок — в хранилище: store.js (PostgreSQL)
   * или store-memory.js. Сервер подставляет время, лимит и функцию проверки хэша.
   */
  const verifyPin = (userId, pin) => storage.verifyPin(userId, pin, {
    now: now(),
    free: FREE_PIN_ATTEMPTS,
    lockDuration: lockDurationMs,
    check: (candidate, stored) => {
      pinChecks += 1;
      return checkPin(pinPepper, candidate, stored);
    },
  });

  const pinError = (res, r) => {
    if (r.reason === 'locked') {
      return send(res, 429, { error: 'too many wrong PIN attempts', retryAt: new Date(r.retryAt).toISOString() });
    }
    if (r.reason === 'no-pin') return send(res, 404, { error: 'no PIN set' });
    return send(res, 403, { error: 'wrong PIN' });
  };

  // ---- Файлы: подписанные адреса, проверки размера и контрольной суммы, доступ только членам комнаты (пункт 9) ----
    const FILE_LIMITS = { avatar: 5 * 1024 * 1024, image: 20 * 1024 * 1024, video: 100 * 1024 * 1024, file: 250 * 1024 * 1024 };
    const PENDING_LIMIT = 20;
    const UPLOAD_TTL_MS = 15 * 60_000;
    const DOWNLOAD_TTL_MS = 5 * 60_000;
    const STALE_UPLOAD_MS = 24 * 3600_000;
    const signFor = (action, fileId, expires, size = '', sha = '') =>
      createHmac('sha256', objectSecret).update(`${action}|${fileId}|${expires}|${size}|${sha}`).digest('hex');
    const sameSig = (a, b) => {
      const x = Buffer.from(String(a));
      const y = Buffer.from(String(b));
      return x.length === y.length && timingSafeEqual(x, y);
    };
    // Signed object URLs must use the configured public origin, never the untrusted Host header.
    // The fallback is retained only for direct in-memory test/development servers.
    const absoluteUrl = (req, path) => fileBaseUrl
      ? new URL(path, fileBaseUrl).toString()
      : `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}${path}`;

    async function handleObjectRequest(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const fileId = decodeURIComponent(url.pathname.slice('/objects/'.length));
      const expires = Number(url.searchParams.get('expires'));
      const sig = url.searchParams.get('sig') ?? '';
      const file = await storage.getFile(fileId);
      if (!file) return send(res, 404, { error: 'not found' });
      if (req.method === 'PUT') {
        if (!expires || now() > expires || !sameSig(sig, signFor('PUT', fileId, expires, file.size, file.sha256))) {
          return send(res, 403, { error: 'upload link is invalid or expired' });
        }
        if (file.status !== 'pending') return send(res, 409, { error: 'file is not waiting for upload' });
        if (Number(req.headers['content-length']) !== file.size) {
          res.setHeader('Connection', 'close');
          return send(res, 413, { error: 'size does not match the declaration' });
        }
        const chunks = [];
        let received = 0;
        for await (const chunk of req) {
          received += chunk.length;
          if (received > file.size) {
            res.setHeader('Connection', 'close');
            return send(res, 413, { error: 'file is larger than declared' });
          }
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== file.size) return send(res, 400, { error: 'incomplete body' });
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) return send(res, 422, { error: 'checksum does not match the declaration' });
        await objectStore.put(fileId, bytes);
        await storage.markFileUploaded(fileId);
        return send(res, 200, { uploaded: true });
      }
      if (req.method === 'GET') {
        if (!expires || now() > expires || !sameSig(sig, signFor('GET', fileId, expires))) return send(res, 403, { error: 'download link is invalid or expired' });
        if (file.status !== 'ready') return send(res, 404, { error: 'not ready' });
        const bytes = await objectStore.get(fileId);
        if (!bytes) return send(res, 404, { error: 'not found' });
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': bytes.length,
          'content-disposition': 'attachment',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        });
        return res.end(bytes);
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    // Уведомление о новом сообщении: получают устройства участников, кроме отправившего. Содержимого и имени нет.
      const notifyNewMessage = async (roomId, eventId, senderDeviceKey) => {
        if (!(await currentFlags())['push.enabled']) return;
        if (!pushSender) return;
        const targets = await storage.devicesToNotify(roomId, senderDeviceKey);
        const path = `/rooms/${encodeURIComponent(roomId)}/events/${encodeURIComponent(eventId)}`;
        for (const t of targets) {
          try {
            const result = await pushSender.send({ provider: t.provider, token: t.token, payload: { type: 'message', path } });
            if (result && result.invalidToken) await storage.deletePushToken(t.deviceKey);
          } catch {
            if (logger) logger.warn('push delivery failed', { provider: t.provider });
          }
        }
      };

    // Очистка истёкших данных (критерий версии 0.6.0): очередь, токены, одноразовые токены, коды отмены восстановления, брошенные загрузки.
      const REJECTED_REQUEST_RETENTION_MS = 90 * 24 * 3600_000; // отклонённые заявки и их документы — 90 дней после решения
      const sweepExpired = async () => {
        const t = now();
        const removed = await storage.purgeExpired(t);
        const codes = await storage.clearExpiredCodes(t);
        const retired = await storage.purgeRetired(t);
    const docKeys = await storage.purgeRejectedOrgRequests(t - REJECTED_REQUEST_RETENTION_MS);
    for (const k of docKeys) await objectStore.remove(k);
        return { ...removed, ...codes, ...retired, docs: docKeys.length, files: await cleanupFiles() };
      };

    // Единое правило доступа (шаг 5.2): участник комнаты обязан быть участником её одобренной организации.
    // Участник другой организации допускается в комнату только при активной связи между организациями (шаг 5.6).
    const linkedMember = async (userId, orgId) => {
      for (const uo of await storage.listUserOrgs(userId)) {
        if (uo.status === 'approved' && (await storage.activeLinkBetween(uo.orgId, orgId))) return true;
      }
      return false;
    };
    // Видимость между людьми (шаг 5.8): только при общей одобренной организации или активной связи между их организациями.
    const sharesOrgOrLink = async (a, b) => {
      if (a === b) return true;
      const mine = await storage.listUserOrgs(a);
      const theirs = await storage.listUserOrgs(b);
      for (const x of mine) {
        if (x.status !== 'approved') continue;
        for (const y of theirs) {
          if (y.status !== 'approved') continue;
          if (x.orgId === y.orgId) return true;
          if (await storage.activeLinkBetween(x.orgId, y.orgId)) return true;
        }
      }
      return false;
    };
    const orgGate = async (userId, orgId) => {
      const status = await storage.orgStatus(orgId);
      if (status === null) return { status: 404, error: 'organization not found', code: 'org_not_found' };
      if (status !== 'approved') return { status: 403, error: 'organization is not approved', code: 'org_not_approved' };
      if (!(await storage.orgRoleOf(orgId, userId)) && !(await linkedMember(userId, orgId))) return { status: 403, error: 'not an organization member', code: 'org_not_member' };
      return null;
    };
    const cleanupFiles = async () => {
      const removed = await storage.purgeStaleFiles(now() - STALE_UPLOAD_MS);
      for (const fileId of removed) await objectStore.remove(fileId);
      return removed.length;
    };


  // Флаги функций: действующие значения (умолчания, перекрытые оператором); группа без предела по каналам.
    const currentFlags = async () => effectiveFlags(await storage.flagOverrides());
    // Лимит группы: общий (флаг) и лимит организации; действует меньший из них.
    const effectiveMaxMembers = async (roomId) => {
      const flagMax = (await currentFlags())['groups.maxMembers'];
      const orgId = await storage.roomOrg(roomId);
      const s = orgId ? await storage.orgSettings(orgId) : null;
      return s && s.maxGroupMembers !== null ? Math.min(flagMax, s.maxGroupMembers) : flagMax;
    };
    const groupFull = async (roomId) => {
      const kind = typeof storage.roomKind === 'function' ? await storage.roomKind(roomId) : (await storage.getRoom(roomId))?.kind;
      if (kind === 'channel') return false;
      const r = await storage.getRoom(roomId);
      return r.members.length >= (await effectiveMaxMembers(roomId));
    };

    
  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const pathOnly = req.url.split('?')[0];
    if (logger) res.on('finish', () => logger.info('request', { method: req.method, path: pathOnly, status: res.statusCode, ms: Date.now() - startedAt }));
    if (req.method === 'GET' && pathOnly === '/healthz') return send(res, 200, { status: 'ok' });
    if (req.method !== 'GET' && !['/logout', '/token/refresh'].includes(pathOnly) && (await currentFlags())['maintenance.enabled']) return send(res, 503, { error: 'maintenance', code: 'maintenance' });
    if (pathOnly.startsWith('/objects/')) return handleObjectRequest(req, res);
    if (req.method === 'GET' && pathOnly === '/readyz') {
      try {
        await storage.ping();
        return send(res, 200, { status: 'ready' });
      } catch {
        return send(res, 503, { status: 'not ready' });
      }
    }
    try {
      const chunks = [];
      let received = 0;
      for await (const c of req) {
        received += c.length;
        if (received > bodyLimit) {
          res.setHeader('Connection', 'close');
          return send(res, 413, { error: 'request body too large' });
        }
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      // Тела сообщений (комнаты и личные) в журнал не пишутся: иначе удалённое осталось бы на сервере.
      const carriesMessage = /^\/(sendToDevice\/|rooms\/[^/]+\/(events|assets)|mls\/)/.test(req.url);
      // Журнал в памяти ограничен: без этого он рос бы с каждым запросом.
      if (wireLog.length >= wireLogLimit) wireLog.splice(0, wireLog.length - wireLogLimit + 1);
      const carriesDocument = /^\/org-requests\/[^/]+\/documents/.test(req.url);
      wireLog.push(`${req.method} ${req.url} ${carriesMessage ? '[тело сообщения не записывается]' : carriesDocument ? '[тело документа не записывается]' : raw.replace(/"(password|newPassword|code|pin|currentPin|newPin|pollSecret|token|refreshToken|codeword|recoveryCode|email|phone)":"[^"]*"/g, '"$1":"***"')}`);

      let body = {};
      const isForm = String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
      try {
        // Форма из браузера (страница подтверждения восстановления) и JSON от приложения.
        body = !raw ? {} : isForm ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
      } catch { return send(res, 400, { error: 'bad json' }); }
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      // Режим обслуживания: записи отключены; чтение, выход, обновление сессии и операторские маршруты работают.
      if (req.method !== 'GET' && !['/logout', '/token/refresh'].includes(p) && (await currentFlags())['maintenance.enabled']) {
        return send(res, 503, { error: 'maintenance', code: 'maintenance' });
      }
      // Токен доступа истёк: клиент получает отдельный ответ и обновит токен по токену обновления.
      const PUBLIC_PATHS = ['/register', '/login', '/token/refresh'];
      if (!PUBLIC_PATHS.includes(p) && req.headers.authorization) {
        const raw = String(req.headers.authorization).replace('Bearer ', '');
        if ((await storage.accessTokenState(raw, now())) === 'expired') return send(res, 401, { error: 'token expired', code: 'token_expired' });
      }
      // Окно восстановления: устройства только читают. Исключения: чтение чужих ключей и отмена (её право проверяет маршрут, D8).
      if (req.method !== 'GET' && !WINDOW_POST_OK.has(p) && (await inRecoveryWindow(req))) {
        return send(res, 403, { error: 'device is restricted during the recovery window' });
      }

      // ---------- аккаунт и вход ----------
      // ---------- вход и регистрация через Google и Apple (модель аккаунта, этап 2) ----------
      if (req.method === 'POST' && p === '/auth/nonce') {
        const perAddress = await checkRate('authNoncePerAddress', clientIp(req));
        if (!perAddress.allowed) return send(res, 429, { error: 'too many requests, try later' });
        const nonce = newAuthToken();
        await storage.issueAuthToken({ kind: 'nonce', tokenHash: authTokenHash('nonce', nonce), userId: null, payload: null, expiresAt: now() + 10 * 60_000 });
        return send(res, 200, { nonce });
      }

      if (req.method === 'POST' && p === '/auth/provider/verify') {
        const perAddress = await checkRate('providerAuthPerAddress', clientIp(req));
        if (!perAddress.allowed) return send(res, 429, { error: 'too many requests, try later' });
        const provider = body.provider;
        if (provider !== 'google' && provider !== 'apple') return send(res, 400, { error: 'provider must be google or apple' });
        if (!providers[provider]?.clientIds?.length) return send(res, 400, { error: 'provider is not enabled' });
        const nonce = typeof body.nonce === 'string' ? body.nonce : '';
        const spent = nonce === '' ? null : await storage.consumeAuthToken('nonce', authTokenHash('nonce', nonce), now());
        if (!spent) return send(res, 401, { error: 'nonce invalid or already used' });
        const checked = await verifyProviderToken(provider, body.idToken, nonce);
        if (!checked.ok) return send(res, checked.reason === 'unverified-email' ? 403 : 401, { error: `provider token rejected: ${checked.reason}` });
        const linked = await storage.providerLinkFind(provider, checked.identity.sub);
        if (linked) {
          const proof = newAuthToken();
          await storage.issueAuthToken({ kind: 'provider-proof', tokenHash: authTokenHash('provider-proof', proof), userId: linked.userId, payload: null, expiresAt: now() + 2 * 60_000 });
          return send(res, 200, { status: 'linked', userId: linked.userId, proof });
        }
        const ticket = newAuthToken();
        await storage.issueAuthToken({ kind: 'provider-ticket', tokenHash: authTokenHash('provider-ticket', ticket), userId: null, payload: JSON.stringify(checked.identity), expiresAt: now() + 30 * 60_000 });
        return send(res, 200, { status: 'new', ticket, email: checked.identity.email, relay: checked.identity.relay });
      }

      if (req.method === 'POST' && p === '/register/provider') {
        const reg = await checkRate('registrationsPerAddress', clientIp(req));
        if (!reg.allowed) return send(res, 429, { error: 'too many registrations from this address', retryAt: new Date(reg.retryAt).toISOString() });
        // Ник проверяем до погашения билета: опечатка в нике не заставляет входить у провайдера заново.
        const nickError = validateNickname(body.nickname);
        if (nickError) return send(res, 400, { error: nickError });
        if (await storage.searchNickname(body.nickname)) return send(res, 409, { error: 'nickname taken' });
        const ticket = typeof body.ticket === 'string' ? body.ticket : '';
        const spent = ticket === '' ? null : await storage.consumeAuthToken('provider-ticket', authTokenHash('provider-ticket', ticket), now());
        if (!spent) return send(res, 403, { error: 'registration ticket invalid or expired' });
        const identity = JSON.parse(spent.payload);
        const sameEmailError = 'email already registered: sign in with password and link the provider from settings';
        if (await storage.userIdByEmail(identity.email)) return send(res, 409, { error: sameEmailError });
        const userId = newUserId();
        const created = await storage.createVerifiedAccount({
          userId,
          joinDefaultOrg: defaultOrgAutoJoin,
          // У аккаунта провайдера пароля нет: случайный непоказываемый хэш, вход только через провайдера.
          passwordHash: hashPassword(randomBytes(32).toString('hex')),
          email: identity.email,
          nickname: body.nickname,
          nowMs: now(),
          provider: { provider: identity.provider, sub: identity.sub },
        });
        if (created !== 'ok') {
          const error = created === 'nickname' ? 'nickname taken' : created === 'email' ? sameEmailError : created === 'link' ? 'this provider account is already linked' : 'account exists';
          return send(res, 409, { error });
        }
        const proof = newAuthToken();
        await storage.issueAuthToken({ kind: 'provider-proof', tokenHash: authTokenHash('provider-proof', proof), userId, payload: null, expiresAt: now() + 2 * 60_000 });
        return send(res, 200, { userId, nickname: body.nickname, verificationLevel: 2, proof });
      }

      // ---------- подтверждение действий над провайдерами: код с почты после привязки (этап 2) ----------
      // ---------- запасная почта: необязательна, подтверждается кодом (решение владельца) ----------
      if (req.method === 'POST' && p === '/account/backup-email/start') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const profile = await storage.profileGet(d.userId);
        if (!profile) return send(res, 400, { error: 'account has no verified email' });
        const email = normalizeEmail(body.email);
        if (!isEmail(email)) return send(res, 400, { error: 'email must be a valid address' });
        if (email === profile.email) return send(res, 400, { error: 'backup email must differ from the main email' });
        // Изменение запасной почты — действие с подтверждением: пароль или код с текущей почты.
        const confirmed = await verifyStepUp(d.userId, 'set-backup-email', body, d.deviceId);
        if (!confirmed.ok) return send(res, confirmed.status, { error: confirmed.error });
        const perAccount = await checkRate('backupEmailPerAccount', d.userId);
        if (!perAccount.allowed) return send(res, 429, { error: 'too many requests, try later' });
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        await storage.emailCodeUpdate(backupKey(d.userId, email), (e) => ({
          next: requestEmailCode(e, { nowMs: now(), codeHash: backupCodeHash(d.userId, email, code) }),
          result: null,
        }));
        await mailTo(email, 'Подтверждение запасной почты InOne',
          `Код: ${code}. Этот адрес указан запасной почтой аккаунта InOne. Код действует 10 минут. Если это не вы, просто проигнорируйте письмо.`);
        return send(res, 202, { ok: true });
      }

      if (req.method === 'POST' && p === '/account/backup-email/confirm') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const email = normalizeEmail(body.email);
        if (!isEmail(email)) return send(res, 400, { error: 'email must be a valid address' });
        const code = typeof body.code === 'string' ? body.code : '';
        const outcome = await storage.emailCodeUpdate(backupKey(d.userId, email), (e) => {
          const out = checkEmailCode(e, {
            nowMs: now(),
            codeOk: !!e.codeHash && sameHex(backupCodeHash(d.userId, email, code), e.codeHash),
            tokenHash: null,
          });
          return { next: out.next, result: out.outcome };
        });
        if (outcome === 'none') return send(res, 404, { error: 'no code was requested for this address' });
        if (outcome === 'expired') return send(res, 410, { error: 'code expired, request a new one' });
        if (outcome === 'locked') return send(res, 403, { error: 'too many wrong codes, request a new one' });
        if (outcome !== 'ok') return send(res, 403, { error: 'wrong code' });
        const previous = await storage.backupEmailGet(d.userId);
        if ((await storage.backupEmailSave(d.userId, email, now())) === 'taken') {
          return send(res, 409, { error: 'this backup email is used by another account' });
        }
        const primary = (await storage.profileGet(d.userId)).email;
        await mailTo(primary, 'Запасная почта InOne изменена',
          `Запасная почта аккаунта ${previous ? 'изменена' : 'добавлена'}. Если это не вы, войдите в аккаунт и проверьте привязки и устройства.`);
        return send(res, 200, { backupEmail: { email, verified: true } });
      }

      if (req.method === 'POST' && p === '/account/backup-email/remove') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const confirmed = await verifyStepUp(d.userId, 'remove-backup-email', body, d.deviceId);
        if (!confirmed.ok) return send(res, confirmed.status, { error: confirmed.error });
        if (!(await storage.backupEmailRemove(d.userId))) return send(res, 404, { error: 'no backup email is set' });
        const primary = (await storage.profileGet(d.userId)).email;
        await mailTo(primary, 'Запасная почта InOne удалена',
          'Запасная почта удалена из аккаунта InOne. Если это не вы, войдите в аккаунт и проверьте привязки и устройства.');
        return send(res, 200, await accountLevelInfo(d.userId));
      }

      // ---------- биометрическое подтверждение: ключ устройства и одноразовые вызовы (этап 2б) ----------
      if (req.method === 'POST' && p === '/devices/signing-key') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const jwk = body.publicKey;
        const validKey = !!jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string' && jwk.d === undefined;
        if (!validKey) return send(res, 400, { error: 'publicKey must be an EC P-256 public key (JWK)' });
        try {
          createPublicKey({ key: jwk, format: 'jwk' });
        } catch {
          return send(res, 400, { error: 'publicKey is not a valid key' });
        }
        // Включение биометрии — действие с подтверждением: пароль или код с почты.
        const confirmed = await verifyStepUp(d.userId, 'enable-biometric', body, d.deviceId);
        if (!confirmed.ok) return send(res, confirmed.status, { error: confirmed.error });
        await storage.signingKeySet(key(d.userId, d.deviceId), { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, now());
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/devices/signing-key/remove') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const confirmed = await verifyStepUp(d.userId, 'disable-biometric', body, d.deviceId);
        if (!confirmed.ok) return send(res, confirmed.status, { error: confirmed.error });
        if (!(await storage.signingKeyDelete(key(d.userId, d.deviceId)))) return send(res, 404, { error: 'biometric is not enabled on this device' });
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/stepup/biometric/challenge') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        if (!BIO_ACTIONS.includes(body.action)) return send(res, 400, { error: 'unknown action' });
        if (!(await storage.signingKeyGet(key(d.userId, d.deviceId)))) return send(res, 400, { error: 'biometric is not enabled on this device' });
        const perAccount = await checkRate('bioChallengePerAccount', d.userId);
        if (!perAccount.allowed) return send(res, 429, { error: 'too many requests, try later' });
        const nonce = newAuthToken();
        const challengeId = newAuthToken();
        const expiresAt = now() + 2 * 60_000;
        await storage.issueAuthToken({ kind: 'bio-challenge', tokenHash: authTokenHash('bio-challenge', challengeId), userId: d.userId, payload: JSON.stringify({ deviceId: d.deviceId, action: body.action, nonce }), expiresAt });
        return send(res, 200, { challengeId, nonce, action: body.action, expiresAt: new Date(expiresAt).toISOString() });
      }

      if (req.method === 'POST' && p === '/stepup/biometric/confirm') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
        const spent = challengeId === '' ? null : await storage.consumeAuthToken('bio-challenge', authTokenHash('bio-challenge', challengeId), now());
        if (!spent || spent.userId !== d.userId) return send(res, 403, { error: 'challenge invalid or expired' });
        const c = JSON.parse(spent.payload);
        // Подтвердить может только то устройство, которое запросило подтверждение.
        if (c.deviceId !== d.deviceId) return send(res, 403, { error: 'challenge belongs to another device' });
        const jwk = await storage.signingKeyGet(key(d.userId, c.deviceId));
        const signed = !!jwk && verifyBioSignature(jwk, bioMessage(d.userId, c.deviceId, c.action, c.nonce), String(body.signature ?? ''));
        if (!signed) return send(res, 403, { error: 'signature invalid' });
        const grant = newAuthToken();
        await storage.issueAuthToken({ kind: 'bio-grant', tokenHash: authTokenHash('bio-grant', grant), userId: d.userId, payload: JSON.stringify({ deviceId: c.deviceId, action: c.action }), expiresAt: now() + 60_000 });
        return send(res, 200, { grant, action: c.action, expiresInSeconds: 60 });
      }

      if (req.method === 'POST' && p === '/stepup/email/start') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const action = body.action;
        if (!STEPUP_ACTIONS.includes(action)) return send(res, 400, { error: 'unknown action' });
        // Пока пароль активен, подтверждение — пароль, код не выдаётся.
        if (await passwordSignInAllowed(d.userId)) return send(res, 400, { error: 'confirm with password' });
        if (!(await storage.profileGet(d.userId))) return send(res, 400, { error: 'account has no verified email' });
        const perAccount = await checkRate('stepupPerAccount', d.userId);
        if (!perAccount.allowed) return send(res, 429, { error: 'too many confirmation requests, try later' });
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        await storage.emailCodeUpdate(stepupKey(d.userId), (e) => ({
          next: requestEmailCode(e, { nowMs: now(), codeHash: stepupCodeHash(d.userId, action, code) }),
          result: null,
        }));
        await mailTo(await confirmationEmail(d.userId), 'Подтверждение действия в InOne',
          `Код: ${code}. Действие: ${stepupActionText[action]}. Код действует 10 минут. Если это не вы, войдите в аккаунт и проверьте привязки и устройства.`);
        return send(res, 202, { ok: true });
      }

      if (req.method === 'POST' && p === '/stepup/email/confirm') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const action = body.action;
        if (!STEPUP_ACTIONS.includes(action)) return send(res, 400, { error: 'unknown action' });
        const code = typeof body.code === 'string' ? body.code : '';
        const stepupToken = newAuthToken();
        const outcome = await storage.emailCodeUpdate(stepupKey(d.userId), (e) => {
          const out = checkEmailCode(e, {
            nowMs: now(),
            codeOk: !!e.codeHash && sameHex(stepupCodeHash(d.userId, action, code), e.codeHash),
            tokenHash: stepupTokenHash(d.userId, action, stepupToken),
          });
          return { next: out.next, result: out.outcome };
        });
        if (outcome === 'ok') return send(res, 200, { stepupToken });
        if (outcome === 'none') return send(res, 404, { error: 'no code was requested' });
        if (outcome === 'expired') return send(res, 410, { error: 'code expired, request a new one' });
        if (outcome === 'locked') return send(res, 403, { error: 'too many wrong codes, request a new one' });
        return send(res, 403, { error: 'wrong code' });
      }
      if (req.method === 'POST' && p === '/account/providers') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        if (!(await storage.profileGet(d.userId))) return send(res, 400, { error: 'account has no verified email' });
        // Привязка внешнего аккаунта: пароль, пока он активен; после привязки — код с почты (решение владельца).
        const confirmed = await verifyStepUp(d.userId, 'link-provider', body, d.deviceId);
        if (!confirmed.ok) return send(res, confirmed.status, { error: confirmed.error });
        const provider = body.provider;
        if (provider !== 'google' && provider !== 'apple') return send(res, 400, { error: 'provider must be google or apple' });
        if (!providers[provider]?.clientIds?.length) return send(res, 400, { error: 'provider is not enabled' });
        const nonce = typeof body.nonce === 'string' ? body.nonce : '';
        const spent = nonce === '' ? null : await storage.consumeAuthToken('nonce', authTokenHash('nonce', nonce), now());
        if (!spent) return send(res, 401, { error: 'nonce invalid or already used' });
        const checked = await verifyProviderToken(provider, body.idToken, nonce);
        if (!checked.ok) return send(res, checked.reason === 'unverified-email' ? 403 : 401, { error: `provider token rejected: ${checked.reason}` });
        const linked = await storage.linkProvider({ userId: d.userId, provider, sub: checked.identity.sub, email: checked.identity.email, nowMs: now() });
        if (linked === 'taken') return send(res, 409, { error: 'this provider account is linked to another InOne account' });
        if (linked === 'provider-set') return send(res, 409, { error: 'this provider is already linked to your account' });
        // Пароль после привязки отключается полностью: хэш подменяется случайным, непоказываемым значением.
        await storage.setPasswordHash(d.userId, hashPassword(randomBytes(32).toString('hex')));
        return send(res, 200, await accountLevelInfo(d.userId));
      }

      if (req.method === 'POST' && p === '/account/providers/remove') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const confirmed = await verifyStepUp(d.userId, 'remove-provider', body, d.deviceId);
        if (!confirmed.ok) return send(res, confirmed.status, { error: confirmed.error });
        const provider = body.provider;
        if (provider !== 'google' && provider !== 'apple') return send(res, 400, { error: 'provider must be google or apple' });
        const links = await storage.providerLinksOf(d.userId);
        if (!links.some((l) => l.provider === provider)) return send(res, 404, { error: 'provider is not linked' });
        if (links.length <= 1) return send(res, 409, { error: 'cannot remove the last sign-in method' });
        await storage.unlinkProvider(d.userId, provider);
        return send(res, 200, await accountLevelInfo(d.userId));
      }

      // ---------- регистрация по почте (модель аккаунта, этап 1; режим verified — по умолчанию) ----------
      if (req.method === 'POST' && p === '/register/email' && registrationMode === 'verified') {
        // Ответ одинаковый, есть такая почта в системе или нет: по ответу не узнать, кто уже зарегистрирован.
        const email = normalizeEmail(body.email);
        if (!isEmail(email)) return send(res, 400, { error: 'email must be a valid address' });
        const perAddress = await checkRate('emailCodePerAddress', clientIp(req));
        const perEmail = await checkRate('emailCodePerEmail', email);
        if (!perAddress.allowed || !perEmail.allowed) return send(res, 429, { error: 'too many codes, try later' });
        if (!(await storage.userIdByEmail(email))) {
          const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
          await storage.emailCodeUpdate(email, (e) => ({
            next: requestEmailCode(e, { nowMs: now(), codeHash: emailCodeHash(email, code) }),
            result: null,
          }));
          await mailTo(email, 'Код подтверждения InOne',
            `Код: ${code}. Код действует 10 минут. Если вы не регистрировались в InOne, проигнорируйте письмо.`);
        }
        return send(res, 202, { ok: true });
      }

      if (req.method === 'POST' && p === '/register/email/confirm' && registrationMode === 'verified') {
        const email = normalizeEmail(body.email);
        if (!isEmail(email)) return send(res, 400, { error: 'email must be a valid address' });
        if (await storage.userIdByEmail(email)) return send(res, 409, { error: 'email already registered' });
        const code = typeof body.code === 'string' ? body.code : '';
        const token = randomBytes(24).toString('base64url');
        const outcome = await storage.emailCodeUpdate(email, (e) => {
          const out = checkEmailCode(e, {
            nowMs: now(),
            codeOk: !!e.codeHash && (sameHex(emailCodeHash(email, code), e.codeHash) || (!!devEmailCode && code === devEmailCode)),
            tokenHash: emailTokenHash(email, token),
          });
          return { next: out.next, result: out.outcome };
        });
        if (outcome === 'ok') return send(res, 200, { registrationToken: token });
        if (outcome === 'none') return send(res, 404, { error: 'no code was requested for this email' });
        if (outcome === 'expired') return send(res, 410, { error: 'code expired, request a new one' });
        if (outcome === 'locked') return send(res, 403, { error: 'too many wrong codes, request a new one' });
        return send(res, 403, { error: 'wrong code' });
      }

      if (req.method === 'POST' && p === '/register' && registrationMode === 'verified') {
        const email = normalizeEmail(body.email);
        const token = typeof body.registrationToken === 'string' ? body.registrationToken : '';
        // Лимит на регистрации с одного адреса: накрутка аккаунтов стоит денег (D5).
        const reg = await checkRate('registrationsPerAddress', clientIp(req));
        if (!reg.allowed) return send(res, 429, { error: 'too many registrations from this address', retryAt: new Date(reg.retryAt).toISOString() });
        if (!isEmail(email) || token === '') return send(res, 400, { error: 'email and registrationToken required' });
        if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
          return send(res, 400, { error: `password required (min ${MIN_PASSWORD_LENGTH} chars)` });
        }
        const nickError = validateNickname(body.nickname);
        if (nickError) return send(res, 400, { error: nickError });
        if (await storage.userIdByEmail(email)) return send(res, 409, { error: 'email already registered' });
        if (await storage.searchNickname(body.nickname)) return send(res, 409, { error: 'nickname taken' });
                const hasPhoneV = body.phone !== undefined && body.phone !== null && body.phone !== '';
        if (requirePhone && !hasPhoneV) return send(res, 400, { error: 'phone required' });
        const phoneV = hasPhoneV ? normalizePhone(body.phone, { blockedCountries: phoneBlockedCountries, allowedCountries: phoneAllowedCountries }) : null;
        if (phoneV?.error) return send(res, 400, { error: phoneV.error });
        if (phoneV && (await storage.phoneOwner(phoneV.value.e164))) return send(res, 409, { error: 'phone already used by another account' });
// Токен одноразовый: гасится до создания аккаунта, чтобы им нельзя было воспользоваться дважды.
        const used = await storage.emailCodeUpdate(email, (e) => {
          const out = useEmailToken(e, { nowMs: now(), tokenOk: !!e.tokenHash && sameHex(emailTokenHash(email, token), e.tokenHash) });
          return { next: out.next, result: out.outcome };
        });
        if (used === 'expired') return send(res, 410, { error: 'registration token expired' });
        if (used !== 'ok') return send(res, 403, { error: 'registration token invalid' });
        const userId = newUserId();
        const created = await storage.createVerifiedAccount({
          userId, passwordHash: hashPassword(body.password), email, nickname: body.nickname, nowMs: now(), joinDefaultOrg: defaultOrgAutoJoin,
        });
        if (created !== 'ok') {
          const error = created === 'nickname' ? 'nickname taken' : created === 'email' ? 'email already registered' : 'account exists';
          return send(res, 409, { error });
        }
        if (phoneV) {
      const e164 = phoneV.value.e164;
      try {
        if (smsEnabled) await sendPhoneCode(userId, e164);
        else await storage.phoneUpdate(userId, () => ({ next: { phone: e164, verified: false, codeHash: null, codeAttempts: 0, codeExpiresAt: 0, sends: [] }, result: 'saved' }));
      } catch (e) {
        if (e.code === '23505') return send(res, 409, { error: 'phone already used by another account' });
        throw e;
      }
    }
    return send(res, 200, { userId, nickname: body.nickname, verificationLevel: 1 });
      }

      // ---------- поиск по нику и свой профиль (модель аккаунта, этап 1) ----------
      if (testUi && req.method === 'GET' && p.startsWith('/test-ui/')) {
        const file = TEST_UI_FILES[p.slice('/test-ui/'.length)];
        if (!file) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        return res.end(readFileSync(new URL(`../${file.dir}/${file.name}`, import.meta.url)));
      }
      if (req.method === 'GET' && p === '/users/search') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const perAccount = await checkRate('searchPerAccount', d.userId);
        const perAddress = await checkRate('searchPerAddress', clientIp(req));
        if (!perAccount.allowed || !perAddress.allowed) return send(res, 429, { error: 'too many searches, try later' });
        const nickname = new URL(req.url, 'http://localhost').searchParams.get('nickname') ?? '';
        if (validateNickname(nickname)) return send(res, 400, { error: 'nickname has an invalid format' });
        const found = await storage.searchNickname(nickname);
        if (!found) return send(res, 404, { error: 'not found' });
        if (!(await sharesOrgOrLink(d.userId, found.userId))) return send(res, 404, { error: 'not found' });
        // Почта и номер в ответе не отдаются: найти пользователя можно только по нику.
        const info = await accountLevelInfo(found.userId);
        return send(res, 200, { userId: found.userId, nickname: found.nickname, verificationLevel: info.verificationLevel });
      }

      if (req.method === 'GET' && p === '/profile') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const info = await accountLevelInfo(d.userId);
        // Подсказка (решение владельца): аккаунт связан с Google или Apple, а на этом устройстве биометрия ещё не включена.
        if (info.providers.length > 0 && !(await storage.signingKeyGet(key(d.userId, d.deviceId)))) {
          info.securityHints = [...info.securityHints, 'offer_biometric'];
        }
        return send(res, 200, info);
      }

      if (req.method === 'POST' && p === '/register' && registrationMode === 'open') {
        const { userId, password, phone } = body;
        // Лимит на регистрации с одного адреса: накрутка аккаунтов и SMS стоит денег (D5).
        const reg = await checkRate('registrationsPerAddress', clientIp(req));
        if (!reg.allowed) return send(res, 429, { error: 'too many registrations from this address', retryAt: new Date(reg.retryAt).toISOString() });
        if (!userId || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
          return send(res, 400, { error: 'userId and password (min 8 chars) required' });
        }
        const hasPhone = phone !== undefined && phone !== null;
        if (requirePhone && !hasPhone) return send(res, 400, { error: 'phone required' });
        const phoneNorm = hasPhone ? normalizePhone(phone, { blockedCountries: phoneBlockedCountries, allowedCountries: phoneAllowedCountries }) : null;
        if (phoneNorm?.error) return send(res, 400, { error: phoneNorm.error });
        if (phoneNorm) {
          // На один номер SMS приходят не чаще заданного за сутки, с любого адреса и с любого аккаунта.
          const perPhone = await checkRate('phoneRegistrationPerPhone', phoneNorm.value.e164);
          // Когда SMS подключены, регистрация с номером тратит тот же суточный лимит SMS на номер.
          if (smsEnabled) {
            const smsCount = await checkRate('smsPerPhone', phoneNorm.value.e164);
            if (!smsCount.allowed) return send(res, 429, { error: 'too many codes for this phone, try tomorrow', retryAt: new Date(smsCount.retryAt).toISOString() });
          }
          if (!perPhone.allowed) return send(res, 429, { error: 'too many codes for this phone, try tomorrow', retryAt: new Date(perPhone.retryAt).toISOString() });
        }
        if (phoneNorm && (await storage.phoneOwner(phoneNorm.value.e164))) return send(res, 409, { error: 'phone already used by another account' });
        if (!(await storage.addAccount(userId, hashPassword(password), { joinDefaultOrg: defaultOrgAutoJoin }))) return send(res, 409, { error: 'account exists' });
        // Номер подтверждается кодом из SMS: до подтверждения он не даёт права на восстановление (D5).
        if (phoneNorm) {
          const e164 = phoneNorm.value.e164;
          // SMS пока не подключён: номер закрепляется за аккаунтом в ожидании подтверждения, код не отправляется.
          try {
            if (smsEnabled) await sendPhoneCode(userId, e164);
            else await storage.phoneUpdate(userId, () => ({ next: { phone: e164, verified: false, codeHash: null, codeAttempts: 0, codeExpiresAt: 0, sends: [] }, result: 'saved' }));
          } catch (e) {
            if (e.code === '23505') return send(res, 409, { error: 'phone already used by another account' });
            throw e;
          }
        }
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/account/phone') {
      if (!smsEnabled) return send(res, 503, { error: 'SMS verification is not available yet' });
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        // Смена номера требует пароль: украденное устройство само по себе номер не меняет (D5).
        const stored = await storage.accountHash(d.userId);
        if (typeof body.password !== 'string' || !(await passwordSignInAllowed(d.userId)) || !checkPassword(body.password, stored)) return send(res, 403, { error: 'password required to change the phone' });
        const phoneNorm = normalizePhone(body.phone, { blockedCountries: phoneBlockedCountries, allowedCountries: phoneAllowedCountries });
        if (phoneNorm.error) return send(res, 400, { error: phoneNorm.error });
        const holder = await storage.phoneOwner(phoneNorm.value.e164);
        if (holder && holder !== d.userId) return send(res, 409, { error: 'phone already used by another account' });
        const perPhone = await checkRate('smsPerPhone', phoneNorm.value.e164);
        if (!perPhone.allowed) return send(res, 429, { error: 'too many codes for this phone, try tomorrow', retryAt: new Date(perPhone.retryAt).toISOString() });
        let outcome;
        try {
          outcome = await sendPhoneCode(d.userId, phoneNorm.value.e164);
        } catch (e) {
          if (e.code === '23505') return send(res, 409, { error: 'phone already used by another account' });
          throw e;
        }
        if (outcome === 'limit') return send(res, 429, { error: 'too many codes, try later' });
        return send(res, 202, { ok: true });
      }

      if (req.method === 'POST' && p === '/account/phone/confirm') {
      if (!smsEnabled) return send(res, 503, { error: 'SMS verification is not available yet' });
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const code = body.code;
        const matches = (p0) => typeof code === 'string' && !!p0.codeHash && sameHex(phoneCodeHash(d.userId, code), p0.codeHash);
        const current = await storage.phoneGet(d.userId);
        // Один подтверждённый номер — один аккаунт: номер, уже подтверждённый другим аккаунтом, не принимается.
        if (checkPhoneCode(current, { nowMs: now(), codeOk: matches(current) }).outcome === 'ok') {
          const owner = await storage.verifiedPhoneOwner(current.phone);
          if (owner !== null && owner !== d.userId) return send(res, 409, { error: 'phone already used by another account' });
        }
        let outcome;
        try {
          outcome = await storage.phoneUpdate(d.userId, (p0) => {
            const out = checkPhoneCode(p0, { nowMs: now(), codeOk: matches(p0) });
            return { next: out.next, result: out.outcome };
          });
        } catch (e) {
          if (e.code === '23505') return send(res, 409, { error: 'phone already used by another account' });
          throw e;
        }
        if (outcome === 'ok') return send(res, 200, { ok: true });
        if (outcome === 'none') return send(res, 404, { error: 'no code requested' });
        if (outcome === 'expired') return send(res, 410, { error: 'code expired' });
        return send(res, 403, { error: 'wrong code' });
      }

      // ---------- отмена отложенного входа по коду из письма (аккаунт без активных устройств) ----------
      if (req.method === 'POST' && p === '/admission/cancel') {
        const email = normalizeEmail(body.email);
        const perEmail = await checkRate('deviceWaitCancelPerEmail', email);
        if (!perEmail.allowed) return send(res, 429, { error: 'too many attempts, try later' });
        const userId = await storage.userIdByEmail(email);
        const code = typeof body.code === 'string' ? body.code : '';
        const waits = userId ? await storage.deviceWaitsOf(userId) : [];
        const match = waits.find((w) => sameHex(deviceWaitCodeHash(userId, w.deviceId, code), w.cancelHash));
        if (!match) return send(res, 403, { error: 'wrong code' });
        await storage.deviceWaitDelete(userId, match.deviceId);
        return send(res, 200, { ok: true, deviceId: match.deviceId });
      }
      if (req.method === 'POST' && p === '/token/refresh') {
        const raw = typeof body.refreshToken === 'string' ? body.refreshToken : '';
        // Complete recovery actions before consuming the refresh token. The store then
        // rotates both tokens atomically and rechecks device revocation under a row lock.
        const deviceKey = raw ? await storage.refreshTokenDevice(raw, now()) : null;
        if (deviceKey) {
          const before = await storage.deviceRecord(deviceKey);
          if (before) await finalizeRecoveryIfDue(before.userId);
        }
        const r = raw
          ? await storage.rotateSession(raw, now(), ACCESS_TTL_MS, REFRESH_TTL_MS)
          : { state: 'unknown' };
        if (r.state === 'ok') {
          const rec = await storage.deviceRecord(r.deviceKey);
          if (!rec || rec.revoked) {
            await storage.endSession(r.deviceKey);
            return send(res, 401, { error: 'device revoked', code: 'device_revoked' });
          }
          return send(res, 200, sessionBody(r, rec.deviceId));
        }
        if (r.state === 'revoked') return send(res, 401, { error: 'device revoked', code: 'device_revoked' });
        if (r.state === 'reused') {
    // Повтор старого токена обновления: сессия устройства отзывается целиком, событие уходит в журнал.
    const rec = await storage.deviceRecord(r.deviceKey);
    if (rec) await revokeDevice(rec);
    await storage.endSession(r.deviceKey);
    if (logger) logger.warn('refresh token reused: device session revoked', { event: 'refresh_reuse' });
    return send(res, 401, { error: 'refresh token reused: session revoked', code: 'refresh_reused' });
  }
  if (r.state === 'expired') return send(res, 401, { error: 'refresh token expired', code: 'refresh_expired' });
  return send(res, 401, { error: 'refresh token unknown', code: 'refresh_unknown' });
}
if (req.method === 'POST' && p === '/logout') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  await storage.endSession(key(d.userId, d.deviceId));
  await storage.deletePushToken(key(d.userId, d.deviceId));
  return send(res, 200, { ok: true });
}
if (req.method === 'POST' && p === '/files') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  if (!(await currentFlags())['files.enabled']) return send(res, 403, { error: 'feature disabled: files', code: 'feature_disabled' });
  const { kind, size, sha256: digest, roomId: forRoom } = body;
  if (!FILE_LIMITS[kind]) return send(res, 400, { error: 'unknown kind' });
  if (!Number.isInteger(size) || size <= 0 || size > FILE_LIMITS[kind]) return send(res, 413, { error: `size must be 1..${FILE_LIMITS[kind]} bytes for ${kind}` });
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) return send(res, 400, { error: 'sha256 must be 64 lowercase hex characters' });
  if (forRoom !== undefined) {
    if (typeof forRoom !== 'string') return send(res, 400, { error: 'roomId must be a string' });
    const r = await storage.getRoom(forRoom);
    if (!r) return send(res, 404, { error: 'room not found' });
    if (!r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
    if (!hasCapability(r, d.userId, 'send_messages')) return send(res, 403, { error: 'missing capability: send_messages' });
  } else if (kind !== 'avatar') return send(res, 400, { error: 'roomId is required for this kind' });
  if ((await storage.countPendingFiles(d.userId)) >= PENDING_LIMIT) return send(res, 429, { error: 'too many unfinished uploads' });
  // Квота по объёму: механизм есть; значение задаёт владелец (по умолчанию не задано).
  if (quotaBytes !== null && (await storage.bytesForOwner(d.userId)) + size > quotaBytes) return send(res, 413, { error: 'storage quota exceeded' });
  if (forRoom !== undefined) {
    const fileOrg = await storage.roomOrg(forRoom);
    const orgQuota = (await storage.orgSettings(fileOrg)).fileQuotaBytes;
    if (orgQuota !== null && (await storage.bytesForOrg(fileOrg)) + size > orgQuota) return send(res, 413, { error: 'organization storage quota exceeded', code: 'org_quota_exceeded' });
  }
  const fileId = randomBytes(16).toString('hex');
  await storage.createFile({ fileId, ownerId: d.userId, roomId: forRoom ?? null, kind, size, sha256: digest, createdAt: now() });
  const expires = now() + UPLOAD_TTL_MS;
  const path = `/objects/${fileId}?expires=${expires}&sig=${signFor('PUT', fileId, expires, size, digest)}`;
  return send(res, 200, { fileId, uploadUrl: absoluteUrl(req, path), method: 'PUT', headers: { 'content-length': String(size) }, expiresAt: new Date(expires).toISOString() });
}
const fileDone = p.match(/^\/files\/([^/]+)\/complete$/);
if (req.method === 'POST' && fileDone) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const fileId = decodeURIComponent(fileDone[1]);
  const f = await storage.getFile(fileId);
  if (!f || f.ownerId !== d.userId) return send(res, 404, { error: 'not found' });
  if (!(await storage.markFileReady(fileId, now()))) return send(res, 409, { error: 'file is not uploaded yet' });
  return send(res, 200, { fileId, status: 'ready' });
}
const fileLink = p.match(/^\/files\/([^/]+)\/url$/);
if (req.method === 'GET' && fileLink) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const fileId = decodeURIComponent(fileLink[1]);
  const f = await storage.getFile(fileId);
  if (!f) return send(res, 404, { error: 'not found' });
  if (f.roomId) {
    const r = await storage.getRoom(f.roomId);
    if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
  } else if (f.ownerId !== d.userId) return send(res, 403, { error: 'not the owner' });
  if (f.status !== 'ready') return send(res, 409, { error: 'file is not ready' });
  const expires = now() + DOWNLOAD_TTL_MS;
  return send(res, 200, { downloadUrl: absoluteUrl(req, `/objects/${fileId}?expires=${expires}&sig=${signFor('GET', fileId, expires)}`), expiresAt: new Date(expires).toISOString() });
}
if (req.method === 'GET' && p === '/devices/mine') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  return send(res, 200, { devices: await storage.listDevicesFor(d.userId) });
}
if ((req.method === 'PUT' || req.method === 'DELETE') && p === '/devices/me/push') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  if (req.method === 'DELETE') {
    await storage.deletePushToken(key(d.userId, d.deviceId));
    return send(res, 200, { registered: false });
  }
  if (!(await currentFlags())['push.enabled']) return send(res, 403, { error: 'feature disabled: push', code: 'feature_disabled' });
  const { provider, token } = body;
  if (!['fcm', 'apns'].includes(provider)) return send(res, 400, { error: 'provider must be fcm or apns' });
  if (typeof token !== 'string' || token.length < 32 || token.length > 512 || !/^[A-Za-z0-9:_.\-]+$/.test(token)) return send(res, 400, { error: 'token has an invalid form' });
  await storage.setPushToken(key(d.userId, d.deviceId), provider, token, now());
  return send(res, 200, { registered: true });
}
if (req.method === 'GET' && p === '/config') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const version = await storage.flagVersion();
  const etag = `"v${version}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    return res.end();
  }
  res.setHeader('etag', etag);
  return send(res, 200, { version, flags: await currentFlags() });
}
if (req.method === 'GET' && p === '/config/public') {
  return send(res, 200, { version: await storage.flagVersion(), flags: publicFlags(await storage.flagOverrides()) });
}
// Заявки на создание организации (шаг 5.3). Документы видят заявитель и администрация платформы (только просмотр);
// решение принимает только владелец платформы. Каждое решение и каждый просмотр администрации пишутся в журнал.
const orgReqOne = p.match(/^\/org-requests\/([^/]+)$/);
const orgReqDocs = p.match(/^\/org-requests\/([^/]+)\/documents$/);
const orgReqDoc = p.match(/^\/org-requests\/([^/]+)\/documents\/([^/]+)$/);
const orgReqDecision = p.match(/^\/org-requests\/([^/]+)\/decision$/);
if (req.method === 'POST' && p === '/org-requests') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 120) return send(res, 400, { error: 'name must be 2..120 characters' });
  const requestId = randomBytes(12).toString('hex');
  await storage.createOrgRequest({ requestId, applicantId: d.userId, name, createdAt: now() });
  return send(res, 200, { requestId, status: 'pending' });
}
if (req.method === 'GET' && p === '/org-requests') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const role = await storage.platformRoleOf(d.userId);
  return send(res, 200, { requests: await storage.listOrgRequests({ userId: d.userId, all: role === 'owner' || role === 'admin' }) });
}
if (req.method === 'GET' && orgReqOne) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const requestId = decodeURIComponent(orgReqOne[1]);
  const r = await storage.getOrgRequest(requestId);
  if (!r) return send(res, 404, { error: 'not found' });
  const role = await storage.platformRoleOf(d.userId);
  const staff = role === 'owner' || role === 'admin';
  if (r.applicantId !== d.userId && !staff) return send(res, 404, { error: 'not found' });
  if (staff && r.applicantId !== d.userId) await storage.logOrgRequest(requestId, d.userId, 'view', now());
  return send(res, 200, { request: r, documents: await storage.listOrgRequestDocuments(requestId) });
}
if (req.method === 'POST' && orgReqDocs) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const requestId = decodeURIComponent(orgReqDocs[1]);
  const r = await storage.getOrgRequest(requestId);
  if (!r || r.applicantId !== d.userId) return send(res, 404, { error: 'not found' });
  if (r.status !== 'pending') return send(res, 409, { error: 'request is already decided' });
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!['registration', 'authority', 'other'].includes(kind)) return send(res, 400, { error: 'kind must be registration, authority or other' });
  const content = typeof body.contentBase64 === 'string' ? Buffer.from(body.contentBase64, 'base64') : null;
  if (!content || content.length === 0) return send(res, 400, { error: 'contentBase64 is required' });
  if (content.length > 5 * 1024 * 1024) return send(res, 413, { error: 'document is larger than 5 MiB' });
  const docId = randomBytes(12).toString('hex');
  if (!docsKey) return send(res, 503, { error: 'document storage is not configured' });
  const objectKey = randomBytes(16).toString('hex');
  await objectStore.put(objectKey, encryptDoc(content));
  try {
    const saved = await storage.addOrgRequestDocument({ docId, requestId, kind, size: content.length, sha256: createHash('sha256').update(content).digest('hex'), objectKey, uploadedBy: d.userId, createdAt: now() });
    if (!saved.ok) {
      await objectStore.remove(objectKey).catch(() => {});
      if (saved.reason === 'already_decided') return send(res, 409, { error: 'request is already decided' });
      return send(res, 404, { error: 'not found' });
    }
  } catch (error) {
    await objectStore.remove(objectKey).catch(() => {});
    throw error;
  }
  return send(res, 200, { docId, kind, size: content.length });
}
if (req.method === 'GET' && orgReqDoc) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const requestId = decodeURIComponent(orgReqDoc[1]);
  const docId = decodeURIComponent(orgReqDoc[2]);
  const r = await storage.getOrgRequest(requestId);
  const doc = await storage.getOrgRequestDocument(docId);
  if (!r || !doc || doc.requestId !== requestId) return send(res, 404, { error: 'not found' });
  const role = await storage.platformRoleOf(d.userId);
  const staff = role === 'owner' || role === 'admin';
  if (r.applicantId !== d.userId && !staff) return send(res, 404, { error: 'not found' });
  const blob = await objectStore.get(doc.objectKey);
  const bytes = blob ? decryptDoc(blob) : null;
  if (!bytes) return send(res, 404, { error: 'not found' });
  if (staff && r.applicantId !== d.userId) await storage.logOrgRequest(requestId, d.userId, 'view', now());
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'content-disposition': 'attachment', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  return res.end(bytes);
}
if (req.method === 'POST' && orgReqDecision) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const role = await storage.platformRoleOf(d.userId);
  if (role !== 'owner') return send(res, 403, { error: 'only the platform owner decides', code: 'not_platform_owner' });
  const requestId = decodeURIComponent(orgReqDecision[1]);
  const r = await storage.getOrgRequest(requestId);
  if (!r) return send(res, 404, { error: 'not found' });
  if (r.status !== 'pending') return send(res, 409, { error: 'request is already decided' });
  if (body.decision !== 'approve' && body.decision !== 'reject') return send(res, 400, { error: 'decision must be approve or reject' });
  if (body.decision === 'reject') {
    const rejected = await storage.decideOrgRequest({ requestId, status: 'rejected', decidedBy: d.userId, decidedAt: now(), orgId: null });
    if (!rejected.ok) {
      if (rejected.reason === 'forbidden') return send(res, 403, { error: 'only the platform owner decides', code: 'not_platform_owner' });
      if (rejected.reason === 'not_found') return send(res, 404, { error: 'not found' });
      return send(res, 409, { error: 'request was already decided' });
    }
    return send(res, 200, { status: 'rejected' });
  }
  const approved = await storage.approveOrgRequest({ requestId, decidedBy: d.userId, decidedAt: now() });
  if (!approved.ok) {
    if (approved.reason === 'forbidden') return send(res, 403, { error: 'only the platform owner decides', code: 'not_platform_owner' });
    if (approved.reason === 'not_found') return send(res, 404, { error: 'not found' });
    return send(res, 409, { error: 'request was already decided' });
  }
  return send(res, 200, { status: 'approved', orgId: approved.orgId });
}
// Управление организацией (шаг 5.4). Роли: владелец, администратор, участник. Владелец меняет роли;
// владелец и администратор добавляют и удаляют участников (администратор — только обычных); выход снимает доступ к комнатам организации.
const orgMembersRoute = p.match(/^\/orgs\/([^/]+)\/members$/);
const orgMemberRoute = p.match(/^\/orgs\/([^/]+)\/members\/([^/]+)$/);
const orgRoleRoute = p.match(/^\/orgs\/([^/]+)\/members\/([^/]+)\/role$/);
const orgLeaveRoute = p.match(/^\/orgs\/([^/]+)\/leave$/);
if (req.method === 'GET' && orgMembersRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgMembersRoute[1]);
  if (!(await storage.orgRoleOf(orgId, d.userId))) return send(res, 404, { error: 'not found' });
  return send(res, 200, { members: await storage.listOrgMembers(orgId) });
}
if (req.method === 'POST' && orgMembersRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgMembersRoute[1]);
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const role = typeof body.role === 'string' ? body.role : 'member';
  if (!['owner', 'admin', 'member'].includes(role)) return send(res, 400, { error: 'role must be owner, admin or member' });
  const added = await storage.addOrgMemberWithAudit({ orgId, userId, role, actorId: d.userId, at: now() });
  if (!added.ok) {
    if (added.reason === 'not_found') return send(res, 404, { error: 'organization not found' });
    if (added.reason === 'not_approved') return send(res, 403, { error: 'organization is not approved', code: 'org_not_approved' });
    if (added.reason === 'unknown_user') return send(res, 404, { error: 'unknown user' });
    if (added.reason === 'already_member') return send(res, 409, { error: 'already a member' });
    if (added.reason === 'invalid_role') return send(res, 400, { error: 'role must be owner, admin or member' });
    return send(res, 403, { error: 'org role required to add this member', code: 'org_role_required' });
  }
  return send(res, 200, { userId, role });
}
if (req.method === 'POST' && orgRoleRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgRoleRoute[1]);
  const userId = decodeURIComponent(orgRoleRoute[2]);
  const role = body.role;
  if (!['owner', 'admin', 'member'].includes(role)) return send(res, 400, { error: 'role must be owner, admin or member' });
  const changed = await storage.changeOrgMemberRole({ orgId, userId, actorId: d.userId, role, at: now() });
  if (!changed.ok) {
    if (changed.reason === 'not_found') return send(res, 404, { error: 'organization or member not found' });
    if (changed.reason === 'last_owner') return send(res, 409, { error: 'the last owner cannot be demoted', code: 'last_owner' });
    if (changed.reason === 'forbidden') return send(res, 403, { error: 'only owners change roles', code: 'org_role_required' });
    return send(res, 400, { error: 'invalid role' });
  }
  return send(res, 200, { userId, role });
}
if (req.method === 'DELETE' && orgMemberRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgMemberRoute[1]);
  const userId = decodeURIComponent(orgMemberRoute[2]);
  if (userId === d.userId) return send(res, 400, { error: 'use leave to leave the organization' });
  const removed = await storage.removeOrgMemberWithAudit({ orgId, userId, actorId: d.userId, at: now() });
  if (!removed.ok) {
    if (removed.reason === 'not_found') return send(res, 404, { error: 'not found' });
    if (removed.reason === 'last_owner') return send(res, 409, { error: 'the last owner cannot be removed', code: 'last_owner' });
    if (removed.reason === 'owns_rooms') return send(res, 409, { error: 'transfer ownership of the rooms first', code: 'owns_rooms' });
    return send(res, 403, { error: 'org role required to remove this member', code: 'org_role_required' });
  }
  return send(res, 200, { removed: true });
}
if (req.method === 'POST' && orgLeaveRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgLeaveRoute[1]);
  const left = await storage.removeOrgMemberWithAudit({ orgId, userId: d.userId, actorId: d.userId, at: now(), leave: true });
  if (!left.ok) {
    if (left.reason === 'not_found' || left.reason === 'not_member') return send(res, 404, { error: 'not found' });
    if (left.reason === 'last_owner') return send(res, 409, { error: 'the last owner cannot leave', code: 'last_owner' });
    if (left.reason === 'owns_rooms') return send(res, 409, { error: 'transfer ownership of the rooms first', code: 'owns_rooms' });
    return send(res, 403, { error: 'cannot leave this organization' });
  }
  return send(res, 200, { left: true });
}
// Настройки организации (шаг 5.5): меняют владелец и администратор; каждое изменение пишется в журнал.
const orgSettingsRoute = p.match(/^\/orgs\/([^/]+)\/settings$/);
const orgSettingsLogRoute = p.match(/^\/orgs\/([^/]+)\/settings\/log$/);
const ORG_SETTING_FIELDS = ['maxGroupMembers', 'channelsEnabled', 'fileQuotaBytes'];
if (req.method === 'GET' && orgSettingsRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgSettingsRoute[1]);
  if (!(await storage.orgRoleOf(orgId, d.userId))) return send(res, 404, { error: 'not found' });
  return send(res, 200, { settings: await storage.orgSettings(orgId) });
}
if (req.method === 'POST' && orgSettingsRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgSettingsRoute[1]);
  const status = await storage.orgStatus(orgId);
  if (status === null) return send(res, 404, { error: 'not found' });
  if (status !== 'approved') return send(res, 403, { error: 'organization is not approved', code: 'org_not_approved' });
  const myRole = await storage.orgRoleOf(orgId, d.userId);
  if (myRole !== 'owner' && myRole !== 'admin') return send(res, 403, { error: 'only owners and admins change settings', code: 'org_role_required' });
  const field = body.field;
  if (!ORG_SETTING_FIELDS.includes(field)) return send(res, 400, { error: 'field must be maxGroupMembers, channelsEnabled or fileQuotaBytes' });
  const value = body.value;
  const globalMax = (await currentFlags())['groups.maxMembers'];
  if (field === 'maxGroupMembers' && value !== null && (!Number.isInteger(value) || value < 2 || value > globalMax)) return send(res, 400, { error: `maxGroupMembers must be 2..${globalMax} or null` });
  if (field === 'channelsEnabled' && typeof value !== 'boolean') return send(res, 400, { error: 'channelsEnabled must be true or false' });
  if (field === 'fileQuotaBytes' && value !== null && (!Number.isInteger(value) || value < 1)) return send(res, 400, { error: 'fileQuotaBytes must be a positive integer or null' });
  const updated = await storage.setOrgSetting({ orgId, field, value, actor: d.userId, at: now() });
  if (!updated.ok) {
    if (updated.reason === 'not_found') return send(res, 404, { error: 'not found' });
    return send(res, 403, { error: 'only owners and admins change settings', code: 'org_role_required' });
  }
  return send(res, 200, { settings: await storage.orgSettings(orgId) });
}
if (req.method === 'GET' && orgSettingsLogRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgSettingsLogRoute[1]);
  const myRole = await storage.orgRoleOf(orgId, d.userId);
  if (myRole !== 'owner' && myRole !== 'admin') return send(res, 403, { error: 'only owners and admins read the log', code: 'org_role_required' });
  return send(res, 200, { log: await storage.listOrgSettingsLog(orgId) });
}
// Связи между организациями (шаг 5.6): предлагает администратор одной стороны, принимает администратор другой; отзывает любая сторона.
const orgLinksRoute = p.match(/^\/orgs\/([^/]+)\/links$/);
const orgLinkActRoute = p.match(/^\/orgs\/([^/]+)\/links\/([^/]+)\/(accept|revoke)$/);
if (req.method === 'GET' && orgLinksRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgLinksRoute[1]);
  const myRole = await storage.orgRoleOf(orgId, d.userId);
  if (myRole !== 'owner' && myRole !== 'admin') return send(res, 403, { error: 'only owners and admins read links', code: 'org_role_required' });
  return send(res, 200, { links: await storage.orgLinksFor(orgId) });
}
if (req.method === 'POST' && orgLinksRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgLinksRoute[1]);
  const target = typeof body.targetOrgId === 'string' ? body.targetOrgId : '';
  if (!target || target === orgId) return send(res, 400, { error: 'targetOrgId must be another organization' });
  const myRole = await storage.orgRoleOf(orgId, d.userId);
  if (myRole !== 'owner' && myRole !== 'admin') return send(res, 403, { error: 'only owners and admins propose links', code: 'org_role_required' });
  if ((await storage.orgStatus(orgId)) !== 'approved' || (await storage.orgStatus(target)) !== 'approved') return send(res, 403, { error: 'both organizations must be approved', code: 'org_not_approved' });
  const linkId = randomBytes(12).toString('hex');
  const created = await storage.createOrgLink({ linkId, proposingOrg: orgId, otherOrg: target, proposedBy: d.userId, createdAt: now() });
  if (!created.ok) {
    if (created.reason === 'already_exists') return send(res, 409, { error: 'a link already exists', code: 'link_exists' });
    if (created.reason === 'not_found') return send(res, 404, { error: 'organization not found' });
    if (created.reason === 'not_approved') return send(res, 403, { error: 'both organizations must be approved', code: 'org_not_approved' });
    return send(res, 403, { error: 'only owners and admins propose links', code: 'org_role_required' });
  }
  return send(res, 200, { linkId, status: 'proposed' });
}
if (req.method === 'POST' && orgLinkActRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgLinkActRoute[1]);
  const linkId = decodeURIComponent(orgLinkActRoute[2]);
  const action = orgLinkActRoute[3];
  const myRole = await storage.orgRoleOf(orgId, d.userId);
  if (myRole !== 'owner' && myRole !== 'admin') return send(res, 403, { error: 'only owners and admins decide links', code: 'org_role_required' });
  const link = await storage.getOrgLink(linkId);
  if (!link || (link.orgA !== orgId && link.orgB !== orgId)) return send(res, 404, { error: 'not found' });
  if (action === 'accept') {
    if (link.status !== 'proposed') return send(res, 409, { error: 'link is not waiting for acceptance' });
    if (link.proposingOrg === orgId) return send(res, 403, { error: 'the proposing side cannot accept its own link', code: 'link_own_side' });
    const transitioned = await storage.transitionOrgLinkStatus({
      linkId, orgId, fromStatus: 'proposed', status: 'active', decidedBy: d.userId, decidedAt: now(),
    });
    if (!transitioned.ok) {
      if (transitioned.reason === 'forbidden') return send(res, 403, { error: 'only owners and admins decide links', code: 'org_role_required' });
      if (transitioned.reason === 'not_found') return send(res, 404, { error: 'not found' });
      if (transitioned.reason === 'wrong_side') return send(res, 403, { error: 'the proposing side cannot accept its own link', code: 'link_own_side' });
      return send(res, 409, { error: 'link is not waiting for acceptance' });
    }
    return send(res, 200, { status: 'active' });
  }
  if (link.status === 'revoked') return send(res, 409, { error: 'link is already revoked' });
  const transitioned = await storage.transitionOrgLinkStatus({
    linkId, orgId, fromStatus: link.status, status: 'revoked', decidedBy: d.userId, decidedAt: now(),
  });
  if (!transitioned.ok) {
    if (transitioned.reason === 'forbidden') return send(res, 403, { error: 'only owners and admins decide links', code: 'org_role_required' });
    if (transitioned.reason === 'not_found') return send(res, 404, { error: 'not found' });
    return send(res, 409, { error: 'link state changed; reload and retry' });
  }
  return send(res, 200, { status: 'revoked' });
}
// Журнал действий администраторов (шаг 5.7): читают владелец и администратор организации. Содержимое комнат сюда не попадает.
const orgAdminLogRoute = p.match(/^\/orgs\/([^/]+)\/admin-log$/);
if (req.method === 'GET' && orgAdminLogRoute) {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  const orgId = decodeURIComponent(orgAdminLogRoute[1]);
  const myRole = await storage.orgRoleOf(orgId, d.userId);
  if (myRole !== 'owner' && myRole !== 'admin') return send(res, 403, { error: 'only owners and admins read the admin log', code: 'org_role_required' });
  return send(res, 200, { actions: await storage.listAdminActions(orgId) });
}
// Организации текущего пользователя (шаг 5.9): для выбора организации в клиенте; только свои членства.
if (req.method === 'GET' && p === '/orgs/mine') {
  const d = await authed(req);
  if (!d) return send(res, 401, { error: 'unauthorized' });
  return send(res, 200, { orgs: await storage.listUserOrgs(d.userId) });
}
if (req.method === 'POST' && p === '/login') {
        // Вход по почте (подтверждённый аккаунт) или по внутреннему идентификатору (режим open и старые аккаунты).
        const loginEmail = normalizeEmail(body.email);
        const userId = body.userId ?? ((loginEmail && (await storage.userIdByEmail(loginEmail))) || loginEmail);
        const { password, deviceId, label, platform, identityCode, proof: providerProof } = body;
        const stored = await storage.accountHash(userId);
        // Вход через Google или Apple: одноразовое подтверждение провайдера вместо пароля (этап 2).
        let providerOk = null;
        if (typeof providerProof === 'string' && providerProof !== '') {
          const spent = await storage.consumeAuthToken('provider-proof', authTokenHash('provider-proof', providerProof), now());
          providerOk = !!spent && spent.userId === userId && !!stored;
        }
        // Одинаковый ответ и одинаковое время для неизвестного логина и для неверного пароля (C-04):
        // проверка идёт через scrypt всегда, для неизвестного логина — против фиктивного хэша.
        const candidate = typeof password === 'string' ? password : '';
        const source = clientIp(req);
        // Защита входа (D7): задержки по паре «адрес и логин», ограничение адреса, уведомление владельцу.
        // После привязки Google или Apple пароль не принимается (решение владельца).
        const linkedCount = (await storage.providerLinksOf(userId)).length;
        const verdict = await storage.throttledLogin({
          pairKey: `pair|${source}|${userId}`,
          sourceKey: `src|${source}`,
          loginKey: `login|${userId}`,
          now: now(),
          verify: () => (providerOk !== null ? providerOk : checkPassword(candidate, stored ?? DUMMY_PASSWORD_HASH) && !!stored && typeof password === 'string' && linkedCount === 0),
          policy: LOGIN_POLICY,
          notify: !!stored,
        });
        if (verdict.status === 'throttled') {
          return send(res, 429, { error: 'too many attempts', retryAt: new Date(verdict.retryAt).toISOString() });
        }
        if (verdict.status === 'wrong') {
          // Владельцу — уведомление после нескольких неудач, без блокировки входа.
          if (verdict.notify) await alertDevices(userId, { kind: 'login_failures' });
          return send(res, 401, { error: 'wrong credentials' });
        }
        if (!deviceId) return send(res, 400, { error: 'deviceId required' });
        const dk = key(userId, deviceId);
        const existing = await storage.deviceRecord(dk);
        if (existing?.revoked) return send(res, 403, { error: 'device revoked; log in with a new device id' });

        // Новое устройство в аккаунте с уже активными устройствами: нужен код с одного из них.
        // Окно восстановления и первый вход после него (D1, D5, D8).
        await finalizeRecoveryIfDue(userId);
        const rec = await storage.recoveryGet(userId);
        let identityPassed = false;
        // Аккаунт без подтверждённого телефона: в окне 48 часов новое устройство не добавляется, даже с кодом с почты (решение владельца).
        if (!existing && windowOpen(rec, now()) && !(await storage.phoneGet(userId)).verified) {
          return send(res, 403, { error: 'new devices can be added after the recovery window closes' });
        }
        if (!existing && rec.identityCheck) {
          if (identityCode === undefined) {
            // Repeated login requests must not bypass the five-attempt code lock by
            // issuing unlimited fresh six-digit identity codes.
            const identityRate = await checkRate('identityCodePerAccount', userId);
            if (!identityRate.allowed) {
              return send(res, 429, { error: 'too many identity codes, try later', retryAt: new Date(identityRate.retryAt).toISOString() });
            }
            const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
            await storage.recoveryUpdate(userId, (r) => ({ next: issueIdentity(r, { codeHash: identityCodeHash(userId, code) }), result: null }));
            await mail(userId, 'Подтверждение входа после восстановления',
              `Код: ${code}. Введите его, чтобы войти с нового устройства. Если это не вы — отмените восстановление с устройства, которое существовало до запроса.`);
            return send(res, 202, { status: 'identity_check_required' });
          }
          const outcome = await storage.recoveryUpdate(userId, (r) => {
            const out = checkIdentity(r, {
              codeOk: typeof identityCode === 'string' && !!r.identityCodeHash && sameHex(identityCodeHash(userId, identityCode), r.identityCodeHash),
            });
            return { next: out.next, result: out.outcome };
          });
          if (outcome !== 'ok') return send(res, 403, { error: 'wrong identity code' });
          identityPassed = true;
        }
        // В окне восстановления новые устройства не добавляются, кроме первого входа по коду (D8).
        if (!existing && !identityPassed && windowOpen(rec, now())) {
          return send(res, 403, { error: 'new devices can be added after the recovery window closes' });
        }
        // Все устройства аккаунта отключены, а вход с нового устройства — только по почте: ждём 48 часов (решение владельца).
        // Аккаунт с привязкой Google или Apple и аккаунт без устройств в истории пускаются сразу.
        if (!existing && !identityPassed && (await storage.devicesOfUser(userId)).length > 0
            && (await activeCount(userId)) === 0 && (await storage.providerLinksOf(userId)).length === 0) {
          const waiting = await storage.deviceWaitGet(userId, deviceId);
          if (!waiting) {
            const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
            const activateAt = now() + DEVICE_WAIT_MS;
            await storage.deviceWaitCreate({ userId, deviceId, label: label ?? null, platform: platform ?? null,
              activateAt, cancelHash: deviceWaitCodeHash(userId, deviceId, code), createdAt: now() });
            await mail(userId, 'Вход с нового устройства: ожидание 48 часов',
              `Вход с нового устройства откроется ${new Date(activateAt).toISOString()}. Если это не вы, отмените вход кодом ${code} (POST /admission/cancel).`);
            return send(res, 202, { status: 'waiting_period', activateAt: new Date(activateAt).toISOString() });
          }
          if (waiting.activateAt > now()) {
            return send(res, 202, { status: 'waiting_period', activateAt: new Date(waiting.activateAt).toISOString() });
          }
        }
        if (!existing && !identityPassed && (await activeCount(userId)) > 0) {
          const id = randomUUID();
          const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
          const pollSecret = randomBytes(32).toString('base64url');
          const created = await storage.createApproval({
            id, userId, deviceId, label: label ?? null, platform: platform ?? null,
            codeHash: sha(`${id}:${code}`), pollHash: sha(pollSecret),
            status: 'pending', attempts: 0, createdAt: now(), expiresAt: now() + APPROVAL_TTL_MS,
          }, { max: MAX_PENDING_APPROVALS, now: now() });
          if (!created) return send(res, 429, { error: 'too many pending sign-in requests' });
          await alertDevices(userId, { kind: 'device_approval_requested', deviceLabel: label ?? null, platform: platform ?? null });
          // Код показывается на новом устройстве. Владелец вводит его на старом.
          return send(res, 202, { status: 'approval_required', approvalId: id, code, pollSecret });
        }

        if (!existing) {
          await storage.addDevice(userId, deviceId, label ?? null, now());
        }
        await storage.deviceWaitDelete(userId, deviceId);
        return send(res, 200, sessionBody(await issueSession(dk), deviceId));
      }

      // ---------- подтверждение входа с нового устройства ----------
      if (req.method === 'GET' && p === '/approvals') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const list = (await storage.listPendingApprovals(d.userId, now())).map((a) => ({
          id: a.id, label: a.label, platform: a.platform,
          createdAt: new Date(a.createdAt).toISOString(), expiresAt: new Date(a.expiresAt).toISOString(),
        }));
        return send(res, 200, { approvals: list });
      }

      const ap = p.match(/^\/approvals\/([^/]+)\/(approve|deny|claim)$/);
      if (ap && req.method === 'POST') {
        const [, id, action] = ap;

        if (action === 'claim') {
          // Новое устройство забирает результат по своему секрету. Один раз.
          const r = await storage.readApprovalForClaim(id, sha(body.pollSecret ?? ''), now());
          if (r.status === 'unknown') return send(res, 404, { error: 'unknown request' });
          if (r.status === 'denied') return send(res, 200, { status: 'denied' });
          if (r.status === 'expired') return send(res, 200, { status: 'expired' });
          if (r.status === 'pending') return send(res, 200, { status: 'pending' });
          const dk = key(r.userId, r.deviceId);
          const existing = await storage.deviceRecord(dk);
          if (existing?.revoked) return send(res, 403, { error: 'device revoked' });
          // Результат выдаётся один раз: побеждает только тот запрос, который первым переведёт запись в consumed.
          if (!(await storage.consumeApproval(id))) return send(res, 404, { error: 'unknown request' });
          if (!existing) {
            await storage.addDevice(r.userId, r.deviceId, r.label, now());
          }
          return send(res, 200, { status: 'approved', ...sessionBody(await issueSession(dk), r.deviceId) });
        }

        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        // Устройство с биометрическим ключом одобряет новое устройство только с подтверждением биометрией (этап 2б).
        if (action === 'approve' && (await storage.signingKeyGet(key(d.userId, d.deviceId)))) {
          if (!(await consumeBioGrant(d.userId, 'approve-device', body.bioGrant, d.deviceId))) {
            return send(res, 403, { error: 'biometric confirmation required to approve a device' });
          }
        }
        const decision = await storage.decideApproval(id, d.userId, action, {
          now: now(),
          codeMatches: (codeHash) => sameHex(sha(`${id}:${body.code ?? ''}`), codeHash),
          max: MAX_APPROVAL_CODE_ATTEMPTS,
        });
        if (decision.status === 'unknown') return send(res, 404, { error: 'unknown request' });
        if (action === 'deny') {
          await alertDevices(d.userId, { kind: 'device_denied', deviceLabel: decision.label });
          return send(res, 200, { ok: true });
        }
        if (decision.status === 'wrong') {
          if (decision.denied) await alertDevices(d.userId, { kind: 'device_denied', deviceLabel: decision.label });
          return send(res, 403, { error: 'wrong code' });
        }
        await alertDevices(d.userId, { kind: 'device_approved', deviceLabel: decision.label });
        return send(res, 200, { ok: true });
      }

      // ---------- PIN ----------
      if (req.method === 'POST' && p === '/pin/set') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const pin = String(body.pin ?? '');
        const weak = weakPinReason(pin);
        if (weak) return send(res, 400, { error: weak });
        if (await storage.hasPin(d.userId)) {
          const r = await verifyPin(d.userId, String(body.currentPin ?? ''));
          if (!r.ok) return pinError(res, r);
        }
        await storage.setPin(d.userId, hashPin(pinPepper, pin));
        await alertDevices(d.userId, { kind: 'pin_changed' });
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/pin/remove') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const r = await verifyPin(d.userId, String(body.currentPin ?? ''));
        if (!r.ok) return pinError(res, r);
        await storage.removePin(d.userId);
        await alertDevices(d.userId, { kind: 'pin_removed' });
        return send(res, 200, { ok: true });
      }

      // ---------- устройства ----------
      if (req.method === 'GET' && p === '/devices') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const list = (await storage.devicesOfUser(d.userId)).filter((x) => !x.revoked).map((x) => ({ deviceId: x.deviceId, label: x.label }));
        return send(res, 200, { devices: list });
      }

      const dev = p.match(/^\/devices\/([^/]+)$/);
      if (dev && req.method === 'DELETE') {
        const me = await authed(req);
        if (!me) return send(res, 401, { error: 'unauthorized' });
        const target = await storage.deviceRecord(key(me.userId, decodeURIComponent(dev[1])));
        if (!target || target.revoked) return send(res, 404, { error: 'unknown device' });
        await revokeDevice(target);
        await markChanged(me.userId);
        return send(res, 200, { ok: true });
      }

      // ---------- ключи шифрования ----------
      if (req.method === 'POST' && p === '/keys/upload') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const k = key(d.userId, d.deviceId);
        if (body.device_keys) {
          const dk = body.device_keys;
          // Нельзя загрузить ключи от имени другого пользователя или устройства.
          if (dk.user_id !== d.userId || dk.device_id !== d.deviceId) {
            return send(res, 403, { error: 'device keys belong to another device' });
          }
          await storage.putDeviceKeys(k, dk);
        }
        await storage.addOneTimeKeys(k, body.one_time_keys || {});
        const remaining = await storage.countOneTimeKeys(k, 'signed_curve25519:');
        await markChanged(d.userId);
        return send(res, 200, { one_time_key_counts: { signed_curve25519: remaining } });
      }

      if (req.method === 'POST' && p === '/keys/query') {
        if (!(await authed(req))) return send(res, 401, { error: 'unauthorized' });
        const out = {};
        for (const user of Object.keys(body.device_keys || {})) out[user] = await storage.queryDeviceKeys(user);
        return send(res, 200, { device_keys: out, failures: {} });
      }

      if (req.method === 'POST' && p === '/keys/claim') {
        const claimer = await authed(req);
        if (!claimer) return send(res, 401, { error: 'unauthorized' });
        const out = {};
        for (const [user, devs] of Object.entries(body.one_time_keys || {})) {
          if (!(await sharesOrgOrLink(claimer.userId, user))) { out[user] = {}; continue; }
          out[user] = {};
          for (const dev2 of Object.keys(devs)) {
            const claimed = await storage.claimOneTimeKey(key(user, dev2)); // одноразовый ключ выдаётся один раз
            if (claimed) out[user][dev2] = claimed;
          }
        }
        return send(res, 200, { one_time_keys: out, failures: {} });
      }

      if (req.method === 'PUT' && p.startsWith('/sendToDevice/')) {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const [, , rawType = '', rawTxn = ''] = p.split('/');
        const type = decodeURIComponent(rawType);
        const txn = decodeURIComponent(rawTxn);
        // Повтор с тем же номером (клиент не получил ответ) не создаёт второй копии (C-05).
        if (txn && !(await storage.recordSend(key(d.userId, d.deviceId), type, txn, now(), SEND_DEDUP_MS))) {
          return send(res, 200, {});
        }
        for (const [user, devs] of Object.entries(body.messages || {})) {
          for (const [dev2, content] of Object.entries(devs)) {
            const k2 = key(user, dev2);
            const target = await storage.deviceRecord(k2);
            if (!target || target.revoked) continue; // отключённым устройствам не доставляем
            // Событие получает номер и срок хранения: без подтверждения оно удаляется через 30 дней (C-05).
            await storage.enqueue(k2, 'to_device', { type, sender: d.userId, content }, null, now() + TO_DEVICE_TTL_MS);
          }
        }
        return send(res, 200, {});
      }

      if (req.method === 'GET' && p === '/sync') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const number = (name) => {
          const raw = url.searchParams.get(name) ?? '0';
          return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
        };
        const acked = number('since');               // подтверждённые события доставки (C-05)
        const signalAcked = number('signal_since');  // подтверждённые сигналы (C-20)
        if (acked === null || signalAcked === null) {
          return send(res, 400, { error: 'since and signal_since must be non-negative integers' });
        }
        const k = key(d.userId, d.deviceId);
        // Каждый поток подтверждается своим номером. Подтверждённое и истёкшее удаляет хранилище; остальное отдаётся снова.
        // Подтверждение не выше того, что сервер уже отдал устройству: иначе неполученные сигналы пропадают.
        const deliveredTo = await storage.deliveredMax(k, 'to_device');
        const deliveredSignal = await storage.deliveredMax(k, 'signal');
        const queued = await storage.drainQueue(k, Math.min(acked, deliveredTo), Math.min(signalAcked, deliveredSignal), now());
        const events = queued.map((e) => ({ id: e.id, stream: e.stream, dedupeKey: e.dedupeKey, ...e.body }));
        const toDevice = events.filter((e) => e.stream === 'to_device');
        const signals = events.filter((e) => e.stream !== 'to_device');
        // Отмечаем, что отдано в этом ответе: подтверждения принимаются только до этой отметки.
        await storage.markDelivered(k, 'to_device', toDevice.reduce((m, e) => Math.max(m, Number(e.id)), 0));
        await storage.markDelivered(k, 'signal', signals.reduce((m, e) => Math.max(m, Number(e.id)), 0));
        const last = (list, fallback) => String(list.length ? list.at(-1).id : fallback);
        const wireSignal = (e) => {
          if (e.stream === 'security') return { id: e.id, stream: e.stream, body: e.body };
          if (e.stream === 'device_list') return { id: e.id, stream: e.stream, userId: e.userId };
          return { id: e.id, stream: e.stream, roomId: e.roomId };
        };
        const uniq = (list) => [...new Set(list)];
        const count = await storage.countOneTimeKeys(k, 'signed_curve25519:');
        return send(res, 200, {
          to_device: {
            events: toDevice.map(({ id, type, sender, content }) => ({ id, type, sender, content })),
            next_batch: last(toDevice, acked),
          },
          signals: { items: signals.map(wireSignal), next_batch: last(signals, signalAcked) },
          device_one_time_keys_count: { signed_curve25519: count },
          // Прежние поля, оставлены для совместимости с версией 0.5.x. Новому клиенту они не нужны.
          security: signals.filter((e) => e.stream === 'security').map((e) => e.body),
          device_lists: { changed: uniq(signals.filter((e) => e.stream === 'device_list').map((e) => e.userId)), left: [] },
          rooms: { changed: uniq(signals.filter((e) => e.stream === 'room').map((e) => e.roomId)) },
        });
      }

      // ---------- беседы и участники ----------
      if (req.method === 'POST' && p === '/rooms') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = String(body.roomId ?? '');
        if (!roomId) return send(res, 400, { error: 'roomId required' });
        if (await storage.getRoom(roomId)) return send(res, 409, { error: 'room exists' });
        const kindParam = body.kind ?? 'group';
        if (!['group', 'channel'].includes(kindParam)) return send(res, 400, { error: 'kind must be group or channel' });
        let roomName = null;
        if (body.name !== undefined && body.name !== null) {
          const checkedName = normalizeRoomName(body.name);
          if (checkedName.error) return send(res, 400, { error: checkedName.error });
          roomName = checkedName.value;
        }
        if (kindParam === 'channel' && !(await storage.orgSettings(typeof body.orgId === 'string' ? body.orgId : 'org-default')).channelsEnabled) return send(res, 403, { error: 'channels are disabled for this organization', code: 'org_channels_disabled' });
        if (kindParam === 'channel' && !(await currentFlags())['channels.enabled']) return send(res, 403, { error: 'feature disabled: channels', code: 'feature_disabled' });
        if (kindParam === 'channel') {
          if (!roomName) return send(res, 400, { error: 'a channel needs a name' });
          if (await storage.channelNameTaken(roomName, null)) return send(res, 409, { error: 'channel name is taken' });
        }

        const orgId = typeof body.orgId === 'string' ? body.orgId : 'org-default';
        const memberSet = new Set([d.userId, ...(body.members || [])]);
        for (const m of memberSet) {
          if (!(await storage.hasAccount(m))) return send(res, 404, { error: `unknown user ${m}` });
        }
        for (const m of memberSet) {
          const creatorGate = await orgGate(m, orgId);
          if (creatorGate) return send(res, creatorGate.status, { error: creatorGate.error, code: creatorGate.code });
        }
        // Для каждого участника запоминается номер события, с которого он видит беседу (C-07).
        let created;
        try {
          created = await storage.createRoom(roomId, d.userId, [...memberSet], { kind: kindParam, name: roomName, orgId });
        } catch (e) {
          if (e.code === '23505') return send(res, 409, { error: 'channel name is taken' });
          throw e;
        }
        if (!created) return send(res, 409, { error: 'room exists' });
        await markRoomChanged(roomId, [...memberSet]);
        return send(res, 200, { roomId });
      }

      // Название комнаты: владелец меняет его. У канала название уникально, у группы может повторяться.
      const nameRoute = p.match(/^\/rooms\/([^/]+)\/name$/);
      if (nameRoute && req.method === 'PUT') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(nameRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r) return send(res, 404, { error: 'room not found' });
        if (d.userId !== r.owner) return send(res, 403, { error: 'only the owner can rename the room' });
        const checkedName = normalizeRoomName(body.name);
        if (checkedName.error) return send(res, 400, { error: checkedName.error });
        if ((await storage.roomKind(roomId)) === 'channel' && (await storage.channelNameTaken(checkedName.value, roomId))) {
          return send(res, 409, { error: 'channel name is taken' });
        }
        try {
          await storage.setRoomName(roomId, checkedName.value);
        } catch (e) {
          if (e.code === '23505') return send(res, 409, { error: 'channel name is taken' });
          throw e;
        }
        await markRoomChanged(roomId, r.members);
        return send(res, 200, { name: checkedName.value });
      }

      const memberRoute = p.match(/^\/rooms\/([^/]+)\/members$/);
      if (memberRoute && req.method === 'GET') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const r = await storage.getRoom(decodeURIComponent(memberRoute[1]));
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        const capabilities = Object.fromEntries(r.members.map((m) => [m, [...effectiveCapabilities(r, m)].sort()]));
        const readUpTo = Object.fromEntries(Object.entries(r.readUpTo).map(([u, s]) => [u, s > 0 ? `$${s}` : null]));
        // Файлы, которые ждут замены под текущий вид группы: видны только участникам в этом списке.
        const pending = [];
        for (const key of ['avatarAssetId', 'coverAssetId', 'backgroundAssetId']) {
          if (!r[key]) continue;
          const asset = await storage.getRoomAsset(decodeURIComponent(memberRoute[1]), r[key]);
          if (asset && !assetMatchesVisibility(asset, r)) pending.push(r[key]);
        }
        const appearance = { description: r.description, backgroundColor: r.backgroundColor, avatarAssetId: r.avatarAssetId, coverAssetId: r.coverAssetId, backgroundAssetId: r.backgroundAssetId, pending };
        return send(res, 200, { owner: r.owner, admins: r.admins, members: r.members, capabilities, name: r.name, visibility: r.visibility, join_policy: r.joinPolicy, read_upto: readUpTo, appearance });
      }
      if (memberRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(memberRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'invite_members')) {
          return send(res, 403, { error: 'missing capability: invite_members' });
        }
        const userId = String(body.userId ?? '');
        if (!(await storage.hasAccount(userId))) return send(res, 404, { error: 'unknown user' });
        // Новый участник видит только то, что придёт после его добавления (C-07).
        if (await groupFull(roomId)) return send(res, 409, { error: 'group is full' });
        const memberOrgId = await storage.roomOrg(roomId);
        const memberGate = await orgGate(userId, memberOrgId);
        if (memberGate) return send(res, memberGate.status, { error: memberGate.error, code: memberGate.code });
        await storage.addRoomMember(roomId, userId);
        await markRoomChanged(roomId, (await storage.getRoom(roomId)).members);
        return send(res, 200, { ok: true });
      }

      const roleRoute = p.match(/^\/rooms\/([^/]+)\/roles$/);
      if (roleRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(roleRoute[1]);
        const r = await storage.getRoom(roomId);
        // Роли назначает только владелец.
        if (!r || r.owner !== d.userId) return send(res, 403, { error: 'only the owner can change roles' });
        const target = String(body.userId ?? '');
        if (!r.members.includes(target)) return send(res, 404, { error: 'not a member' });
        if (target === r.owner) return send(res, 409, { error: 'owner role cannot be changed' });
        if (body.role !== 'admin' && body.role !== 'member') return send(res, 400, { error: 'role must be admin or member' });
        await storage.setRoomAdmin(roomId, target, body.role === 'admin');
        return send(res, 200, { ok: true });
      }

      const capsRoute = p.match(/^\/rooms\/([^/]+)\/capabilities$/);
      if (capsRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(capsRoute[1]);
        const r = await storage.getRoom(roomId);
        // Права выдаёт и отбирает только владелец.
        if (!r || r.owner !== d.userId) return send(res, 403, { error: 'only the owner can change capabilities' });
        const target = String(body.userId ?? '');
        if (!r.members.includes(target)) return send(res, 404, { error: 'not a member' });
        if (target === r.owner) return send(res, 409, { error: 'owner has all capabilities' });
        const list = normalizeCapabilities(body.capabilities);
        if (!list) return send(res, 400, { error: 'capabilities must be a list of known capability names' });
        await storage.setRoomCapabilities(roomId, target, list);
        return send(res, 200, { ok: true, capabilities: list });
      }

      const memberOne = p.match(/^\/rooms\/([^/]+)\/members\/([^/]+)$/);
      // Передача владения: только текущий владелец; новым владельцем становится участник группы.
      const ownerRoute = p.match(/^\/rooms\/([^/]+)\/owner$/);
      if (ownerRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(ownerRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r) return send(res, 404, { error: 'group not found' });
        if (d.userId !== r.owner) return send(res, 403, { error: 'only the owner can transfer ownership' });
        const target = typeof body?.userId === 'string' ? body.userId : '';
        if (!target || target === r.owner) return send(res, 400, { error: 'userId of another member is required' });
        if (!r.members.includes(target)) return send(res, 400, { error: 'new owner must be a member of the group' });
        await storage.transferRoomOwner(roomId, target);
        await markRoomChanged(roomId, r.members);
        return send(res, 200, { owner: target });
      }
      if (memberOne && req.method === 'DELETE') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(memberOne[1]);
        const target = decodeURIComponent(memberOne[2]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(target)) return send(res, 404, { error: 'not a member' });
        if (target === r.owner) return send(res, 409, { error: 'owner cannot be removed' });
        const isOwner = d.userId === r.owner;
        const isSelf = d.userId === target;
        if (!isOwner && !isSelf) {
          if (!hasCapability(r, d.userId, 'remove_members')) return send(res, 403, { error: 'missing capability: remove_members' });
          if (r.admins.includes(target)) return send(res, 403, { error: 'an admin cannot remove another admin' });
        }
        await storage.removeRoomMember(roomId, target); // при повторном добавлении история начинается заново
        await markRoomChanged(roomId, r.members);       // прежние участники, включая удалённого, узнают об изменении
        return send(res, 200, { ok: true });
      }

      // Правка и удаление сообщения. Автор правит своё сообщение; удаляет своё или чужое по праву.
      // Настройки группы: название (право edit_group_name) и видимость (право edit_group_settings).
      const settingsRoute = p.match(/^\/rooms\/([^/]+)\/settings$/);
      if (settingsRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(settingsRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        const checked = validateRoomSettings(body);
        if (checked.error) return send(res, 400, { error: checked.error });
        if (checked.value.name !== undefined && !hasCapability(r, d.userId, 'edit_group_name')) {
          return send(res, 403, { error: 'missing capability: edit_group_name' });
        }
        if ((checked.value.visibility !== undefined || checked.value.joinPolicy !== undefined) && !hasCapability(r, d.userId, 'edit_group_settings')) {
          return send(res, 403, { error: 'missing capability: edit_group_settings' });
        }
        await storage.setRoomSettings(roomId, checked.value);
        // Группа стала приватной: заявки на вступление больше не действуют.
        if (checked.value.visibility === 'private') await storage.clearJoinRequests(roomId);
        return send(res, 200, { ok: true, ...checked.value });
      }

      // Отметка чтения: участник сообщает, до какого сообщения он дочитал. Позиция не откатывается.
      const readRoute = p.match(/^\/rooms\/([^/]+)\/read$/);
      if (readRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(readRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        const idMatch = /^\$(\d+)$/.exec(String(body.upTo ?? ''));
        if (!idMatch) return send(res, 400, { error: 'upTo must look like $123' });
        const seq = Number(idMatch[1]);
        if (seq > (await storage.roomLastSeq(roomId))) return send(res, 400, { error: 'upTo is ahead of the room' });
        await storage.setReadUpTo(roomId, d.userId, seq);
        return send(res, 200, { ok: true });
      }

      // Поиск публичных групп: только публичные, только по названию, без списка участников.
      // Комнаты текущего пользователя (G1, этап 0.7.3): для списка чатов. Только свои членства.
      if (req.method === 'GET' && p === '/rooms/mine') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const rows = await storage.roomsOfUser(d.userId);
        return send(res, 200, {
          rooms: rows.map((r) => ({
            roomId: r.roomId,
            kind: r.kind ?? 'group',
            name: r.name ?? null,
            role: r.owner === d.userId ? 'owner' : r.isAdmin ? 'admin' : 'member',
          })),
        });
      }
      if (req.method === 'GET' && p === '/rooms/search') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const q = (new URL(req.url, 'http://localhost').searchParams.get('q') ?? '').trim();
        if (q.length < 2 || q.length > 50) return send(res, 400, { error: 'q must be 2 to 50 characters' });
        return send(res, 200, { rooms: await storage.searchPublicRooms(q, 20) });
      }

      // Вступление в публичную группу: свободно или по заявке, как настроено в группе.
      const joinRoute = p.match(/^\/rooms\/([^/]+)\/join$/);
      if (joinRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(joinRoute[1]);
        const r = await storage.getRoom(roomId);
        // Приватная группа для постороннего не существует: тот же ответ, что и для несуществующей.
        if (!r || r.visibility !== 'public') return send(res, 404, { error: 'room not found' });
        if (r.members.includes(d.userId)) return send(res, 409, { error: 'already a member' });
        if (r.joinPolicy === 'open') {
          const joined = await storage.joinPublicRoomOpen({
            roomId,
            userId: d.userId,
            maxMembers: await effectiveMaxMembers(roomId),
          });
          if (joined.status === 'not_found' || joined.status === 'not_public') {
            return send(res, 404, { error: 'room not found' });
          }
          if (joined.status === 'not_open') return send(res, 409, { error: 'room is no longer open for joining' });
          if (joined.status === 'already_member') return send(res, 409, { error: 'already a member' });
          if (joined.status === 'org_not_approved') return send(res, 403, { error: 'organization is not approved', code: 'org_not_approved' });
          if (joined.status === 'org_not_member') return send(res, 403, { error: 'not an organization member', code: 'org_not_member' });
          if (joined.status === 'full') return send(res, 409, { error: 'group is full' });
          if (joined.status !== 'joined') throw new Error(`unexpected open-join result: ${joined.status}`);
          await markRoomChanged(roomId, joined.members);
          return send(res, 200, { status: 'joined' });
        }
        await storage.createJoinRequest(roomId, d.userId, now());
        return send(res, 200, { status: 'requested' });
      }

      // Заявки на вступление: видят и решают те, у кого есть право приглашать.
      const requestsRoute = p.match(/^\/rooms\/([^/]+)\/requests$/);
      if (requestsRoute && req.method === 'GET') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(requestsRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'invite_members')) return send(res, 403, { error: 'missing capability: invite_members' });
        return send(res, 200, { requests: await storage.listJoinRequests(roomId) });
      }

      const decideRoute = p.match(/^\/rooms\/([^/]+)\/requests\/([^/]+)\/(approve|reject)$/);
      if (decideRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(decideRoute[1]);
        const target = decodeURIComponent(decideRoute[2]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'invite_members')) return send(res, 403, { error: 'missing capability: invite_members' });
        if (decideRoute[3] === 'approve') {
          const approveOrgId = await storage.roomOrg(roomId);
          const approveGate = await orgGate(target, approveOrgId);
          if (approveGate) return send(res, approveGate.status, { error: approveGate.error, code: approveGate.code });
        }
        if (!(await storage.deleteJoinRequest(roomId, target))) return send(res, 404, { error: 'no such request' });
        if (decideRoute[3] === 'reject') return send(res, 200, { status: 'rejected' });
        if (await groupFull(roomId)) return send(res, 409, { error: 'group is full' });
        await storage.addRoomMember(roomId, target);
        await markRoomChanged(roomId, (await storage.getRoom(roomId)).members);
        return send(res, 200, { status: 'joined' });
      }

      // Ссылка-приглашение и QR-код с этой ссылкой. Право создавать и отзывать — invite_members.
      const invitesRoute = p.match(/^\/rooms\/([^/]+)\/invites$/);
      if (invitesRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(invitesRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'invite_members')) return send(res, 403, { error: 'missing capability: invite_members' });
        const checked = validateInviteOptions(body);
        if (checked.error) return send(res, 400, { error: checked.error });
        const token = createInviteToken();
        const invite = {
          inviteId: createInviteId(), tokenHash: hashInviteToken(token), createdBy: d.userId, createdAt: now(),
          expiresAt: now() + checked.value.expiresInHours * 60 * 60 * 1000, maxUses: checked.value.maxUses,
          uses: 0, requiresApproval: checked.value.requiresApproval, revoked: false,
        };
        await storage.createInvite(roomId, invite);
        const url = `${publicUrl}/invite/${token}`;
        const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1 });
        return send(res, 200, { inviteId: invite.inviteId, url, qrSvg, expiresAt: invite.expiresAt, maxUses: invite.maxUses, requiresApproval: invite.requiresApproval });
      }
      if (invitesRoute && req.method === 'GET') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(invitesRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'invite_members')) return send(res, 403, { error: 'missing capability: invite_members' });
        // Сами ссылки здесь не показываются: токен известен только в момент создания.
        return send(res, 200, { invites: await storage.listInvites(roomId) });
      }

      const revokeRoute = p.match(/^\/rooms\/([^/]+)\/invites\/([^/]+)\/revoke$/);
      if (revokeRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(revokeRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'invite_members')) return send(res, 403, { error: 'missing capability: invite_members' });
        if (!(await storage.revokeInvite(roomId, decodeURIComponent(revokeRoute[2])))) return send(res, 404, { error: 'no such invite' });
        return send(res, 200, { ok: true });
      }

      // Вступление по ссылке. Токен передаётся в теле, а не в адресе: адрес попадает в журналы.
      if (req.method === 'POST' && p === '/invites/join') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const token = typeof body.token === 'string' ? body.token : '';
        if (!token) return send(res, 400, { error: 'token required' });
        const invite = await storage.findInviteByTokenHash(hashInviteToken(token));
        // Неверная, отозванная, истёкшая и исчерпанная ссылка выглядят одинаково.
        if (!invite || !inviteUsable(invite, now())) return send(res, 404, { error: 'invite is not valid' });
        const r = await storage.getRoom(invite.roomId);
        if (!r) return send(res, 404, { error: 'invite is not valid' });
        if (r.members.includes(d.userId)) return send(res, 409, { error: 'already a member' });
        const inviteOrgId = await storage.roomOrg(invite.roomId);
        const inviteGate = await orgGate(d.userId, inviteOrgId);
        if (inviteGate) return send(res, inviteGate.status, { error: inviteGate.error, code: inviteGate.code });
        if (invite.requiresApproval) {
          if (await storage.hasJoinRequest(invite.roomId, d.userId)) return send(res, 200, { status: 'requested' });
          if (!(await storage.useInvite(invite.inviteId, now()))) return send(res, 404, { error: 'invite is not valid' });
          await storage.createJoinRequest(invite.roomId, d.userId, now());
          return send(res, 200, { status: 'requested' });
        }
        if (!(await storage.useInvite(invite.inviteId, now()))) return send(res, 404, { error: 'invite is not valid' });
        if (await groupFull(invite.roomId)) return send(res, 409, { error: 'group is full' });
        await storage.addRoomMember(invite.roomId, d.userId);
        await markRoomChanged(invite.roomId, (await storage.getRoom(invite.roomId)).members);
        return send(res, 200, { status: 'joined', roomId: invite.roomId });
      }

            // Группы MLS: эпоха группы, коммиты и приветственные сообщения. Коммит принимается только от актуальной эпохи.
            const mlsCommitRoute = p.match(/^\/mls\/groups\/([^/]+)\/commits$/);
            if (mlsCommitRoute && req.method === 'POST') {
              const d = await authed(req);
              if (!d) return send(res, 401, { error: 'unauthorized' });
              const roomId = decodeURIComponent(mlsCommitRoute[1]);
              const checked = parseCommitRequest(body);
              if (checked.error) return send(res, 400, { error: checked.error });
              const { clientOperationId } = checked.value;
              const requestFingerprint = clientOperationId
                ? mlsCommitFingerprint(roomId, d.userId, d.deviceId, checked.value)
                : null;

              // Replay precedes membership checks: an accepted commit may have removed its sender.
              if (clientOperationId) {
                const replay = await storage.mlsCommitOperation(roomId, d.userId, d.deviceId, clientOperationId, requestFingerprint);
                if (replay) {
                  if (!replay.ok && replay.reason === 'operation_id_reused') {
                    return send(res, 409, { error: 'clientOperationId was reused with a different request', code: 'operation_id_reused' });
                  }
                  return send(res, 200, { epoch: replay.epoch, replayed: true });
                }
              }

              const r = await storage.getRoom(roomId);
              if (!r) return send(res, 404, { error: 'group not found' });
              // Close the race between the first replay lookup and the room snapshot.
              if (clientOperationId) {
                const replay = await storage.mlsCommitOperation(roomId, d.userId, d.deviceId, clientOperationId, requestFingerprint);
                if (replay) {
                  if (!replay.ok && replay.reason === 'operation_id_reused') {
                    return send(res, 409, { error: 'clientOperationId was reused with a different request', code: 'operation_id_reused' });
                  }
                  return send(res, 200, { epoch: replay.epoch, replayed: true });
                }
              }
              if (!r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
              // The epoch check is repeated under the PostgreSQL room lock in mlsApplyCommit.
              // Do not reject here: a concurrent exact retry may have been accepted while this request waited.

              const { adds, removes } = checked.value.changes;
              const isOwner = d.userId === r.owner;
              for (const t of removes) {
                if (!r.members.includes(t)) return send(res, 400, { error: `not a member: ${t}` });
                if (t === r.owner) return send(res, 409, { error: 'owner cannot be removed' });
                if (t !== d.userId && !isOwner) {
                  if (!hasCapability(r, d.userId, 'remove_members')) return send(res, 403, { error: 'missing capability: remove_members' });
                  if (r.admins.includes(t)) return send(res, 403, { error: 'an admin cannot remove another admin' });
                }
              }
              for (const u of adds) {
                if (r.members.includes(u)) return send(res, 409, { error: `already a member: ${u}` });
                if (!isOwner && !hasCapability(r, d.userId, 'invite_members')) return send(res, 403, { error: 'missing capability: invite_members' });
                if (!(await storage.hasAccount(u))) return send(res, 400, { error: `unknown account: ${u}` });
                if (!checked.value.welcomes.some((w) => w.userId === u)) return send(res, 400, { error: `added member needs a welcome: ${u}` });
              }
              const pendingDevices = await storage.mlsPendingRemovalDevices(roomId);
              for (const device of checked.value.changes.removeDevices) {
                if (!pendingDevices.includes(device)) return send(res, 400, { error: `device is not waiting for removal in this group: ${device}` });
              }
              const afterMembers = new Set([...r.members.filter((m) => !removes.includes(m)), ...adds]);
              const maxMembers = await effectiveMaxMembers(roomId);
              if (afterMembers.size > maxMembers) return send(res, 409, { error: 'group is full', limit: maxMembers });
              for (const w of checked.value.welcomes) {
                if (!afterMembers.has(w.userId)) return send(res, 400, { error: 'welcome recipient is not a member' });
                if (!(await storage.hasAccount(w.userId))) return send(res, 400, { error: 'welcome recipient is not a known account' });
              }
              const result = await storage.mlsApplyCommit(roomId, checked.value.epoch, {
                senderId: d.userId, deviceId: d.deviceId, clientOperationId, requestFingerprint, keyPackageClaimId: checked.value.keyPackageClaimId,
                commit: checked.value.commit, welcomes: checked.value.welcomes, changes: checked.value.changes,
              }, now());
              if (!result.ok && result.reason === 'operation_id_reused') {
                return send(res, 409, { error: 'clientOperationId was reused with a different request', code: 'operation_id_reused' });
              }
              if (!result.ok && result.reason === 'epoch_outdated') {
                return send(res, 409, { error: 'epoch is outdated', code: 'epoch_outdated', currentEpoch: result.epoch });
              }
              if (!result.ok && result.reason?.startsWith('claim_')) {
                return send(res, 409, { error: result.reason, code: result.reason });
              }
              if (result.ok && !result.replayed && (adds.length > 0 || removes.length > 0)) {
                await markRoomChanged(roomId, [...new Set([...r.members, ...adds])]);
              }
              if (!result.ok && result.reason === 'already-member') return send(res, 409, { error: 'already a member' });
              if (!result.ok && result.reason === 'recipient') return send(res, 400, { error: 'welcome recipient is not a known account' });
              if (!result.ok) return send(res, 409, { error: 'epoch is outdated', code: 'epoch_outdated', currentEpoch: result.epoch });
              return send(res, 200, { epoch: result.epoch, replayed: !!result.replayed });
            }
            // Сообщение группы MLS: сервер проверяет группу и эпоху в открытом заголовке, шифротекст не читает.
            const mlsMessageRoute = p.match(/^\/mls\/groups\/([^/]+)\/messages$/);
            if (mlsMessageRoute && req.method === 'POST') {
              const d = await authed(req);
              if (!d) return send(res, 401, { error: 'unauthorized' });
              const roomId = decodeURIComponent(mlsMessageRoute[1]);
              const r = await storage.getRoom(roomId);
              if (!r) return send(res, 404, { error: 'group not found' });
              if (!r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
              const kind = body.kind ?? 'text';
              if (!MESSAGE_KINDS.includes(kind)) return send(res, 400, { error: 'kind must be text, sticker or gif' });
              if (body.forwarded !== undefined && typeof body.forwarded !== 'boolean') return send(res, 400, { error: 'forwarded must be a boolean' });
              if (!hasCapability(r, d.userId, 'send_messages')) return send(res, 403, { error: 'missing capability: send_messages' });
              if (kind !== 'text' && !hasCapability(r, d.userId, 'send_stickers_gifs')) return send(res, 403, { error: 'missing capability: send_stickers_gifs' });
              if (body.forwarded === true && !hasCapability(r, d.userId, 'forward_messages')) return send(res, 403, { error: 'missing capability: forward_messages' });
              const checked = parseApplicationRequest(body);
              if (checked.error) return send(res, 400, { error: checked.error });
              const header = readPrivateMessageHeader(checked.value);
              if (header.error) return send(res, 400, { error: header.error });
              if (!header.value.groupId.equals(Buffer.from(roomId, 'utf8'))) return send(res, 400, { error: 'message belongs to another group' });
              // Повтор с тем же clientMessageId возвращает первое сообщение. Одинаковые запросы, пришедшие одновременно,
              // закрыты резервированием: строку с идентификатором вставляет только один запрос, остальные ждут или получают готовый ответ.
              // Файл прикрепляется только готовый, свой и из этой комнаты.
              let fileRef = null;
              if (body.fileId !== undefined) {
                const f = typeof body.fileId === 'string' ? await storage.getFile(body.fileId) : null;
                if (!f || f.status !== 'ready' || f.ownerId !== d.userId || f.roomId !== roomId) return send(res, 400, { error: 'file is not ready, not yours, or not for this room' });
                fileRef = f.fileId;
              }
              const clientMessageId = body.clientMessageId;
              if (clientMessageId !== undefined) {
                if (typeof clientMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(clientMessageId)) return send(res, 400, { error: 'clientMessageId: 1-64 letters, digits, _ or -' });
                const known = await storage.findClientMessage(roomId, d.userId, clientMessageId);
                if (known !== null) return send(res, 200, { event_id: `$${known}` });
              }
              const epoch = await storage.mlsGroupEpoch(roomId);
              if (epoch === 0) return send(res, 409, { error: 'group has no epoch yet' });
              if (header.value.epoch !== epoch) return send(res, 409, { error: 'epoch is outdated', currentEpoch: epoch });
              let reserved = false;
              if (clientMessageId !== undefined) {
                const claim = await storage.reserveClientMessage(roomId, d.userId, clientMessageId);
                if (claim.state === 'done') return send(res, 200, { event_id: `$${claim.seq}` });
                if (claim.state === 'pending') return send(res, 409, { error: 'a message with this clientMessageId is being sent: retry later' });
                reserved = true;
              }
              let seq;
              try {
                seq = await storage.appendRoomEvent(roomId, d.userId, 'm.room.encrypted', { mls: body.message, kind, forwarded: body.forwarded === true, ...(fileRef ? { file: fileRef } : {}) }, now());
              } catch (error) {
                if (reserved) await storage.releaseClientMessage(roomId, d.userId, clientMessageId);
                throw error;
              }
              if (reserved) await storage.completeClientMessage(roomId, d.userId, clientMessageId, seq);
              await notifyNewMessage(roomId, `$${seq}`, key(d.userId, d.deviceId));
              return send(res, 200, { event_id: `$${seq}` });
            }
            if (req.method === 'GET' && p === '/mls/removals') {
              const d = await authed(req);
              if (!d) return send(res, 401, { error: 'unauthorized' });
              return send(res, 200, { removals: await storage.mlsPendingRemovalsFor(d.userId) });
            }
            const mlsEpochRoute = p.match(/^\/mls\/groups\/([^/]+)\/epoch$/);
            if (mlsEpochRoute && req.method === 'GET') {
              const d = await authed(req);
              if (!d) return send(res, 401, { error: 'unauthorized' });
              const roomId = decodeURIComponent(mlsEpochRoute[1]);
              const r = await storage.getRoom(roomId);
              if (!r) return send(res, 404, { error: 'group not found' });
              if (!r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
              return send(res, 200, { epoch: await storage.mlsGroupEpoch(roomId) });
            }
            const mlsCommitsRoute = p.match(/^\/mls\/groups\/([^/]+)\/commits$/);
            if (mlsCommitsRoute && req.method === 'GET') {
              const d = await authed(req);
              if (!d) return send(res, 401, { error: 'unauthorized' });
              const roomId = decodeURIComponent(mlsCommitsRoute[1]);
              const r = await storage.getRoom(roomId);
              if (!r) return send(res, 404, { error: 'group not found' });
              if (!r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
              const since = Number(new URL(req.url, 'http://local').searchParams.get('since') ?? 0);
              if (!Number.isSafeInteger(since) || since < 0) return send(res, 400, { error: 'since must be a non-negative integer' });
              const rows = await storage.mlsCommitsSince(roomId, since, 100);
              return send(res, 200, { commits: rows.map((c) => ({ epoch: c.epoch, sender: c.senderId, commit: c.commit.toString('base64'), changes: c.changes ?? null, welcomeRecipients: c.welcomeRecipients ?? null })) });
            }
            if (req.method === 'GET' && p === '/mls/welcomes') {
              const d = await authed(req);
              if (!d) return send(res, 401, { error: 'unauthorized' });
              const rows = await storage.mlsPendingWelcomes(d.userId, d.deviceId);
              return send(res, 200, { welcomes: rows.map((w) => ({ id: w.id, roomId: w.roomId, epoch: w.epoch, welcome: w.welcome.toString('base64') })) });
            }
            const mlsAckRoute = p.match(/^\/mls\/welcomes\/(\d+)\/ack$/);
            if (mlsAckRoute && req.method === 'POST') {
              const d = await authed(req);
              if (!d) return send(res, 401, { error: 'unauthorized' });
              if (!(await storage.mlsAckWelcome(Number(mlsAckRoute[1]), d.userId, d.deviceId, now()))) return send(res, 404, { error: 'welcome not found' });
              return send(res, 200, { ok: true });
            }
      // Ключевые пакеты MLS. Устройство загружает свои пакеты; другой участник получает по одному на устройство.
      if (req.method === 'POST' && p === '/mls/key-packages') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const checked = parseKeyPackages(body?.packages);
        if (checked.error) return send(res, 400, { error: checked.error });
        const unused = await storage.mlsAvailableCount(d.userId, d.deviceId, now());
        if (unused + checked.value.length > MLS_UNUSED_MAX) return send(res, 409, { error: `a device can keep at most ${MLS_UNUSED_MAX} unused key packages` });
        await storage.mlsStoreKeyPackages(d.userId, d.deviceId, checked.value, now());
        return send(res, 200, { stored: checked.value.length, available: unused + checked.value.length });
      }
      if (req.method === 'GET' && p === '/mls/key-packages/count') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        return send(res, 200, { available: await storage.mlsAvailableCount(d.userId, d.deviceId, now()) });
      }
      // Резервный ключевой пакет: один на устройство, заменяется при новой загрузке, не расходуется.
      if (req.method === 'POST' && p === '/mls/key-packages/last-resort') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const checked = parseKeyPackages([body?.package]);
        if (checked.error) return send(res, 400, { error: checked.error });
        await storage.mlsStoreLastResort(d.userId, d.deviceId, checked.value[0], now());
        return send(res, 200, { stored: true });
      }
      const mlsClaims = p.match(/^\/mls\/key-packages\/([^/]+)\/claims$/);
      if (mlsClaims && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const targetUserId = decodeURIComponent(mlsClaims[1]);
        const { claimId, roomId } = body ?? {};
        if (typeof claimId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(claimId)) {
          return send(res, 400, { error: 'claimId must be 16-128 URL-safe characters' });
        }
        if (typeof roomId !== 'string' || roomId.length < 1 || roomId.length > 200) {
          return send(res, 400, { error: 'roomId is required for a KeyPackage reservation' });
        }
        const room = await storage.getRoom(roomId);
        if (!room || !room.members.includes(d.userId)) return send(res, 403, { error: 'not a room member' });
        if (room.members.includes(targetUserId)) return send(res, 409, { error: 'already a member', code: 'already_member' });
        if (d.userId !== room.owner && !hasCapability(room, d.userId, 'invite_members')) {
          return send(res, 403, { error: 'missing capability: invite_members' });
        }
        if (!(await storage.hasAccount(targetUserId))) return send(res, 400, { error: 'unknown account' });
        const rate = await checkRate('mlsClaimPerAccount', d.userId);
        if (!rate.allowed) return send(res, 429, { error: 'too many key requests, try later' });
        const claimed = await storage.mlsClaimKeyPackages(targetUserId, d.userId, d.deviceId, claimId, roomId, now());
        if (!claimed.ok) return send(res, 409, { error: claimed.reason, code: claimed.reason });
        return send(res, 200, {
          claimId, roomId,
          packages: claimed.packages.map((item) => ({ deviceId: item.deviceId, package: item.package.toString('base64') })),
        });
      }
      const mlsReleaseClaim = p.match(/^\/mls\/key-packages\/claims\/([^/]+)$/);
      if (mlsReleaseClaim && req.method === 'DELETE') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const claimId = decodeURIComponent(mlsReleaseClaim[1]);
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(claimId)) return send(res, 400, { error: 'invalid claimId' });
        const result = await storage.mlsReleaseKeyPackageClaim(d.userId, d.deviceId, claimId, now());
        if (!result.ok) return send(res, 409, { error: result.reason, code: result.reason });
        return send(res, 200, { released: result.released });
      }
      const mlsClaim = p.match(/^\/mls\/key-packages\/([^/]+)\/claim$/);
      if (mlsClaim && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const claimId = body?.claimId;
        if (typeof claimId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(claimId)) {
          return send(res, 400, { error: 'claimId must be 16-128 URL-safe characters' });
        }
        const rate = await checkRate('mlsClaimPerAccount', d.userId);
        if (!rate.allowed) return send(res, 429, { error: 'too many key requests, try later' });
        const claimed = await storage.mlsClaimKeyPackages(decodeURIComponent(mlsClaim[1]), d.userId, d.deviceId, claimId, null, now());
        if (!claimed.ok) return send(res, 409, { error: claimed.reason, code: claimed.reason });
        return send(res, 200, { claimId, packages: claimed.packages.map((item) => ({ deviceId: item.deviceId, package: item.package.toString('base64') })) });
      }

      // Оформление группы. Право — edit_group_appearance.
      const appearanceRoute = p.match(/^\/rooms\/([^/]+)\/appearance$/);
      if (appearanceRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(appearanceRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        if (!hasCapability(r, d.userId, 'edit_group_appearance')) return send(res, 403, { error: 'missing capability: edit_group_appearance' });
        const checked = validateAppearance(body);
        if (checked.error) return send(res, 400, { error: checked.error });
        const expectedKind = { avatarAssetId: 'avatar', coverAssetId: 'cover', backgroundAssetId: 'background' };
        for (const [key, kind] of Object.entries(expectedKind)) {
          const id = checked.value[key];
          if (id === undefined || id === null) continue;
          const asset = await storage.getRoomAsset(roomId, id);
          if (!asset) return send(res, 400, { error: `${key}: asset not found in this group` });
          if (asset.kind !== kind) return send(res, 400, { error: `${key}: asset has kind ${asset.kind}` });
        }
        await storage.setRoomAppearance(roomId, checked.value);
        return send(res, 200, { ok: true, ...checked.value });
      }

      // Загрузка файла оформления или стикера. Формат и тип проверяются по содержимому.
      const assetsRoute = p.match(/^\/rooms\/([^/]+)\/assets$/);
      if (assetsRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(assetsRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        if (!hasCapability(r, d.userId, 'edit_group_appearance')) return send(res, 403, { error: 'missing capability: edit_group_appearance' });
        const checked = validateAssetUpload(body, r);
        if (checked.error) return send(res, checked.status ?? 400, { error: checked.error });
        const file = checked.value;
        if (file.kind === 'sticker') {
          const stickers = await storage.listRoomStickers(roomId);
          if (stickers.length >= MAX_STICKERS_PER_GROUP) return send(res, 409, { error: `a group can have at most ${MAX_STICKERS_PER_GROUP} stickers` });
          if (stickers.some((s) => s.shortcode === file.shortcode)) return send(res, 409, { error: 'shortcode is already used in this group' });
        }
        const assetId = createAssetId();
        await storage.addRoomAsset(roomId, { assetId, roomId, kind: file.kind, contentType: file.contentType, encrypted: file.encrypted, data: file.data, shortcode: file.shortcode, createdBy: d.userId, createdAt: now() });
        return send(res, 200, { assetId, kind: file.kind, size: file.data.length });
      }

      // Файлы, которые ждут замены под текущий вид группы (с правом на оформление).
      const pendingRoute = p.match(/^\/rooms\/([^/]+)\/assets\/pending$/);
      if (pendingRoute && req.method === 'GET') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(pendingRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'edit_group_appearance')) return send(res, 403, { error: 'missing capability: edit_group_appearance' });
        const assets = (await storage.listRoomAssets(roomId)).filter((a) => !assetMatchesVisibility(a, r));
        return send(res, 200, { assets: assets.map(({ assetId, kind, encrypted, shortcode }) => ({ assetId, kind, encrypted, shortcode })) });
      }

      // Чтение файла: в публичной группе — любому вошедшему, в приватной — только участнику.
      // Для постороннего приватный файл не существует.
      const assetRoute = p.match(/^\/rooms\/([^/]+)\/assets\/([^/]+)$/);
      if (assetRoute && req.method === 'GET') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(assetRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !assetVisibleTo(r, d.userId)) return send(res, 404, { error: 'asset not found' });
        const asset = await storage.getRoomAsset(roomId, decodeURIComponent(assetRoute[2]));
        if (!asset) return send(res, 404, { error: 'asset not found' });
        if (!assetMatchesVisibility(asset, r)) return send(res, 409, { error: 'file must be replaced to match the group visibility' });
        return send(res, 200, { assetId: asset.assetId, kind: asset.kind, contentType: asset.contentType, encrypted: asset.encrypted, dataBase64: asset.data.toString('base64') });
      }
      // Замена файла тем же идентификатором: так приватная группа получает зашифрованную версию.
      if (assetRoute && req.method === 'PUT') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(assetRoute[1]);
        const assetId = decodeURIComponent(assetRoute[2]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'edit_group_appearance')) return send(res, 403, { error: 'missing capability: edit_group_appearance' });
        const current = await storage.getRoomAsset(roomId, assetId);
        if (!current) return send(res, 404, { error: 'asset not found' });
        const checked = validateAssetUpload(body, r);
        if (checked.error) return send(res, checked.status ?? 400, { error: checked.error });
        if (checked.value.kind !== current.kind) return send(res, 400, { error: `kind must stay ${current.kind}` });
        await storage.replaceRoomAsset(roomId, assetId, { contentType: checked.value.contentType, encrypted: checked.value.encrypted, data: checked.value.data });
        return send(res, 200, { assetId, encrypted: checked.value.encrypted, size: checked.value.data.length });
      }
      if (assetRoute && req.method === 'DELETE') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(assetRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !hasCapability(r, d.userId, 'edit_group_appearance')) return send(res, 403, { error: 'missing capability: edit_group_appearance' });
        if (!(await storage.deleteRoomAsset(roomId, decodeURIComponent(assetRoute[2])))) return send(res, 404, { error: 'asset not found' });
        return send(res, 200, { ok: true });
      }

      // Собственные стикеры группы: список видят участники.
      const stickersRoute = p.match(/^\/rooms\/([^/]+)\/stickers$/);
      if (stickersRoute && req.method === 'GET') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(stickersRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        return send(res, 200, { stickers: (await storage.listRoomStickers(roomId)).filter((s) => assetMatchesVisibility(s, r)) });
      }

      const eventAction = p.match(/^\/rooms\/([^/]+)\/events\/([^/]+)\/(redact|edit)$/);
      if (eventAction && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(eventAction[1]);
        const eventId = decodeURIComponent(eventAction[2]);
        const idMatch = /^\$(\d+)$/.exec(eventId);
        if (!idMatch) return send(res, 400, { error: 'event id must look like $123' });
        const seq = Number(idMatch[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        const target = await storage.findRoomEvent(roomId, seq);
        if (!target) return send(res, 404, { error: 'event not found' });
        if (target.type === 'm.room.redacted') return send(res, 409, { error: 'event already deleted' });
        if (eventAction[3] === 'redact') {
          const need = target.sender === d.userId ? 'delete_own_messages' : 'delete_any_messages';
          if (!hasCapability(r, d.userId, need)) return send(res, 403, { error: `missing capability: ${need}` });
          if (deleteWindowClosed(target, now())) return send(res, 403, { error: 'delete window closed: 24 hours after sending' });
          if (readByOthers(r, target)) return send(res, 403, { error: 'delete window closed: the message was read' });
          await storage.redactRoomEvent(roomId, seq, d.userId, now());
          return send(res, 200, { ok: true });
        }
        // Правка в группе MLS пока не проверяется по эпохе: её запрещаем, пока не будет отдельного контракта.
        if (target.sender !== d.userId) return send(res, 403, { error: 'only the author can edit a message' });
        if (!hasCapability(r, d.userId, 'edit_own_messages')) return send(res, 403, { error: 'missing capability: edit_own_messages' });
        if (editWindowClosed(target, now())) return send(res, 403, { error: 'edit window closed: 24 hours after sending' });
        if (body.type !== 'm.room.encrypted') return send(res, 400, { error: 'this server accepts only encrypted events' });
        const checkedEdit = parseApplicationRequest(body);
        if (checkedEdit.error) return send(res, 400, { error: checkedEdit.error });
        const editHeader = readPrivateMessageHeader(checkedEdit.value);
        if (editHeader.error) return send(res, 400, { error: editHeader.error });
        if (!editHeader.value.groupId.equals(Buffer.from(roomId, 'utf8'))) return send(res, 400, { error: 'message belongs to another group' });
        const editEpoch = await storage.mlsGroupEpoch(roomId);
        if (editEpoch === 0) return send(res, 409, { error: 'group has no epoch yet' });
        if (editHeader.value.epoch !== editEpoch) return send(res, 409, { error: 'epoch is outdated', currentEpoch: editEpoch });
        const newSeq = await storage.appendRoomEvent(roomId, d.userId, 'm.room.encrypted.replace', { replaces: `$${seq}`, payload: { mls: body.message } }, now());
        return send(res, 200, { event_id: `$${newSeq}` });
      }

      const roomRoute = p.match(/^\/rooms\/([^/]+)\/events$/);
      if (roomRoute && req.method === 'POST') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        if (body.type !== 'm.room.encrypted') {
          return send(res, 400, { error: 'this server accepts only encrypted events' });
        }
        const roomId = decodeURIComponent(roomRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        // Вид сообщения и признак пересылки клиент объявляет сам: внутри шифротекста сервер их не видит.
        return send(res, 409, { error: 'messages must be sent through /mls/groups/:id/messages' });
        const kind = body.kind ?? 'text';
        if (!MESSAGE_KINDS.includes(kind)) return send(res, 400, { error: 'kind must be text, sticker or gif' });
        if (body.forwarded !== undefined && typeof body.forwarded !== 'boolean') return send(res, 400, { error: 'forwarded must be a boolean' });
        if (!hasCapability(r, d.userId, 'send_messages')) return send(res, 403, { error: 'missing capability: send_messages' });
        if (kind !== 'text' && !hasCapability(r, d.userId, 'send_stickers_gifs')) return send(res, 403, { error: 'missing capability: send_stickers_gifs' });
        if (body.forwarded === true && !hasCapability(r, d.userId, 'forward_messages')) return send(res, 403, { error: 'missing capability: forward_messages' });
        const seq = await storage.appendRoomEvent(roomId, d.userId, body.type, body.content, now());
        return send(res, 200, { event_id: `$${seq}` });
      }
      if (roomRoute && req.method === 'GET') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const roomId = decodeURIComponent(roomRoute[1]);
        const r = await storage.getRoom(roomId);
        if (!r || !r.members.includes(d.userId)) return send(res, 403, { error: 'not a member' });
        // Только события после вступления участника (C-07). Внутренний номер наружу не отдаём.
        const since = r.joinedSeq[d.userId] ?? 0;
        const rows = await storage.roomEventRows(roomId, since);
        return send(res, 200, { events: rows.map(({ seq, ...rest }) => rest) });
      }

      // ---------- восстановление после кражи ----------
      if (req.method === 'POST' && p === '/recovery/start') {
        // Один и тот же ответ, есть такой аккаунт или нет: не раскрываем, кто зарегистрирован.
        const startEmail = normalizeEmail(body.email);
        const userId = body.userId ?? (startEmail ? await storage.userIdByEmail(startEmail) : null);
        // Лимит на запросы восстановления с одного адреса, в том числе по несуществующим аккаунтам: SMS и письма стоят денег (D5).
        const perAddress = await checkRate('recoveryPerAddress', clientIp(req));
        if (!perAddress.allowed) return send(res, 429, { error: 'too many recovery requests from this address', retryAt: new Date(perAddress.retryAt).toISOString() });
        if (await storage.hasAccount(userId)) {
          const phone = await storage.phoneGet(userId);
          // Аккаунт без подтверждённого телефона: восстановление по почте (решение владельца). Одна почта и окно 48 часов.
          // Аккаунт с привязкой Google или Apple восстанавливается входом через провайдера: кода здесь нет.
          if (!phone.verified && (await storage.providerLinksOf(userId)).length === 0) {
            const emailCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
            const issued = await storage.recoveryUpdate(userId, (r) => {
              const out = requestCode(r, { nowMs: now(), codeHash: recoveryCodeHash(userId, emailCode), linkHash: null });
              const next = out.issued ? confirmLink(out.next, { nowMs: now(), linkOk: true }).next : out.next;
              return { next, result: out.issued };
            });
            if (issued) {
              await mailTo(await confirmationEmail(userId), 'Код восстановления InOne',
                `Код: ${emailCode}. Код действует час. Вход откроется только через 48 часов после смены пароля. Если это не вы, ничего не вводите.`);
              await mail(userId, 'Запрошено восстановление InOne',
                'Кто-то запросил восстановление доступа. Код отправлен на запасную или основную почту. Если это не вы, ничего не делайте и проверьте устройства.');
              await alertDevices(userId, { kind: 'recovery_started' });
            }
          }
          // Восстановление возможно только при подтверждённом телефоне (D5).
          // SMS на номер не чаще заданного за сутки: лишние запросы не шлют SMS.
          if (phone.verified && (await checkRate('smsPerPhone', phone.phone)).allowed) {
            const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
            const token = randomBytes(24).toString('base64url');
            const issued = await storage.recoveryUpdate(userId, (r) => {
              const out = requestCode(r, { nowMs: now(), codeHash: recoveryCodeHash(userId, code), linkHash: recoveryLinkHash(userId, token) });
              return { next: out.next, result: out.issued };
            });
            if (issued) {
              // D5: код приходит по SMS, подтверждение — ссылкой из письма. Это два разных канала.
              await smsSender.send(phone.phone, `Код: ${code}. Код восстановления InOne действует час. Если это не вы — не вводите его.`);
              await mail(userId, 'Подтверждение восстановления',
                `Чтобы подтвердить восстановление, откройте ссылку: ${publicUrl}/recovery/confirm?user=${encodeURIComponent(userId)}&token=${token}. Ссылка действует час. Если это не вы — не открывайте её.`);
              await alertDevices(userId, { kind: 'recovery_started' });
            }
          }
        }
        return send(res, 202, { ok: true });
      }

      if (req.method === 'GET' && p === '/recovery/confirm') {
        // Открытие ссылки из письма ничего не меняет: предпросмотр почты не подтвердит восстановление (D5).
        const userId = url.searchParams.get('user') ?? '';
        const token = url.searchParams.get('token') ?? '';
        if (!token) return send(res, 400, { error: 'token required' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(htmlPage('Подтверждение восстановления', `
<p>Нажмите кнопку, чтобы подтвердить, что восстановление запросили вы. Код из SMS вводится в приложении.</p>
<form method="post" action="/recovery/confirm">
<input type="hidden" name="user" value="${escapeHtml(userId)}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit">Подтвердить восстановление</button>
</form>`));
      }

      if (req.method === 'POST' && p === '/recovery/confirm') {
        const userId = String(body.user ?? '');
        const token = String(body.token ?? '');
        const outcome = await storage.recoveryUpdate(userId, (r) => {
          const out = confirmLink(r, { nowMs: now(), linkOk: token !== '' && !!r.reqLinkHash && sameHex(recoveryLinkHash(userId, token), r.reqLinkHash) });
          return { next: out.next, result: out.outcome };
        });
        const status = outcome === 'ok' ? 200 : outcome === 'expired' ? 410 : outcome === 'none' ? 404 : 403;
        const message = {
          ok: 'Подтверждено. Вернитесь в приложение и введите код из SMS.',
          expired: 'Ссылка истекла. Запросите восстановление заново.',
          none: 'Активного восстановления нет.',
          wrong: 'Ссылка неверная.',
        }[outcome];
        if (isForm) {
          res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(htmlPage('Подтверждение восстановления', `<p>${escapeHtml(message)}</p>`));
        }
        const error = { expired: 'recovery expired', none: 'no active recovery', wrong: 'wrong link' }[outcome];
        return send(res, status, error ? { error } : { ok: true });
      }

      if (req.method === 'POST' && p === '/recovery/cancel-by-code') {
        const email = normalizeEmail(body.email);
        const perEmail = await checkRate('recoveryCancelPerEmail', email);
        if (!perEmail.allowed) return send(res, 429, { error: 'too many attempts, try later' });
        const userId = await storage.userIdByEmail(email);
        const code = typeof body.code === 'string' ? body.code : '';
        const result = userId
          ? await storage.cancelRecoveryAtomic(userId, { nowMs: now(), cancelCodeHash: recoveryCancelHash(userId, code) })
          : { status: 'wrong_code' };
        if (result.status !== 'ok') return send(res, 403, { error: 'wrong code' });
        await mail(userId, 'Восстановление отменено', 'Восстановление отменено кодом отмены. Прежний пароль возвращён.');
        await alertDevices(userId, { kind: 'recovery_cancelled' });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/recovery/cancel') {
        const d = await authed(req);
        if (!d) return send(res, 401, { error: 'unauthorized' });
        const result = await storage.cancelRecoveryAtomic(d.userId, { nowMs: now(), actorDeviceId: d.deviceId });
        if (result.status === 'none') return send(res, 404, { error: 'no active recovery' });
        if (result.status === 'forbidden') return send(res, 403, { error: 'only devices that existed before the recovery can cancel' });
        await mail(d.userId, 'Восстановление отменено',
          'Восстановление отменено с устройства, которое существовало до запроса. Прежний пароль возвращён.');
        await alertDevices(d.userId, { kind: 'recovery_cancelled' });
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/recovery/complete') {
        const { code, pin, newPassword } = body;
        const userId = body.userId ?? (typeof body.email === 'string' ? await storage.userIdByEmail(normalizeEmail(body.email)) : null);
        if (!userId || !(await storage.hasAccount(userId))) return send(res, 404, { error: 'no active recovery' });
        if ((await storage.providerLinksOf(userId)).length > 0) return send(res, 409, { error: 'password recovery is disabled for accounts linked to Google or Apple' });
        if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
          return send(res, 400, { error: `newPassword required (min ${MIN_PASSWORD_LENGTH} chars)` });
        }
        if (await storage.hasPin(userId)) {
          if (typeof pin !== 'string' || pin === '') return send(res, 403, { error: 'PIN required' });
          const checkedPin = await verifyPin(userId, pin);
          if (!checkedPin.ok) return pinError(res, checkedPin);
        }
        const cancelCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const result = await storage.completeRecoveryAtomic(userId, {
          codeHash: typeof code === 'string' ? recoveryCodeHash(userId, code) : '',
          nowMs: now(),
          passwordHash: hashPassword(newPassword),
          cancelCodeHash: recoveryCancelHash(userId, cancelCode),
        });
        if (result.status === 'none') return send(res, 404, { error: 'no active recovery' });
        if (result.status === 'expired') return send(res, 410, { error: 'recovery expired' });
        if (result.status === 'unconfirmed') return send(res, 403, { error: 'confirm the link from the email first' });
        if (result.status === 'wrong' || result.status === 'locked') {
          if (result.status === 'locked') await alertDevices(userId, { kind: 'recovery_locked' });
          return send(res, 403, { error: 'wrong code' });
        }
        await mail(userId, 'Восстановление выполнено',
          `Пароль изменён. Вход с новых устройств откроется через 48 часов. Отменить можно с устройства, существовавшего до запроса, или кодом отмены: ${cancelCode}.`);
        await alertDevices(userId, { kind: 'recovery_completed', keyResetAt: new Date(result.keyResetAt).toISOString() });
        return send(res, 200, { ok: true, keyResetAt: new Date(result.keyResetAt).toISOString() });
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e.code === 'MAIL_UNAVAILABLE') return send(res, 503, { error: 'mail is temporarily unavailable, try later' });
      return send(res, 500, { error: e.message });
    }
  });

  return {
    server,
    /** Очистка брошенных загрузок: незавершённые старше суток удаляются вместе с байтами. */
        sweepExpired,
    cleanupFiles,
    setFlag: (key, value, actor = 'тест', reason = 'проверка из теста на сервере') => storage.setFlag(key, validateFlag(key, value), actor, reason, now()),
    /** Всё, что сервер хранит и получил. Нужно тестам: проверить, что открытого текста здесь нет. */
    dump: async () => JSON.stringify({ ...(await storage.snapshot()), wireLog, outbox }),
    /** Сдвигает часы сервера. Нужно тестам, чтобы проверить задержки 48 часов, 10 минут и блокировок. */
    advance: (ms) => { offset += ms; },
    /** Письма пользователя (в PoC вместо настоящей почты). */
    mailbox: (userId) => outbox.filter((m) => m.to === userId),
    /** Всё, что сервер хранит по беседе. Для теста «украденной копии». */
    roomEvents: async (roomId) => storage.roomEventRows(roomId, 0),
    smsOutbox: (phone) => (smsSender.outbox ?? []).filter((m) => m.phone === phone),
    /** Секреты, которые сервер держит у себя (без исходящих писем). Нужно тестам: токены и коды не лежат открытым текстом. */
    stateSnapshot: async () => JSON.stringify({
      tokens: await storage.tokenHashes(),
      recoveries: await storage.recoveryHashes(),
    }),
    /** Сохранённое значение PIN (должно быть хэшем, а не самим PIN). Нужно тесту хранения. */
    pinStored: (userId) => storage.pinHash(userId),
    /** Сколько раз реально проверяли PIN. Нужно тесту параллельного перебора. */
    pinChecks: () => pinChecks,
  };
}
