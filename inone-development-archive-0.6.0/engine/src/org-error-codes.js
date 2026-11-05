// Коды ошибок организаций (шаг 5.9). Клиент показывает понятное сообщение по коду, а не по тексту ответа.
// Список сверяется с сервером и с ORG_API.md тестом test/org-error-codes.test.js.
export const ORG_ERROR_CODES = Object.freeze([
  'org_not_found',
  'org_not_approved',
  'org_not_member',
  'org_role_required',
  'last_owner',
  'owns_rooms',
  'link_exists',
  'link_own_side',
  'not_platform_owner',
  'org_channels_disabled',
  'org_quota_exceeded',
]);
