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

export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const fromB64 = (s) => Buffer.from(s, 'base64url');
const parseJsonPart = (s) => JSON.parse(fromB64(s).toString('utf8'));

/** Ключи провайдера по стандартному адресу. В тестах и при настройке подменяются. */
export async function fetchProviderKeys(provider) {
  const res = await fetch(PROVIDER_JWKS_URLS[provider]);
  if (!res.ok) throw new Error(`jwks ${provider}: HTTP ${res.status}`);
  return res.json();
}

/**
 * providers: { google: { clientIds: [...] }, apple: { clientIds: [...] } }
 * keysSource(provider) -> { keys: [jwk, ...] }
 * nowMs() -> миллисекунды по часам сервера
 * verify(provider, idToken, nonce) -> { ok: true, identity } | { ok: false, reason }
 */
export function createProviderVerifier({ providers, keysSource, nowMs }) {
  const cache = new Map();
  const keysFor = async (provider, kid) => {
    const at = nowMs();
    let entry = cache.get(provider);
    if (!entry || at - entry.at > KEY_CACHE_MS || !entry.keys.some((k) => k.kid === kid)) {
      const fetched = await keysSource(provider);
      entry = { at, keys: Array.isArray(fetched?.keys) ? fetched.keys : [] };
      cache.set(provider, entry);
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
    const jwk = (await keysFor(provider, header.kid)).find((k) => k.kid === header.kid && k.kty === 'RSA');
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
