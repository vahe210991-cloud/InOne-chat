// ============================================================================
// Проверка токена входа от провайдера (Google и Apple, OpenID Connect) — этап 2 модели аккаунта.
// Токен принимается, только если: подпись RS256 по ключу провайдера, издатель,
// аудитория (наш client id), срок, subject, nonce (одноразовый, выдан нами),
// подтверждённая провайдером почта. Ключи берутся по стандартным адресам либо подставляются.
// ============================================================================
import { createHash, createPublicKey, createVerify } from 'node:crypto';

export const PROVIDER_JWKS_URLS = {
  google: 'https://www.googleapis.com/oauth2/v3/certs',
  apple: 'https://appleid.apple.com/auth/keys',
};
export const PROVIDER_ISSUERS = {
  google: ['https://accounts.google.com', 'accounts.google.com'],
  apple: ['https://appleid.apple.com'],
};
export const APPLE_RELAY_SUFFIX = '@privaterelay.appleid.com';
const KEY_CACHE_MS = 60 * 60_000;
const JWKS_TIMEOUT_MS = 5000;
const JWKS_MAX_BYTES = 256 * 1024;
const JWKS_MAX_KEYS = 100;
const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 30_000;

export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const fromB64 = (s) => Buffer.from(s, 'base64url');
const parseJsonPart = (s) => JSON.parse(fromB64(s).toString('utf8'));

/** Ключи провайдера по стандартному адресу. Ответ ограничен по времени и размеру. */
export async function fetchProviderKeys(provider, { fetchImpl = fetch, timeoutMs = JWKS_TIMEOUT_MS, maxBytes = JWKS_MAX_BYTES } = {}) {
  const url = PROVIDER_JWKS_URLS[provider];
  if (!url) throw new Error('jwks provider is not supported');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('jwks request timeout')), JWKS_TIMEOUT_MS);
  timer.unref?.();
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json, application/jwk-set+json' } });
    if (!res.ok) throw new Error(`jwks ${provider}: HTTP ${res.status}`);
    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['application/json', 'application/jwk-set+json'].includes(contentType)) throw new Error('jwks response content type is invalid');
    const declaredLength = Number(res.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) throw new Error('jwks response is too large');
    if (!res.body) throw new Error('jwks response body is missing');
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) {
        controller.abort();
        throw new Error('jwks response is too large');
      }
      chunks.push(Buffer.from(chunk));
    }
    const payload = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!payload || !Array.isArray(payload.keys) || payload.keys.length === 0 || payload.keys.length > JWKS_MAX_KEYS) {
      throw new Error('jwks response shape is invalid');
    }
    if (payload.keys.some((key) => !key || typeof key !== 'object' || typeof key.kid !== 'string' || key.kid.length > 256 || key.kty !== 'RSA' || typeof key.n !== 'string' || typeof key.e !== 'string')) {
      throw new Error('jwks key entry is invalid');
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted && error?.name === 'AbortError') throw new Error('jwks request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * providers: { google: { clientIds: [...] }, apple: { clientIds: [...] } }
 * keysSource(provider) -> { keys: [jwk, ...] }
 * nowMs() -> миллисекунды по часам сервера
 * verify(provider, idToken, nonce) -> { ok: true, identity } | { ok: false, reason }
 */
export function createProviderVerifier({ providers, keysSource, nowMs }) {
  const cache = new Map();
  const inFlight = new Map();
  const lastUnknownKidRefresh = new Map();
  const refreshKeys = (provider) => {
    const active = inFlight.get(provider);
    if (active) return active;
    const pending = Promise.resolve()
      .then(() => keysSource(provider))
      .then((fetched) => {
        if (!Array.isArray(fetched?.keys) || fetched.keys.length === 0 || fetched.keys.length > JWKS_MAX_KEYS) {
          throw new Error('jwks key set is invalid');
        }
        const entry = { at: nowMs(), keys: fetched.keys };
        cache.set(provider, entry);
        return entry;
      })
      .finally(() => inFlight.delete(provider));
    inFlight.set(provider, pending);
    return pending;
  };
  const keysFor = async (provider, kid) => {
    const at = nowMs();
    let entry = cache.get(provider);
    if (!entry || at - entry.at > KEY_CACHE_MS) {
      entry = await refreshKeys(provider);
    } else if (!entry.keys.some((key) => key.kid === kid)) {
      const last = lastUnknownKidRefresh.get(provider) ?? 0;
      if (at - last >= UNKNOWN_KID_REFRESH_COOLDOWN_MS) {
        lastUnknownKidRefresh.set(provider, at);
        entry = await refreshKeys(provider);
      }
    }
    return entry.keys;
  };

  return async function verify(provider, idToken, nonce) {
    const cfg = providers[provider];
    if (!cfg?.clientIds?.length) return { ok: false, reason: 'provider-disabled' };
    if (typeof idToken !== 'string' || typeof nonce !== 'string' || nonce === '') return { ok: false, reason: 'malformed' };
    const parts = idToken.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    let header;
    let claims;
    try {
      header = parseJsonPart(parts[0]);
      claims = parseJsonPart(parts[1]);
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (header.alg !== 'RS256') return { ok: false, reason: 'alg' };
    if (typeof header.kid !== 'string' || header.kid === '' || header.kid.length > 256) return { ok: false, reason: 'kid' };
    const jwk = (await keysFor(provider, header.kid)).find((k) => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
    if (!jwk) return { ok: false, reason: 'kid' };
    let signed = false;
    try {
      signed = createVerify('RSA-SHA256')
        .update(`${parts[0]}.${parts[1]}`)
        .verify(createPublicKey({ key: jwk, format: 'jwk' }), fromB64(parts[2]));
    } catch {
      signed = false;
    }
    if (!signed) return { ok: false, reason: 'signature' };
    if (!PROVIDER_ISSUERS[provider].includes(claims.iss)) return { ok: false, reason: 'issuer' };
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.some((a) => cfg.clientIds.includes(a))) return { ok: false, reason: 'audience' };
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs()) return { ok: false, reason: 'expired' };
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf * 1000 > nowMs())) return { ok: false, reason: 'not-yet-valid' };
    if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub.length > 255) return { ok: false, reason: 'subject' };
    // Nonce: наш одноразовый либо его SHA-256 (так передают nonce Apple и Google SDK).
    if (!(claims.nonce === nonce || claims.nonce === sha256Hex(nonce))) return { ok: false, reason: 'nonce' };
    if (typeof claims.email !== 'string' || !claims.email.includes('@')) return { ok: false, reason: 'email' };
    // Apple иногда отдаёт email_verified строкой.
    if (!(claims.email_verified === true || claims.email_verified === 'true')) return { ok: false, reason: 'unverified-email' };
    const email = claims.email.trim().toLowerCase();
    return { ok: true, identity: { provider, sub: claims.sub, email, relay: email.endsWith(APPLE_RELAY_SUFFIX) } };
  };
}
