// Общий слой запросов к движку (этап 0.7.0). Работает в браузере и в Node (для тестов).
// Токен хранится только в памяти: без localStorage, sessionStorage и cookies.

// Тексты ошибок по полю code. Покрывают все коды, которые отдаёт сервер (проверяется тестом).
export const ERROR_TEXT = Object.freeze({
  token_expired: 'Сессия истекла. Войдите снова.',
  refresh_expired: 'Срок входа истёк. Войдите снова.',
  refresh_reused: 'Вход завершён из соображений безопасности. Войдите снова.',
  refresh_unknown: 'Сессия не найдена. Войдите снова.',
  device_revoked: 'Это устройство отключено. Войдите снова.',
  maintenance: 'Сервис на техническом обслуживании. Попробуйте позже.',
  feature_disabled: 'Эта функция сейчас отключена.',
  org_not_found: 'Организация не найдена.',
  org_not_approved: 'Организация ещё не одобрена.',
  org_not_member: 'Вы не участник этой организации.',
  org_role_required: 'Это может сделать владелец или администратор организации.',
  last_owner: 'Нельзя понизить или удалить последнего владельца.',
  owns_rooms: 'Сначала передайте комнаты, которыми вы владеете.',
  link_exists: 'Связь с этой организацией уже есть.',
  link_own_side: 'Связь принимает другая сторона.',
  not_platform_owner: 'Решение принимает владелец платформы.',
  org_channels_disabled: 'В организации отключены каналы.',
  org_quota_exceeded: 'Превышена квота хранения организации.',
});

// Текст ошибки для показа: сначала по коду, затем по статусу, затем общий текст.
export function errorText(status, body) {
  const code = body && typeof body.code === 'string' ? body.code : '';
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (status === 0) return 'Нет связи с сервером.';
  if (status === 429) return 'Слишком много запросов. Подождите и попробуйте снова.';
  if (status === 503) return 'Сервис временно недоступен.';
  if (body && body.error === 'group is full') return 'Группа достигла лимита участников.';
  return body && typeof body.error === 'string' ? `Ошибка ${status}: ${body.error}` : `Ошибка ${status}.`;
}

// Создаёт клиент движка. fetchImpl подменяется в тестах; onUnauthorized вызывается при 401.
export function createApi({ baseUrl, fetchImpl = globalThis.fetch, onUnauthorized = () => {} }) {
  let token = '';
  const base = String(baseUrl).replace(/\/+$/, '');
  return {
    setToken(value) {
      token = String(value || '');
    },
    clearToken() {
      token = '';
    },
    hasToken() {
      return token !== '';
    },
    async request(method, path, body) {
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      let res;
      try {
        res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch {
        return { ok: false, status: 0, data: null, error: errorText(0, null) };
      }
      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (res.status === 401) {
        token = '';
        onUnauthorized();
      }
      const ok = res.status >= 200 && res.status < 300;
      return { ok, status: res.status, data, error: ok ? '' : errorText(res.status, data) };
    },
  };
}
