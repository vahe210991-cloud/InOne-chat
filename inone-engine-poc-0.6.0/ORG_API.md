# API организаций (контракт для клиента, шаг 5.9)

Версия: 0.6.0-alpha.38. Все маршруты требуют входа (заголовок `authorization: Bearer <токен>`). Ошибки содержат поле `error` (текст для разработчика) и, где указано, поле `code` (для показа пользователю).

## Роли

| Роль | Что может |
|---|---|
| Участник | видит состав, настройки организации и свои заявки |
| Администратор организации | добавляет и удаляет обычных участников, меняет настройки, предлагает и отзывает связи, читает журнал |
| Владелец организации | всё, что администратор, плюс меняет роли и добавляет владельцев |
| Владелец платформы | принимает решения по заявкам на создание организации |
| Администрация платформы | видит заявки и документы только для просмотра |

## Маршруты

| Метод и путь | Кто | Успех | Ошибки (code) |
|---|---|---|---|
| POST /org-requests | любой вошедший | 200 `{requestId, status}` | 400 (название 2–120 символов) |
| GET /org-requests | заявитель — свои; платформа — все | 200 `{requests}` | — |
| GET /org-requests/:id | заявитель; платформа (просмотр) | 200 `{request, documents}` | 404 |
| POST /org-requests/:id/documents | заявитель, пока заявка ожидает | 200 `{docId, kind, size}` | 400, 404, 409, 413 (до 5 МБ), 503 (секрет документов не задан) |
| GET /org-requests/:id/documents/:docId | заявитель; платформа (просмотр, пишется в журнал) | 200 файл | 404 |
| POST /org-requests/:id/decision | владелец платформы | 200 `{status, orgId?}` | 400, 403 `not_platform_owner`, 404, 409 |
| GET /orgs/mine | любой вошедший | 200 `{orgs: [{orgId, name, status, role}]}` (только свои членства) | 401 |
| GET /orgs/:id/members | участник | 200 `{members}` | 404 |
| POST /orgs/:id/members | владелец; администратор (только обычных) | 200 `{userId, role}` | 400, 403 `org_not_approved` / `org_role_required`, 404, 409 |
| POST /orgs/:id/members/:uid/role | владелец | 200 `{userId, role}` | 400, 403 `org_role_required`, 404, 409 `last_owner` |
| DELETE /orgs/:id/members/:uid | владелец; администратор (только обычных) | 200 `{removed}` | 400 (для себя — /leave), 403 `org_role_required`, 404, 409 `last_owner` / `owns_rooms` |
| POST /orgs/:id/leave | участник | 200 `{left}` | 404, 409 `last_owner` / `owns_rooms` |
| GET /orgs/:id/settings | участник | 200 `{settings}` | 404 |
| POST /orgs/:id/settings | владелец; администратор | 200 `{settings}` | 400, 403 `org_not_approved` / `org_role_required`, 404 |
| GET /orgs/:id/settings/log | владелец; администратор | 200 `{log}` | 403 `org_role_required` |
| GET /orgs/:id/admin-log | владелец; администратор | 200 `{actions}` | 403 `org_role_required` |
| GET /orgs/:id/links | владелец; администратор | 200 `{links}` | 403 `org_role_required` |
| POST /orgs/:id/links | владелец; администратор | 200 `{linkId, status: "proposed"}` | 400, 403 `org_role_required` / `org_not_approved`, 409 `link_exists` |
| POST /orgs/:id/links/:lid/accept | владелец или администратор стороны, которая не предлагала | 200 `{status: "active"}` | 403 `link_own_side` / `org_role_required`, 404, 409 |
| POST /orgs/:id/links/:lid/revoke | владелец или администратор любой стороны | 200 `{status: "revoked"}` | 403 `org_role_required`, 404, 409 |

## Ошибки, которые возвращают комнаты и файлы

| Ситуация | Статус | code |
|---|---|---|
| Пользователь не участник организации комнаты и нет активной связи | 403 | `org_not_member` |
| Организация комнаты не одобрена | 403 | `org_not_approved` |
| Организация комнаты не найдена | 404 | `org_not_found` |
| Канал в организации, где каналы отключены | 403 | `org_channels_disabled` |
| Файл сверх квоты организации | 413 | `org_quota_exceeded` |
| Группа достигла лимита (организации или общего) | 409 | — (текст `group is full`, в коммитах MLS также поле `limit`) |

## Каталог кодов

| code | HTTP | Что показать пользователю (ключ сообщения) |
|---|---|---|
| org_not_found | 404 | `org.error.not_found`: организация не найдена |
| org_not_approved | 403 | `org.error.not_approved`: организация ещё не одобрена |
| org_not_member | 403 | `org.error.not_member`: вы не участник этой организации |
| org_role_required | 403 | `org.error.role_required`: это может делать владелец или администратор |
| last_owner | 409 | `org.error.last_owner`: нельзя понизить или удалить последнего владельца |
| owns_rooms | 409 | `org.error.owns_rooms`: сначала передайте комнаты, которыми вы владеете |
| link_exists | 409 | `org.error.link_exists`: связь с этой организацией уже есть |
| link_own_side | 403 | `org.error.link_own_side`: связь принимает другая сторона |
| not_platform_owner | 403 | `org.error.not_platform_owner`: решение принимает владелец платформы |
| org_channels_disabled | 403 | `org.error.channels_disabled`: в организации отключены каналы |
| org_quota_exceeded | 413 | `org.error.quota_exceeded`: превышена квота хранения организации |
