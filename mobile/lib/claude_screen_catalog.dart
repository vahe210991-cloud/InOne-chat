/// Screen source map for the Claude UI handoff (Ui.zip).
/// The original files are kept as source assets; matching is always by stable ID.
/// Screens absent from this handoff remain in the existing development gallery.
enum UiDeliveryStage { beta1, beta2, later }

class ClaudeScreenSource {
  const ClaudeScreenSource({
    required this.id,
    required this.title,
    required this.path,
    required this.batch,
    required this.stage,
    this.api,
  });

  final String id;
  final String title;
  final String path;
  final int batch;
  final UiDeliveryStage stage;
  final String? api;
}

/// IDs and paths are copied from ui-approval/screen-manifest.json.
/// Beta 2.0 screens are intentionally retained and marked as placeholders.
const claudeScreenSources = <ClaudeScreenSource>[
  ClaudeScreenSource(id: 'SC-01', title: 'Вход', path: 'screens/auth/SC-01.html', batch: 1, stage: UiDeliveryStage.beta1, api: 'POST /login'),
  ClaudeScreenSource(id: 'SC-02', title: 'Регистрация: почта', path: 'screens/auth/SC-02.html', batch: 1, stage: UiDeliveryStage.beta1, api: 'POST /register/email'),
  ClaudeScreenSource(id: 'SC-03', title: 'Регистрация: код из письма', path: 'screens/auth/SC-03.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-04', title: 'Регистрация: ник, пароль, телефон', path: 'screens/auth/SC-04.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-05', title: 'Вход через Google или Apple', path: 'screens/auth/SC-05.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-06', title: 'Регистрация через провайдера: ник', path: 'screens/auth/SC-06.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-07', title: 'Восстановление: старт', path: 'screens/auth/SC-07.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-08', title: 'Восстановление: подтверждение по ссылке', path: 'screens/auth/SC-08.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-09', title: 'Восстановление: новый пароль', path: 'screens/auth/SC-09.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-10', title: 'Отмена: «Это не вы?»', path: 'screens/auth/SC-10.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-11', title: 'Ожидание входа с нового устройства', path: 'screens/auth/SC-11.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-12', title: 'Выход', path: 'screens/auth/SC-12.html', batch: 1, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SC-00', title: 'Главное меню', path: 'screens/menu/SC-00.html', batch: 2, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'RQ-01', title: 'Новая заявка', path: 'screens/organizations/RQ-01.html', batch: 2, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'RQ-02', title: 'Документы заявки', path: 'screens/organizations/RQ-02.html', batch: 2, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'RQ-03', title: 'Мои заявки', path: 'screens/organizations/RQ-03.html', batch: 2, stage: UiDeliveryStage.beta1, api: 'GET /org-requests'),
  ClaudeScreenSource(id: 'RQ-04', title: 'Карточка заявки', path: 'screens/organizations/RQ-04.html', batch: 2, stage: UiDeliveryStage.beta1, api: 'GET /org-requests/:id'),
  ClaudeScreenSource(id: 'PS-01', title: 'Список заявок', path: 'screens/admin/PS-01.html', batch: 2, stage: UiDeliveryStage.beta1, api: 'GET /org-requests'),
  ClaudeScreenSource(id: 'PS-02', title: 'Карточка и документы: просмотр', path: 'screens/admin/PS-02.html', batch: 2, stage: UiDeliveryStage.beta1, api: 'GET /org-requests/:id'),
  ClaudeScreenSource(id: 'PS-03', title: 'Решение по заявке', path: 'screens/admin/PS-03.html', batch: 2, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'SR-01', title: 'Поиск людей', path: 'screens/search/SR-01.html', batch: 2, stage: UiDeliveryStage.beta1, api: 'GET /users/search'),
  ClaudeScreenSource(id: 'ST-01', title: 'Настройки уведомлений', path: 'screens/settings/ST-01.html', batch: 2, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'ST-02', title: 'Состояние системы', path: 'screens/settings/ST-02.html', batch: 2, stage: UiDeliveryStage.beta1, api: 'GET /config'),
  ClaudeScreenSource(id: 'ST-03', title: 'Баннеры и общие состояния', path: 'screens/settings/ST-03.html', batch: 2, stage: UiDeliveryStage.beta1, api: 'GET /config/public'),
  ClaudeScreenSource(id: 'CH-01', title: 'Список чатов', path: 'screens/chat/CH-01.html', batch: 0, stage: UiDeliveryStage.beta1, api: 'GET /rooms/mine'),
  ClaudeScreenSource(id: 'CH-02', title: 'Переписка', path: 'screens/chat/CH-02.html', batch: 0, stage: UiDeliveryStage.beta1, api: 'GET /rooms/:id/events'),
  ClaudeScreenSource(id: 'GR-01', title: 'Группы и каналы', path: 'screens/rooms/GR-01.html', batch: 0, stage: UiDeliveryStage.beta1, api: 'GET /rooms/mine'),
  ClaudeScreenSource(id: 'GR-02', title: 'Создание группы', path: 'screens/rooms/GR-02.html', batch: 0, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'GR-04', title: 'Настройки группы', path: 'screens/rooms/GR-04.html', batch: 0, stage: UiDeliveryStage.beta1),
  ClaudeScreenSource(id: 'OR-01', title: 'Мои организации', path: 'screens/organizations/OR-01.html', batch: 0, stage: UiDeliveryStage.beta1, api: 'GET /orgs/mine'),
  ClaudeScreenSource(id: 'PR-01', title: 'Профиль', path: 'screens/profile/PR-01.html', batch: 0, stage: UiDeliveryStage.beta1, api: 'GET /profile'),
];

const beta2ScreenIds = <String>{
  'leads-light', 'leads-dark', 'kanban-light', 'kanban-dark',
  'deal-detail-light', 'deal-detail-dark',
};

const beta2ScreenPlaceholder =
    'Beta 2.0 — экран сохранён в среде разработки; функциональность пока заглушка.';
