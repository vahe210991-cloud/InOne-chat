// Тестовый экран «Мои организации» (шаг 5.9). Без дизайна: только функции.
// Логика (тексты ошибок, выбор) проверяется тестами; разметка — client-test-ui/orgs.html.

export const ORG_ERROR_TEXT = {
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
};

// Текст ошибки для показа: по коду, затем по тексту сервера, иначе — общая ошибка с кодом статуса.
export function errorText(status, body) {
  const code = body && typeof body.code === 'string' ? body.code : '';
  if (ORG_ERROR_TEXT[code]) return ORG_ERROR_TEXT[code];
  if (body && body.error === 'group is full') return 'Группа достигла лимита участников.';
  if (body && typeof body.error === 'string') return `Ошибка ${status}: ${body.error}`;
  return `Ошибка ${status}.`;
}

// Выбрать можно только одобренную организацию: ожидающие и отклонённые — нет.
export function canSelect(org) {
  return org.status === 'approved';
}

export function selectable(orgs) {
  return orgs.filter(canSelect);
}

export function describeOrg(org) {
  return `${org.name} — роль: ${org.role}, статус: ${org.status}`;
}

// Разметка подключается только в браузере; в тестах (Node) этот блок не выполняется.
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  let token = '';
  let orgs = [];
  let chosen = null;
  const showError = (text) => { $('error-box').textContent = text; };
  const call = async (method, path, body) => {
    const base = $('base-url').value.replace(/\/$/, '');
    const res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  const render = () => {
    const list = $('org-list');
    list.textContent = '';
    for (const org of orgs) {
      const li = document.createElement('li');
      li.textContent = describeOrg(org) + (chosen === org.orgId ? ' [выбрана]' : '');
      if (canSelect(org)) {
        const button = document.createElement('button');
        button.textContent = 'Выбрать';
        button.onclick = () => {
          chosen = org.orgId;
          $('chosen').textContent = `Выбрана: ${org.name}`;
          render();
        };
        li.appendChild(button);
      }
      list.appendChild(li);
    }
  };
  $('load-orgs').onclick = async () => {
    token = $('token').value.trim();
    const r = await call('GET', '/orgs/mine');
    if (r.status !== 200) return showError(errorText(r.status, r.json));
    orgs = r.json.orgs;
    showError('');
    render();
  };
  $('leave-org').onclick = async () => {
    if (!chosen) return showError('Сначала выберите организацию.');
    const r = await call('POST', `/orgs/${encodeURIComponent(chosen)}/leave`, {});
    if (r.status !== 200) return showError(errorText(r.status, r.json));
    orgs = orgs.filter((o) => o.orgId !== chosen);
    chosen = null;
    $('chosen').textContent = 'Не выбрана';
    showError('');
    render();
  };
}
