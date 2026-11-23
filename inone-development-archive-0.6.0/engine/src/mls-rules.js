// Правила ключевых пакетов MLS (KeyPackage). Сервер не разбирает пакет: проверяет размер, количество и кодировку.
export const MLS_UPLOAD_MAX = 50;          // пакетов за один запрос
export const MLS_PACKAGE_MAX_BYTES = 4096; // размер одного пакета
export const MLS_UNUSED_MAX = 100;         // неиспользованных пакетов на устройство

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseKeyPackages(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MLS_UPLOAD_MAX) {
    return { error: `packages must be an array of 1 to ${MLS_UPLOAD_MAX} items` };
  }
  const bytes = [];
  for (const item of input) {
    if (typeof item !== 'string' || !BASE64.test(item)) return { error: 'each package must be base64' };
    const data = Buffer.from(item, 'base64');
    if (data.length === 0 || data.length > MLS_PACKAGE_MAX_BYTES) {
      return { error: `each package must be 1 to ${MLS_PACKAGE_MAX_BYTES} bytes` };
    }
    bytes.push(data);
  }
  return { value: bytes };
}

// Коммиты и приветственные сообщения. Коммит для 500 участников измерен до 41,6 КБ, поэтому лимит с запасом.
export const MLS_COMMIT_MAX_BYTES = 262144;
// Приветствие несёт дерево группы: для 500 участников измерено до 111 КБ (среднее 56 КБ), растёт примерно линейно.
export const MLS_WELCOME_MAX_BYTES = 524288;
export const MLS_WELCOMES_PER_COMMIT_MAX = 50;
export const MLS_CHANGES_PER_COMMIT_MAX = 50;

function decodeBase64Field(text, maxBytes) {
  if (typeof text !== 'string' || !BASE64.test(text)) return { error: 'must be base64' };
  if (text.length > Math.ceil(maxBytes / 3) * 4 + 4) return { error: 'too large' };
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes) return { error: `must be 1 to ${maxBytes} bytes` };
  return { value: bytes };
}

export function parseCommitRequest(input) {
  if (!input || typeof input !== 'object') return { error: 'body must be an object' };
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) return { error: 'epoch must be a non-negative integer' };
  const clientOperationId = input.clientOperationId ?? null;
  if (clientOperationId !== null && (typeof clientOperationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(clientOperationId))) {
    return { error: 'clientOperationId must be 16-128 URL-safe characters' };
  }
  const joinRequestUserId = input.joinRequestUserId ?? null;
  if (joinRequestUserId !== null && (typeof joinRequestUserId !== 'string' || joinRequestUserId.length < 1 || joinRequestUserId.length > 200)) {
    return { error: 'joinRequestUserId must be a user id' };
  }
  const keyPackageClaimId = input.keyPackageClaimId ?? null;
  if (keyPackageClaimId !== null && (typeof keyPackageClaimId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(keyPackageClaimId))) {
    return { error: 'keyPackageClaimId must be 16-128 URL-safe characters' };
  }
  if (keyPackageClaimId !== null && keyPackageClaimId !== clientOperationId) {
    return { error: 'keyPackageClaimId must equal clientOperationId' };
  }
  const commit = decodeBase64Field(input.commit, MLS_COMMIT_MAX_BYTES);
  if (commit.error) return { error: `commit ${commit.error}` };
  const list = input.welcomes ?? [];
  if (!Array.isArray(list) || list.length > MLS_WELCOMES_PER_COMMIT_MAX) {
    return { error: `welcomes must be an array of at most ${MLS_WELCOMES_PER_COMMIT_MAX} items` };
  }
  const welcomes = [];
  for (const w of list) {
    if (!w || typeof w.userId !== 'string' || typeof w.deviceId !== 'string') return { error: 'each welcome needs userId and deviceId' };
    const bytes = decodeBase64Field(w.welcome, MLS_WELCOME_MAX_BYTES);
    if (bytes.error) return { error: `welcome ${bytes.error}` };
    welcomes.push({ userId: w.userId, deviceId: w.deviceId, welcome: bytes.value });
  }
  const changes = input.changes ?? { adds: [], removes: [] };
  if (!changes || typeof changes !== 'object') return { error: 'changes must be an object' };
  const names = (list, label) => {
    if (list === undefined) return { value: [] };
    if (!Array.isArray(list) || list.length > MLS_CHANGES_PER_COMMIT_MAX) return { error: `${label} must be an array of at most ${MLS_CHANGES_PER_COMMIT_MAX} items` };
    if (list.some((x) => typeof x !== 'string' || x.length < 1 || x.length > 200)) return { error: `each ${label} item must be a user id` };
    return { value: [...new Set(list)] };
  };
  const adds = names(changes.adds, 'changes.adds');
  if (adds.error) return { error: adds.error };
  const removes = names(changes.removes, 'changes.removes');
  if (removes.error) return { error: removes.error };
  const removeDevices = names(changes.removeDevices, 'changes.removeDevices');
  if (removeDevices.error) return { error: removeDevices.error };
  if (keyPackageClaimId !== null && adds.value.length !== 1) {
    return { error: 'a KeyPackage claim must add exactly one target user' };
  }
  if (joinRequestUserId !== null && (adds.value.length !== 1 || adds.value[0] !== joinRequestUserId || keyPackageClaimId === null)) {
    return { error: 'join request approval must add exactly its requester with a KeyPackage claim' };
  }
  return { value: { epoch: input.epoch, commit: commit.value, welcomes, changes: { adds: adds.value, removes: removes.value, removeDevices: removeDevices.value }, clientOperationId, keyPackageClaimId, joinRequestUserId } };
}

// Сообщения группы: шифротекст MLS в поле message, до 64 КБ.
export const MLS_APPLICATION_MAX_BYTES = 65536;

export function parseApplicationRequest(input) {
  if (!input || typeof input !== 'object') return { error: 'body must be an object' };
  const message = decodeBase64Field(input.message, MLS_APPLICATION_MAX_BYTES);
  if (message.error) return { error: `message ${message.error}` };
  return { value: message.value };
}

// Срок годности ключевых пакетов на сервере: обычные — 30 дней, резервный — 180 дней (он нужен для приглашений дольше).
export const MLS_REGULAR_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const MLS_LAST_RESORT_MAX_AGE_MS = 180 * 24 * 3600 * 1000;
