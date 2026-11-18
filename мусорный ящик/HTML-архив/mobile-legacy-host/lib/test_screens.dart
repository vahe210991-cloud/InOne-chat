enum ScreenStage { core, deferred, future }

class TestScreen {
  const TestScreen({required this.id, required this.title, required this.category, required this.status, required this.description, required this.stage});
  final String id;
  final String title;
  final String category;
  final String status;
  final String description;
  final ScreenStage stage;
}

const List<TestScreen> testScreens = [
  TestScreen(id: "SC-01", title: "Вход", category: "Вход и регистрация", status: "API описан · G13", description: "Вход в защищённое рабочее пространство", stage: ScreenStage.core),
  TestScreen(id: "SC-02", title: "Регистрация: почта", category: "Вход и регистрация", status: "API описан", description: "Начало регистрации с подтверждением адреса", stage: ScreenStage.core),
  TestScreen(id: "SC-03", title: "Подтверждение почты", category: "Вход и регистрация", status: "API описан", description: "Проверка кода из письма", stage: ScreenStage.core),
  TestScreen(id: "SC-04", title: "Создание аккаунта", category: "Вход и регистрация", status: "API описан · G13", description: "Завершение регистрации", stage: ScreenStage.core),
  TestScreen(id: "SC-05", title: "Вход через провайдера", category: "Вход и регистрация", status: "API описан · G13", description: "Безопасная авторизация через внешний аккаунт", stage: ScreenStage.core),
  TestScreen(id: "SC-06", title: "Регистрация через провайдера", category: "Вход и регистрация", status: "API описан · G13", description: "Выберите никнейм для нового аккаунта", stage: ScreenStage.core),
  TestScreen(id: "SC-07", title: "Восстановление доступа", category: "Вход и регистрация", status: "API описан · G13", description: "Начните восстановление безопасно", stage: ScreenStage.core),
  TestScreen(id: "SC-08", title: "Подтверждение по ссылке", category: "Вход и регистрация", status: "API описан · G13", description: "Открытие ссылки восстановления из письма", stage: ScreenStage.core),
  TestScreen(id: "SC-09", title: "Новый пароль", category: "Вход и регистрация", status: "API описан", description: "Задайте новый пароль для аккаунта", stage: ScreenStage.core),
  TestScreen(id: "SC-10", title: "Это не вы?", category: "Вход и регистрация", status: "API описан · G13", description: "Отмените подозрительное действие", stage: ScreenStage.core),
  TestScreen(id: "SC-11", title: "Ожидание подтверждения устройства", category: "Вход и регистрация", status: "API описан · G12/G13", description: "Вход с нового устройства ожидает подтверждения", stage: ScreenStage.core),
  TestScreen(id: "SC-12", title: "Выход из аккаунта", category: "Вход и регистрация", status: "API описан", description: "Завершение текущей сессии", stage: ScreenStage.core),
  TestScreen(id: "CH-03", title: "Отправка файла", category: "Чаты и вложения", status: "API описан · G8", description: "Добавьте документ или изображение в переписку", stage: ScreenStage.core),
  TestScreen(id: "CH-04", title: "Получение файла", category: "Чаты и вложения", status: "API описан", description: "Откройте вложение из сообщения", stage: ScreenStage.core),
  TestScreen(id: "CH-05", title: "Изменение сообщения", category: "Чаты и вложения", status: "Заблокировано · G5", description: "Редактирование собственного сообщения", stage: ScreenStage.core),
  TestScreen(id: "CH-06", title: "Удаление сообщения", category: "Чаты и вложения", status: "Заблокировано · G5", description: "Удалить сообщение из переписки?", stage: ScreenStage.core),
  TestScreen(id: "CH-07", title: "Стикеры и GIF", category: "Чаты и вложения", status: "Отложено до 0.8 · D10", description: "Выберите визуальный формат сообщения", stage: ScreenStage.deferred),
  TestScreen(id: "PR-02", title: "Резервная почта", category: "Профиль и безопасность", status: "API описан · G14", description: "Дополнительный адрес для восстановления", stage: ScreenStage.core),
  TestScreen(id: "PR-03", title: "Телефон", category: "Профиль и безопасность", status: "API описан", description: "Привяжите номер телефона к аккаунту", stage: ScreenStage.core),
  TestScreen(id: "PR-04", title: "Способы входа", category: "Профиль и безопасность", status: "API описан · G14", description: "Управляйте привязанными провайдерами", stage: ScreenStage.core),
  TestScreen(id: "PR-05", title: "Мои устройства", category: "Профиль и безопасность", status: "API описан · G6", description: "Все устройства, на которых открыт ваш аккаунт", stage: ScreenStage.core),
  TestScreen(id: "PR-06", title: "PIN-код", category: "Профиль и безопасность", status: "API описан", description: "Дополнительная защита важных действий", stage: ScreenStage.core),
  TestScreen(id: "PR-07", title: "Запросы на вход", category: "Профиль и безопасность", status: "API описан", description: "Подтвердите или отклоните вход с нового устройства", stage: ScreenStage.core),
  TestScreen(id: "PR-08", title: "Подтверждение по почте", category: "Профиль и безопасность", status: "API описан · G14", description: "Подтвердите защищённое действие кодом", stage: ScreenStage.core),
  TestScreen(id: "PR-09", title: "Биометрия", category: "Профиль и безопасность", status: "Недоступно в веб-экранах 0.7", description: "Подтверждение Face ID или Touch ID", stage: ScreenStage.core),
  TestScreen(id: "GR-01", title: "Группы и каналы", category: "Группы", status: "API описан · маршрут /rooms/mine присутствует в main", description: "Все рабочие пространства, в которых вы состоите", stage: ScreenStage.core),
  TestScreen(id: "GR-02", title: "Создание группы", category: "Группы", status: "API описан", description: "Создайте группу или канал для совместной работы", stage: ScreenStage.core),
  TestScreen(id: "GR-03", title: "Поиск групп", category: "Группы", status: "API описан", description: "Найдите открытую группу или отправьте заявку", stage: ScreenStage.core),
  TestScreen(id: "GR-04", title: "Настройки группы", category: "Группы", status: "API описан · G9/G15", description: "Управляйте правилами и оформлением группы", stage: ScreenStage.core),
  TestScreen(id: "GR-05", title: "Участники группы", category: "Группы", status: "API описан · G9/G10", description: "Состав, роли и управление участниками", stage: ScreenStage.core),
  TestScreen(id: "GR-06", title: "Приглашения", category: "Группы", status: "API описан", description: "Создавайте и контролируйте ссылки-приглашения", stage: ScreenStage.core),
  TestScreen(id: "GR-07", title: "Заявки на вступление", category: "Группы", status: "API описан · G9", description: "Решайте, кого принять в закрытую группу", stage: ScreenStage.core),
  TestScreen(id: "GR-08", title: "Покинуть группу", category: "Группы", status: "API описан", description: "Вы действительно хотите покинуть группу?", stage: ScreenStage.core),
  TestScreen(id: "GR-09", title: "Лимит участников", category: "Группы", status: "API описан", description: "В этой группе достигнут лимит участников", stage: ScreenStage.core),
  TestScreen(id: "OR-01", title: "Мои организации", category: "Организации", status: "API описан", description: "Организации, в которых вы работаете", stage: ScreenStage.core),
  TestScreen(id: "OR-02", title: "Участники организации", category: "Организации", status: "API описан · G9", description: "Состав организации и уровни доступа", stage: ScreenStage.core),
  TestScreen(id: "OR-03", title: "Настройки организации", category: "Организации", status: "API описан", description: "Параметры рабочего пространства", stage: ScreenStage.core),
  TestScreen(id: "OR-04", title: "История настроек", category: "Организации", status: "API описан", description: "История изменений параметров организации", stage: ScreenStage.core),
  TestScreen(id: "OR-05", title: "Связи организаций", category: "Организации", status: "API описан", description: "Управляйте связями с другими организациями", stage: ScreenStage.core),
  TestScreen(id: "OR-06", title: "Журнал администратора", category: "Организации", status: "API описан", description: "Аудит действий внутри организации", stage: ScreenStage.core),
  TestScreen(id: "OR-07", title: "Выход из организации", category: "Организации", status: "API описан", description: "Покинуть организацию?", stage: ScreenStage.core),
  TestScreen(id: "RQ-01", title: "Заявка на организацию", category: "Заявки организаций", status: "API описан", description: "Создайте рабочее пространство компании", stage: ScreenStage.core),
  TestScreen(id: "RQ-02", title: "Документы заявки", category: "Заявки организаций", status: "API описан · G9", description: "Подтвердите сведения об организации документами", stage: ScreenStage.core),
  TestScreen(id: "RQ-03", title: "Мои заявки", category: "Заявки организаций", status: "API описан", description: "Статусы рассмотрения заявок", stage: ScreenStage.core),
  TestScreen(id: "RQ-04", title: "Карточка заявки", category: "Заявки организаций", status: "API описан", description: "Данные заявки и приложенные документы", stage: ScreenStage.core),
  TestScreen(id: "PS-01", title: "Администрация платформы", category: "Администрация", status: "Зависит от G2", description: "Очередь заявок на создание организаций", stage: ScreenStage.core),
  TestScreen(id: "PS-02", title: "Проверка документов", category: "Администрация", status: "Зависит от G2", description: "Проверка данных организации и документов", stage: ScreenStage.core),
  TestScreen(id: "PS-03", title: "Решение по заявке", category: "Администрация", status: "Зависит от G2/G9", description: "Примите решение по заявке организации", stage: ScreenStage.core),
  TestScreen(id: "SR-01", title: "Поиск людей", category: "Поиск и настройки", status: "API описан · G1/G9", description: "Найдите коллегу по никнейму", stage: ScreenStage.core),
  TestScreen(id: "ST-01", title: "Уведомления на устройстве", category: "Поиск и настройки", status: "API описан", description: "Управляйте уведомлениями этого устройства", stage: ScreenStage.core),
  TestScreen(id: "ST-02", title: "Состояние системы", category: "Поиск и настройки", status: "API описан", description: "Версия сервиса и доступные возможности", stage: ScreenStage.core),
  TestScreen(id: "ST-03", title: "Системные состояния", category: "Поиск и настройки", status: "Общее поведение", description: "Общие сообщения, видимые поверх любого экрана", stage: ScreenStage.core),
  TestScreen(id: "CAL-01", title: "Календарь · месяц", category: "Календарь", status: "Следующий этап", description: "Общий календарь команды и личные события", stage: ScreenStage.future),
  TestScreen(id: "CAL-02", title: "Календарь · неделя", category: "Календарь", status: "Следующий этап", description: "Недельное расписание с занятостью участников", stage: ScreenStage.future),
  TestScreen(id: "CAL-03", title: "Событие · карточка", category: "Календарь", status: "Следующий этап", description: "Все детали встречи и её участники", stage: ScreenStage.future),
  TestScreen(id: "CAL-04", title: "Создать событие", category: "Календарь", status: "Следующий этап", description: "Запланируйте встречу или рабочее событие", stage: ScreenStage.future),
  TestScreen(id: "TASK-01", title: "Мои задачи", category: "Задачи", status: "Следующий этап", description: "Контроль поручений и сроков", stage: ScreenStage.future),
  TestScreen(id: "TASK-02", title: "Доска задач", category: "Задачи", status: "Следующий этап", description: "Kanban-представление исполнения", stage: ScreenStage.future),
  TestScreen(id: "TASK-03", title: "Карточка задачи", category: "Задачи", status: "Следующий этап", description: "Ответственные, сроки, файлы и история исполнения", stage: ScreenStage.future),
  TestScreen(id: "TASK-04", title: "Создать задачу", category: "Задачи", status: "Следующий этап", description: "Поставьте задачу с назначением ролей", stage: ScreenStage.future),
  TestScreen(id: "FILE-01", title: "Файлы и документы", category: "Файлы", status: "Следующий этап", description: "Единое пространство рабочих документов", stage: ScreenStage.future),
  TestScreen(id: "FILE-02", title: "Документ · предпросмотр", category: "Файлы", status: "Следующий этап", description: "Просмотр, версии и права доступа документа", stage: ScreenStage.future),
  TestScreen(id: "CRM-01", title: "Компании и контакты", category: "CRM", status: "Следующий этап", description: "Единая база деловых контактов и организаций", stage: ScreenStage.future),
  TestScreen(id: "CRM-02", title: "Карточка компании", category: "CRM", status: "Следующий этап", description: "Контакты, сделки и коммуникации компании", stage: ScreenStage.future),
  TestScreen(id: "AI-01", title: "Синди · AI-ассистент", category: "Синди", status: "Следующий этап", description: "Корпоративный помощник в контексте разрешённых данных", stage: ScreenStage.future),
  TestScreen(id: "AI-02", title: "Контекст и подтверждение действия", category: "Синди", status: "Следующий этап", description: "Проверьте данные перед действием Синди", stage: ScreenStage.future),
  TestScreen(id: "STORY-01", title: "Создать историю", category: "Истории", status: "Следующий этап", description: "Публикация истории на 24 часа", stage: ScreenStage.future),
  TestScreen(id: "STORY-02", title: "Просмотр истории", category: "Истории", status: "Следующий этап", description: "Истории контактов и пользователей, с которыми есть взаимодействие", stage: ScreenStage.future),
  TestScreen(id: "STORY-03", title: "Закрытая аудитория", category: "Истории", status: "Следующий этап", description: "Выберите, кому будет видна история", stage: ScreenStage.future),
  TestScreen(id: "GEO-01", title: "Поделиться геопозицией", category: "Геолокация", status: "Следующий этап", description: "Отправьте текущую точку в чат или группе", stage: ScreenStage.future),
  TestScreen(id: "GEO-02", title: "Трансляция геолокации", category: "Геолокация", status: "Следующий этап", description: "Показывайте перемещение выбранным людям ограниченное время", stage: ScreenStage.future),
  TestScreen(id: "MAP-01", title: "Карта организаций", category: "Интеграция Propo", status: "Следующий этап", description: "Организации Propo на карте — долгосрочная интеграция", stage: ScreenStage.future),
  TestScreen(id: "MAP-02", title: "Карточка организации на карте", category: "Интеграция Propo", status: "Следующий этап", description: "Профиль компании и быстрый переход к общению", stage: ScreenStage.future),
];

const int beta071CoreScreenCount = 51;
const int deferredScreenCount = 1;
const int futureConceptScreenCount = 21;
