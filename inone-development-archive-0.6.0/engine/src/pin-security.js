import { randomBytes, scrypt, argon2, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const argon2Async = promisify(argon2);
export const PIN_LENGTH = 8;
export const PIN_FREE_ATTEMPTS = 2;
export const PIN_LOCK_BASE_MS = 30 * 60_000;
export const PIN_MAX_LOCK_MS = 24 * 60 * 60_000;
export const PIN_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60_000;
export const PIN_VERIFICATION_INTERVAL_MS = 30 * 24 * 60 * 60_000;

const ARGON2 = Object.freeze({
  version: 19,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
  outputBytes: 32,
});
const MAX_ACTIVE_KDFS = 2;
const MAX_QUEUED_KDFS = 16;
let activeKdfs = 0;
const kdfQueue = [];

async function withKdfSlot(work) {
  if (activeKdfs < MAX_ACTIVE_KDFS) {
    activeKdfs += 1;
  } else {
    if (kdfQueue.length >= MAX_QUEUED_KDFS) {
      const error = new Error('PIN verification capacity is temporarily unavailable');
      error.code = 'PIN_KDF_BUSY';
      throw error;
    }
    await new Promise((resolve) => kdfQueue.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = kdfQueue.shift();
    if (next) next();
    else activeKdfs -= 1;
  }
}

export function validatePin(pin) {
  return typeof pin === 'string' && /^[0-9]{8}$/.test(pin);
}

export function validateLegacyPin(pin) {
  return typeof pin === 'string' && /^[0-9]{6,12}$/.test(pin);
}

export function weakPinReason(pin) {
  if (!validatePin(pin)) return 'PIN must contain exactly eight digits';
  if (/^(\d)\1{7}$/.test(pin)) return 'PIN is too simple';
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  if ((step === 1 || step === -1) && digits.every((digit, index) => index === 0 || digit - digits[index - 1] === step)) {
    return 'PIN is too simple';
  }
  if (/^(\d{2,4})\1+$/.test(pin)) return 'PIN is too simple';
  return null;
}

export function lockDurationMs(attempt) {
  if (!Number.isSafeInteger(attempt) || attempt < 3) return 0;
  const exponent = Math.min(attempt - 3, 20);
  return Math.min(PIN_MAX_LOCK_MS, PIN_LOCK_BASE_MS * (2 ** exponent));
}

const legacyPepperedPin = (pepper, pin) =>
  createHmac('sha256', Buffer.from(pepper, 'utf8')).update(pin, 'utf8').digest();

function parseLegacyHash(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 2) return null;
  const salt = Buffer.from(parts[0], 'base64');
  const hash = Buffer.from(parts[1], 'base64');
  if (salt.length !== 16 || hash.length !== 32) return null;
  return { salt, hash };
}

function parseArgonHash(stored) {
  if (typeof stored !== 'string') return null;
  const match = /^argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(stored);
  if (!match) return null;
  const salt = Buffer.from(match[1], 'base64url');
  const hash = Buffer.from(match[2], 'base64url');
  if (salt.length !== 16 || hash.length !== ARGON2.outputBytes) return null;
  return { salt, hash };
}

async function derive(pin, salt, pepper) {
  const message = Buffer.from(pin, 'utf8');
  const secret = Buffer.from(pepper, 'utf8');
  try {
    return await withKdfSlot(() => argon2Async('argon2id', {
      message,
      nonce: salt,
      version: ARGON2.version,
      parallelism: ARGON2.parallelism,
      tagLength: ARGON2.outputBytes,
      memory: ARGON2.memoryKiB,
      passes: ARGON2.iterations,
      secret,
    }));
  } finally {
    message.fill(0);
    secret.fill(0);
  }
}

export async function hashPin(pepper, pin) {
  if (!validatePin(pin)) throw new TypeError('PIN must contain exactly eight ASCII digits');
  if (typeof pepper !== 'string' || Buffer.byteLength(pepper, 'utf8') < 32) {
    throw new Error('PIN_PEPPER must contain at least 32 bytes');
  }
  const salt = randomBytes(16);
  const derived = Buffer.from(await derive(pin, salt, pepper));
  try {
    return `argon2id$v=${ARGON2.version}$m=${ARGON2.memoryKiB},t=${ARGON2.iterations},p=${ARGON2.parallelism}${salt.toString('base64url')}${derived.toString('base64url')}`;
  } finally {
    derived.fill(0);
  }
}

export async function checkPin(pepper, pin, stored) {
  if (typeof pepper !== 'string' || Buffer.byteLength(pepper, 'utf8') < 32) return false;
  const current = parseArgonHash(stored);
  if (current) {
    if (!validatePin(pin)) return false;
    const actual = Buffer.from(await derive(pin, current.salt, pepper));
    try {
      return actual.length === current.hash.length && timingSafeEqual(actual, current.hash);
    } finally {
      actual.fill(0);
    }
  }
  const legacy = parseLegacyHash(stored);
  if (!legacy || !validateLegacyPin(pin)) return false;
  const secret = legacyPepperedPin(pepper, pin);
  let actual;
  try {
    actual = await withKdfSlot(() => scryptAsync(secret, legacy.salt, 32, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }));
  } finally {
    secret.fill(0);
  }
  try {
    return actual.length === legacy.hash.length && timingSafeEqual(actual, legacy.hash);
  } finally {
    actual.fill(0);
  }
}

export function pinHashNeedsUpgrade(stored) {
  return typeof stored !== 'string' || !stored.startsWith('argon2id$');
}
