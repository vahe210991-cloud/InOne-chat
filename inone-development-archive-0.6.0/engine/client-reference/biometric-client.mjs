// ============================================================================
// Референсный клиент биометрического подтверждения (этап 2б, общие настройки InOne и Propo).
// Протокол и состояния совпадают с движком InOne 0.6.0-alpha.19. Propo переносит эту логику на Dart:
// те же вызовы, те же состояния, те же тексты ошибок. Закрытый ключ здесь программный и только для тестов.
// ============================================================================
import { createSign, generateKeyPairSync } from 'node:crypto';

export const MESSAGE_PREFIX = 'inone-stepup-v1';

/** Сообщение, которое подписывает устройство. Порядок полей и разделители обязательны. */
export function signingMessage({ userId, deviceId, action, nonce }) {
  return `${MESSAGE_PREFIX}|${userId}|${deviceId}|${action}|${nonce}`;
}

export const STATES = Object.freeze({ UNAVAILABLE: 'unavailable', OFF: 'off', ON: 'on', INVALIDATED: 'invalidated' });

/** Ключ в защищённом хранилище устройства: Secure Enclave, Android Keystore или Windows Hello в приложении. */
export class SoftwareSigner {
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.valid = true;
  }

  publicJwk() {
    const jwk = this.publicKey.export({ format: 'jwk' });
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  }

  /** Подпись ECDSA P-256 с SHA-256 в формате DER, base64url. В приложении вызывается только после биометрии. */
  sign(message) {
    if (!this.valid) throw new Error('key-invalidated');
    return createSign('SHA256').update(message).sign({ key: this.privateKey, dsaEncoding: 'der' }).toString('base64url');
  }

  /** Имитация смены биометрии: системный ключ больше не работает. */
  invalidate() {
    this.valid = false;
  }
}

export class BiometricClient {
  constructor({ baseUrl, token, deviceId, userId, signer = null, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.deviceId = deviceId;
    this.userId = userId;
    this.signer = signer;
    this.fetchImpl = fetchImpl;
    this.state = signer ? STATES.ON : STATES.OFF;
  }

  async request(method, path, body) {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  }

  describe() {
    return this.state;
  }

  /** Показать предложение включить биометрию при первом входе через Google или Apple (подсказка движка). */
  shouldOffer(profile) {
    return Array.isArray(profile?.securityHints) && profile.securityHints.includes('offer_biometric');
  }

  /** Сброс локального состояния: ключа нет, биометрия выключена на этом устройстве. */
  reset() {
    this.signer = null;
    this.state = STATES.OFF;
  }

  /** Включение: новый ключ, открытая часть уходит на сервер. Подтверждение — пароль или код с почты (stepupToken). */
  async enable({ password, stepupToken } = {}) {
    if (!this.signer) this.signer = new SoftwareSigner();
    const r = await this.request('POST', '/devices/signing-key', { publicKey: this.signer.publicJwk(), password, stepupToken });
    if (r.status === 200) this.state = STATES.ON;
    return r;
  }

  /** Выключение: подтверждение паролем или кодом с почты. Локальный ключ удаляется. */
  async disable({ password, stepupToken } = {}) {
    const r = await this.request('POST', '/devices/signing-key/remove', { password, stepupToken });
    if (r.status === 200) this.reset();
    return r;
  }

  /** Подтверждение действия биометрией: вызов, подпись, грант. Грант сразу используется и не хранится. */
  async grant(action) {
    if (this.state === STATES.OFF) return { ok: false, reason: 'off' };
    if (this.state === STATES.INVALIDATED) return { ok: false, reason: 'invalidated' };
    const ch = await this.request('POST', '/stepup/biometric/challenge', { action });
    if (ch.status !== 200) return { ok: false, reason: 'challenge', status: ch.status };
    let signature;
    try {
      signature = this.signer.sign(signingMessage({ userId: this.userId, deviceId: this.deviceId, action, nonce: ch.body.nonce }));
    } catch {
      this.state = STATES.INVALIDATED;
      return { ok: false, reason: 'invalidated' };
    }
    const conf = await this.request('POST', '/stepup/biometric/confirm', { challengeId: ch.body.challengeId, signature });
    if (conf.status !== 200) return { ok: false, reason: 'confirm', status: conf.status };
    return { ok: true, grant: conf.body.grant };
  }

  /** Одобрение нового устройства: если биометрия включена, одобрение возможно только с грантом. */
  async approveDevice(approvalId, code) {
    const body = { code };
    if (this.state === STATES.ON) {
      const g = await this.grant('approve-device');
      if (!g.ok) return { status: 0, reason: g.reason };
      body.bioGrant = g.grant;
    }
    return this.request('POST', `/approvals/${approvalId}/approve`, body);
  }
}
