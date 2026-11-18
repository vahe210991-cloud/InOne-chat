class ScreenApiProbe {
  const ScreenApiProbe(this.label, this.path, {this.authenticated = true, this.needsId = false, this.needsQuery = false});
  final String label;
  final String path;
  final bool authenticated;
  final bool needsId;
  final bool needsQuery;
}

const Map<String, List<ScreenApiProbe>> screenApiProbes = {
  'CH-04': [ScreenApiProbe('Получить ссылку на файл', '/files/:id/url', needsId: true)],
  'CH-07': [ScreenApiProbe('Список стикеров', '/rooms/:id/stickers', needsId: true)],
  'PR-05': [ScreenApiProbe('Мои устройства', '/devices/mine')],
  'PR-07': [ScreenApiProbe('Запросы на вход', '/approvals')],
  'GR-03': [ScreenApiProbe('Поиск групп', '/rooms/search?q=:query', needsQuery: true)],
  'GR-04': [ScreenApiProbe('Детали группы', '/rooms/:id', needsId: true)],
  'GR-05': [ScreenApiProbe('Участники группы', '/rooms/:id/members', needsId: true)],
  'GR-06': [ScreenApiProbe('Приглашения группы', '/rooms/:id/invites', needsId: true)],
  'GR-07': [ScreenApiProbe('Заявки на вступление', '/rooms/:id/requests', needsId: true)],
  'OR-01': [ScreenApiProbe('Мои организации', '/orgs/mine')],
  'OR-02': [ScreenApiProbe('Участники организации', '/orgs/:id/members', needsId: true)],
  'OR-03': [ScreenApiProbe('Настройки организации', '/orgs/:id/settings', needsId: true)],
  'OR-04': [ScreenApiProbe('История настроек', '/orgs/:id/settings/log', needsId: true)],
  'OR-05': [ScreenApiProbe('Связи организации', '/orgs/:id/links', needsId: true)],
  'OR-06': [ScreenApiProbe('Журнал администратора', '/orgs/:id/admin-log', needsId: true)],
  'RQ-03': [ScreenApiProbe('Мои заявки', '/org-requests')],
  'RQ-04': [ScreenApiProbe('Карточка заявки', '/org-requests/:id', needsId: true)],
  'PS-01': [ScreenApiProbe('Очередь заявок платформы', '/org-requests')],
  'PS-02': [ScreenApiProbe('Проверка заявки', '/org-requests/:id', needsId: true)],
  'SR-01': [ScreenApiProbe('Поиск пользователя', '/users/search?nickname=:query', needsQuery: true)],
  'ST-01': [ScreenApiProbe('Мои устройства', '/devices/mine')],
  'ST-02': [ScreenApiProbe('Конфигурация сервиса', '/config')],
  'ST-03': [ScreenApiProbe('Публичная конфигурация', '/config/public', authenticated: false)],
  'org-profile-light': [ScreenApiProbe('Мои организации', '/orgs/mine')],
  'org-profile-dark': [ScreenApiProbe('Мои организации', '/orgs/mine')],
  'messages-light': [ScreenApiProbe('Список чатов', '/rooms/mine')],
  'messages-dark': [ScreenApiProbe('Список чатов', '/rooms/mine')],
  'notifications-light': [ScreenApiProbe('Синхронизация уведомлений', '/sync')],
  'notifications-dark': [ScreenApiProbe('Синхронизация уведомлений', '/sync')],
  'personal-profile-light': [ScreenApiProbe('Профиль', '/profile')],
  'personal-profile-dark': [ScreenApiProbe('Профиль', '/profile')],
  'chat-thread-light': [ScreenApiProbe('Детали группы', '/rooms/:id', needsId: true)],
  'chat-thread-dark': [ScreenApiProbe('Детали группы', '/rooms/:id', needsId: true)],
};
