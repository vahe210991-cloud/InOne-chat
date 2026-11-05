import { createHash, randomBytes } from 'crypto';

// Сроки и прочтение сообщений беседы. Правка и удаление ограничены по времени,
// удаление — ещё и прочтением любым другим участником.

/** Правку можно внести в течение 24 часов после отправки. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Удалить можно не позже 24 часов после отправки и только до прочтения. */
export const DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const ROOM_VISIBILITIES = Object.freeze(['private', 'public']);
export const ROOM_JOIN_POLICIES = Object.freeze(['approval', 'open']);
export const MAX_ROOM_NAME_LENGTH = 100;

export function editWindowClosed(event, nowMs) {
  return nowMs - event.origin_ts > EDIT_WINDOW_MS;
}

export function deleteWindowClosed(event, nowMs) {
  return nowMs - event.origin_ts > DELETE_WINDOW_MS;
}

/** Сообщение прочитано, если хотя бы один другой участник дочитал до него или дальше. */
export function readByOthers(room, event) {
  return Object.entries(room.readUpTo ?? {}).some(([userId, seq]) => userId !== event.sender && seq >= event.seq);
}

/** Проверка значений настроек группы. Возвращает { value } или { error }. */
export function validateRoomSettings(input) {
  if (!input || typeof input !== 'object') return { error: 'settings must be an object' };
  const value = {};
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') return { error: 'name must be a string' };
    const name = input.name.trim();
    if (name.length < 1 || name.length > MAX_ROOM_NAME_LENGTH) return { error: `name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters` };
    value.name = name;
  }
  if (input.visibility !== undefined) {
    if (!ROOM_VISIBILITIES.includes(input.visibility)) return { error: 'visibility must be private or public' };
    value.visibility = input.visibility;
  }
  if (input.joinPolicy !== undefined) {
    if (!ROOM_JOIN_POLICIES.includes(input.joinPolicy)) return { error: 'joinPolicy must be approval or open' };
    value.joinPolicy = input.joinPolicy;
  }
  if (Object.keys(value).length === 0) return { error: 'nothing to change' };
  return { value };
}

export const INVITE_DEFAULT_HOURS = 168; // 7 дней
export const INVITE_MAX_HOURS = 720;     // 30 дней
export const INVITE_MAX_USES = 10000;

/** Параметры ссылки-приглашения из запроса. Возвращает { value } или { error }. */
export function validateInviteOptions(input = {}) {
  const expiresInHours = input.expiresInHours ?? INVITE_DEFAULT_HOURS;
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > INVITE_MAX_HOURS) {
    return { error: `expiresInHours must be an integer from 1 to ${INVITE_MAX_HOURS}` };
  }
  const maxUses = input.maxUses ?? null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITE_MAX_USES)) {
    return { error: `maxUses must be an integer from 1 to ${INVITE_MAX_USES}, or null` };
  }
  const requiresApproval = input.requiresApproval ?? false;
  if (typeof requiresApproval !== 'boolean') return { error: 'requiresApproval must be a boolean' };
  return { value: { expiresInHours, maxUses, requiresApproval } };
}

/** Ссылка действует, если не отозвана, не истекла и не исчерпан лимит вступлений. */
export function inviteUsable(invite, nowMs) {
  return !invite.revoked && nowMs < invite.expiresAt && (invite.maxUses === null || invite.uses < invite.maxUses);
}

export function createInviteToken() {
  return randomBytes(32).toString('base64url');
}

export function createInviteId() {
  return `inv_${randomBytes(9).toString('hex')}`;
}

/** В базе хранится только хэш токена: утечка данных не даёт рабочих ссылок. */
export function hashInviteToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}
