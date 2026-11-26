# InOne Beta 1.0 — технический аудит публикаций, новостной ленты и личного профиля

**Дата аудита:** 2026-11-26 (UTC+4)  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Проверенная ветка:** `main`  
**Кодовый срез аудита:** `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`  
**Текущий HEAD main при актуализации:** `920e2a2ecef244c925061348eb68c8b09fe63922`  
**Рабочая ветка документа:** `audit/feed-profile-beta1-main-216c6d9-20261126`  
**Статус:** SOURCE REVIEW COMPLETE / RELEASE ACCEPTANCE NOT READY  
**Режим:** read-only source/document/PR review; runtime tests NOT RUN  
**Изменения прикладного кода:** отсутствуют

---

## 1. Назначение и область аудита

Проверены две взаимосвязанные области:

1. Публикации и лента новостей: создание/редактирование/удаление публикаций, собственная и общая лента, авторы, реакции, комментарии, медиа, подписки, сортировка, пагинация, видимость, модерация.
2. Личный профиль: чтение собственного профиля, публичное представление другого пользователя, редактирование полей, аватар/обложка, приватность, связь с аккаунтом и файловым хранилищем.

Цель — установить фактическое состояние `main`, а не выводить готовность из наличия макетов, моделей или универсального файлового API. В качестве доказательства использованы дерево репозитория, backend/Dart source, SQL schema/migrations, тесты, продуктовые решения, WBS и открытые PR.

Аудит не включает эксплуатационные проверки на production, чтение реальных пользовательских данных, запуск серверов, сборок и тестов. Никакие исходники, миграции, конфигурации и UI-файлы не изменялись.

## 2. Точный SHA исследованной main

На момент получения GitHub refs:

- `main`: `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`
- Commit: `docs(development): add Beta 1.0 auth and recovery implementation plan`
- Commit date: `2026-11-26T17:32:00Z`
- Parent: `baec9c083ed51ab5004e5f1b1e99aca6b4f2476a`
- Tree: `3fcccbe22775d3dd5d832ffb1a430e7985c1868b`

Последний commit добавляет документ по авторизации и восстановлению. Он не меняет backend, Flutter, БД или медиа-путь исследуемых подсистем.

### 2.1. Проверенные недавние изменения main

Последний предшествующий merge в main — Stage 4 database integrity/cleanup hardening (`baec9c083ed51ab5004e5f1b1e99aca6b4f2476a`). Более ранние изменения включают атомарность административных операций, индексы очистки и generation-aware push delivery. Эти изменения не добавляют домен публикаций или публичный профиль.

### 2.2. Повторная проверка актуальности main

После первоначального source review `main` продвинулся с `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250` до `920e2a2ecef244c925061348eb68c8b09fe63922`.

`compare_commits` подтверждает ровно два новых коммита и только два изменённых документа:
- `development/UNIFIED-TASK-COMPLETION-RULES.md` — добавлен;
- `development/WORKING-RULES.md` — дополнен.

Ни backend, ни Flutter, ни SQL schema/migrations, ни API contracts, ни media implementation не изменялись. Поэтому кодовые выводы этого аудита остаются применимыми к текущему `main` `920e2a2`. Сам документ актуализирован после повторного чтения действующих правил разработки.

### 2.3. Связанные PR

| PR | Состояние на момент аудита | Влияние на публикации/профиль |
|---|---|---|
| #166 — Chats and groups implementation plan | Draft/open; base SHA совпадает с исследованной main | Документационный аудит чатов/групп; не добавляет feed/profile |
| #158 — Dart archive integration plan | Draft/open; основан на более раннем main SHA | Только документация и отчёты; не меняет код профиля |
| #161 — Organization picker | Draft/open; основан на более раннем main SHA | Организации, не feed/profile |
| #159 — Stage 5 supply-chain hardening | Draft/open; отдельный head/старый base | Не является частью исследованной main |
| #90 — G2 MLS messaging/attachments | Draft/open; отдельный head | Чатовые вложения и MLS, не публикационная медиа-система |

В просмотренном наборе открытых PR не найден PR, который уже подключает публикационную ленту, создание постов, публичный профиль, профильное редактирование или аватар/обложку к production Flutter app. PR #166 основан на точном SHA текущей main и не меняет эту оценку. PR #158 содержит только документационные изменения и не является доказательством реализации других профилей.

### 2.4. Решение владельца о приватности — вариант В (2026-11-26)

Владелец утвердил вариант В: **существующая модель приватности InOne сохраняется без изменений**. В рамках этого аудита запрещено вводить новые правила открытости профилей/публикаций, новые настройки public/private, новые блокировки или менять доступ к уже существующим данным.

Проверяются и сохраняются только подтверждённые действующие границы:
- собственный `GET /profile` доступен по текущей аутентифицированной сессии и использует `userId` из неё;
- `GET /users/search` ограничен rate limit и проверкой `sharesOrgOrLink`, возвращает только `userId`, `nickname`, `verificationLevel`, не email и не телефон;
- owner-only file download остаётся доступен только владельцу с действующей user/device session; room files остаются ограничены членством в комнате;
- отсутствие public-profile API, social visibility settings, блокировок и feed policy не трактуется как разрешение сделать данные публичными.

Если будущая функция требует правила, которого нет в текущих решениях или реализации, её реализация блокируется до отдельного решения владельца. Не подменять отсутствие политики самостоятельно придуманным правилом.

## 3. Краткое заключение о готовности

**Публикации и новостная лента: NOT IMPLEMENTED / NOT CONNECTED.**

В текущем backend source не обнаружены сущности публикаций, маршруты ленты/постов, таблицы публикаций/комментариев/реакций, Flutter-экраны ленты/публикации или typed repository operations. В нижней навигации Feed недоступна и сообщает, что раздел не входит в подключённый объём Beta 1.0.

**Личный профиль: PARTIAL, READ-ONLY.**

Подтверждены authenticated `GET /profile`, DTO `InOneProfile`, typed repository и нативный Flutter экран собственного профиля. Также есть `PATCH /profile/locale`. Не обнаружены полноценное редактирование nickname/bio/прочих полей, API публичного профиля другого пользователя, профильные privacy settings, привязка avatar/cover к профилю и мобильная загрузка аватара.

**Медиа: GENERIC FILE INFRASTRUCTURE EXISTS, SOCIAL/PROFILE MEDIA FLOW MISSING.**

Универсальный API `/files` поддерживает `kind: avatar`, подписанные upload/download URLs, owner/device binding, ограничения размера и checksum. Но файл не связывается с полем профиля, не становится публичным изображением, не включён в карточку публикации и не имеет проверенного жизненного цикла замены/удаления как avatar/cover/post media.

**Security:** подтверждённой утечки приватных данных или BOLA/IDOR в просмотренных текущих маршрутах профиля и файлов не установлено. Это вывод статического анализа, не результат динамического penetration test.

## 4. Архитектурная карта ленты публикаций

### 4.1. Проверенная production-цепочка

Ожидаемый путь для существующей реализации должен был бы быть:

`Flutter screen → typed repository → authenticated API → domain/service → PostgreSQL → response DTO → Flutter state`.

В проверенном дереве такой цепочки для публикаций нет:

- В `mobile/lib/` не обнаружены production Dart-файлы feed/post/news/publication.
- В `mobile/lib/core/data/inone_repositories.dart` нет операций создания, чтения, редактирования или удаления публикаций.
- В `inone-development-archive-0.6.0/engine/src/server.js` не обнаружены маршруты `/feed`, `/posts`, `/publications`, `/comments`, `/reactions`.
- В `inone-development-archive-0.6.0/engine/src/schema.sql` нет таблиц posts/publications, post_media, comments, reactions, follows/subscriptions или feed cursor/state.
- В backend test tree нет отдельных тестов feed/posts/comments/reactions.
- В screen-to-contract matrix `mobile/API-CONTRACTS-BETA-1.md` публикационные операции не объявлены.

Это отсутствие реализации, а не доказанный дефект конкретного существующего handler. Нельзя заявлять о работающей публикационной функции.

### 4.2. Жизненный цикл публикации

Не подтверждены следующие стадии:

1. Создание и серверная валидация публикации.
2. Проверка авторства и прав на изменение/удаление.
3. Сохранение текста и связей с медиа.
4. Публикация в общей или персональной ленте.
5. Пагинация и стабильный cursor.
6. Редактирование/soft delete/hard delete.
7. Очистка или сохранение комментариев, реакций и вложений после удаления.
8. Модерация, жалобы, скрытие и блокировка автора.
9. Идемпотентность создания и защита от повторных запросов.
10. Обновление ленты между устройствами.

Поэтому алгоритм сортировки/ранжирования, правила подписок, дедупликация, кэширование и поведение пагинации не могут быть описаны как существующие. Они не обнаружены в текущем production path.

### 4.3. Комментарии и реакции

В текущей SQL-модели и backend route inventory не обнаружены отдельные сущности и API для комментариев и реакций. Проверки владельца комментария, повторных реакций, гонок счётчиков, доступа к комментариям удалённой публикации и anti-spam для публикационной активности отсутствуют вместе с самой подсистемой.

Это функциональный пробел, но не подтверждённая эксплуатационная уязвимость существующего API.

## 5. Архитектурная карта личного профиля

### 5.1. Backend и данные

Основной проверенный backend source — `inone-development-archive-0.6.0/engine/src/server.js`; package metadata в `inone-development-archive-0.6.0/engine/package.json` описывает его как canonical Beta 1.0 Node/PostgreSQL backend.

Основные маршруты:

- `GET /profile` — `server.js:1181–1193`. Требует authenticated device/session. User ID берётся из результата `authed(req)`, а не из клиентского параметра. Ответ формируется через `accountLevelInfo(d.userId)`, затем добавляются locale, platformRole и securityHints.
- `PATCH /profile/locale` — `server.js:1195–1202`. Изменяет только locale, разрешены `hy`, `ru`, `en`.
- `GET /users/search?nickname=...` — `server.js:1165–1179`. Требует auth, rate limit, валидирует nickname и проверяет `sharesOrgOrLink`. Возвращает только `userId`, `nickname`, `verificationLevel`; email и phone не возвращаются.
- Не обнаружены `GET /users/:id/profile`, `PATCH /profile`, `PUT /profile`, `PATCH /profile/avatar`, `PATCH /profile/cover` или эквивалентные операции.

В `schema.sql` таблица `profiles` начинается около строки 221. В текущей модели присутствуют nickname, email, email verification и locale; поля bio/about, avatar file ID, cover file ID и visibility policy в профильной таблице не обнаружены. В таблице `files` (около строки 384) хранятся file_id, owner_id, room_id, kind, size, sha256, status и timestamps. Связи profile → avatar/cover и post → media нет.

### 5.2. DTO и Flutter

- `mobile/lib/core/data/inone_profile.dart` — модель `InOneProfile`; поля: userId, nickname, email, verificationLevel, providers, backupEmail, securityHints, locale, platformRole. Это DTO собственного account summary, а не публичная социальная карточка.
- `mobile/lib/core/data/inone_repositories.dart` — `profile()` вызывает authenticated `GET /profile`; `updateLocale()` меняет только locale через session.
- `mobile/lib/app/inone_mobile_app.dart:550–570` — при загрузке authenticated data загружаются собственный профиль и организации.
- `mobile/lib/app/inone_mobile_app.dart:901–913` — UI model собирает name/handle из nickname/email; myTasks/activity/projects намеренно отображаются как `—`.
- `mobile/lib/ui_dart_source/screens/main/inone_profile_screen.dart` — нативный экран собственного профиля. Он принимает модель и callbacks, но не реализует самостоятельный API.
- `mobile/lib/app/inone_mobile_app.dart:3128–3176` — экран подключён; `onEditAvatar: null`, `onAdd: null`.
- `mobile/lib/app/inone_mobile_app.dart:2918–2929` — Feed и Calls не подключены и показывают сообщение о недоступности раздела в текущем Beta 1.0 scope.

Экран существует, но полноценное редактирование, просмотр чужого профиля и управление изображениями не реализованы в сквозном пути.

### 5.3. Публичный профиль

Поиск пользователя — не просмотр профиля. `GET /users/search` возвращает ограниченный набор полей и доступен только при общей организации или связи. Полноценный публичный DTO, правила полевой видимости, приватный/публичный профиль и API чтения чужой профиль не обнаружены.

Нельзя расширять текущий `GET /profile` передачей произвольного userId: это нарушило бы текущую границу «только собственный account summary» и создало бы риск BOLA.

## 6. Медиафайлы и вложения

### 6.1. Что реализовано

В `server.js:493–503` заданы лимиты: avatar — 5 MiB, image — 20 MiB, video — 100 MiB, file — 250 MiB. Upload URL действует 15 минут, download URL — 5 минут. Подписи HMAC привязаны к операции, file ID, сроку, размеру/checksum и owner/device; download signature — к file ID, user ID и device ID.

Маршрут `POST /files` (`server.js:1338–1381`):
- требует authenticated session и включённый feature flag;
- проверяет известный kind, размер и SHA-256;
- для файлов комнаты проверяет членство и capability;
- без roomId разрешает только `kind === 'avatar'`;
- генерирует случайный file ID;
- резервирует загрузку с owner/device binding и квотами.

`POST /files/:id/complete` проверяет владельца, устройство, готовность загрузки и актуальную авторизацию. `GET /files/:id/url` выдаёт ссылку только владельцу для owner-only файла или участнику комнаты для room file. `GET /objects/:id` требует активную авторизацию, действующую подпись и повторно проверяет owner/room membership/status. Download возвращается как `application/octet-stream`, `attachment`, `nosniff`, `no-store`.

В `migrations/0016-files.sql` есть таблица metadata; `0031-file-upload-device-binding.sql` добавляет owner_device_id. `files.test.js` покрывает подписи, checksum, размер, истечение, device binding, membership, quota и attachment-ready state. `files-disk.test.js` проверяет безопасные случайные имена, отказ path traversal, потоковую атомарную запись и удаление временных файлов после прерванной загрузки.

### 6.2. Ограничения для профиля и публикаций

- `kind: avatar` — только резервирование owner-only файла. Отдельной операции привязки fileId к профилю нет.
- Публичная выдача avatar/cover отсутствует: owner-only download не позволяет другому пользователю получить профильное изображение.
- `kind: image/video` требует roomId и проверяет членство/право отправки в комнату. Это не media API для публичных постов.
- В общем `/files` flow проверяются размер и заявленный SHA-256, но не MIME и magic bytes реального изображения для avatar. Это не доказанная уязвимость текущего UI, поскольку аватар не подключён и отдаётся как attachment/octet-stream; это обязательное требование к будущему image pipeline.
- В текущем API не обнаружен профильный маршрут замены/удаления аватара и связанного объекта. Политика orphan cleanup для готовых avatar/post files не подтверждена.
- Нельзя называть avatar/post media зашифрованными. Для MLS chat attachments есть отдельный криптографический путь, но он не доказывает шифрование profile image или будущих public posts.
- `config.js` требует `INONE_FILES_DIR` в production и выдаёт ошибку, если он отсутствует, поскольку in-memory files теряются при рестарте. `server.js` в тестовом/неproduction режиме может использовать memory object store. Фактическую production-конфигурацию в рамках аудита не проверяли.

## 7. Модель доступа и приватности

### 7.1. Подтверждённые текущие границы

1. `GET /profile` привязан к userId authenticated device record, а не к переданному клиентом userId.
2. `GET /users/search` возвращает минимальные поля и проверяет существование допустимой связи через `sharesOrgOrLink`; email/phone в ответе отсутствуют.
3. `GET /files/:id/url` требует auth и owner/room membership; download URL привязан к активной user/device session и проверяется повторно в `/objects/:id`.
4. Upload reservation и completion привязаны к владельцу и устройству.
5. В мобильном профиле email используется как handle только на собственном профиле. Публичный профиль, который мог бы случайно раскрыть email, не обнаружен.

### 7.2. Границы, которые не реализованы и не должны додумываться

- Public-profile API/DTO и social visibility settings отсутствуют. Вариант В не разрешает делать профиль публичным по умолчанию и не утверждает новую приватную/публичную модель.
- Блокировки, скрытие пользователей, подписки и social graph не обнаружены; не добавлять их как предположение.
- Публикации и их feed endpoints отсутствуют; post visibility policy не реализована в коде. На уровне продукта владелец отдельно утвердил: опубликованные элементы общей новостной ленты доступны всем зарегистрированным и авторизованным аккаунтам, анонимный доступ запрещён. Это решение ещё необходимо реализовать и протестировать на сервере.
- Правила сохранения/анонимизации публикаций после удаления аккаунта, публичные media links и social moderation не определены существующим production-контрактом.

Отсутствие реализации не отменяет утверждённую политику. До server-side enforcement и regression acceptance нельзя возвращать чужие публикации или их вложения; отсутствие других политик не является разрешением менять доступ к профилям, черновикам или личным данным.

## 8. Результаты security-аудита

### 8.1. Подтверждённые уязвимости

**Подтверждённых P0/P1 security vulnerabilities в текущих маршрутах профиля и файлов по статическому обзору не установлено.** Динамические BOLA/IDOR, race и replay проверки не запускались.

### 8.2. Проверенные классы

| Класс | Наблюдение | Статус |
|---|---|---|
| IDOR/BOLA profile | `GET /profile` использует authenticated user; endpoint чтения чужого профиля отсутствует | No confirmed issue; dynamic test NOT RUN |
| User search privacy | Rate limit + relationship gate; response не содержит email/phone | Source-supported control |
| File IDOR | Owner/room checks и signed URLs bound to device | Source-supported control; dynamic tests NOT RUN |
| Upload replay | Expiry, HMAC, device binding, pending/ready states | Source-supported control; dynamic tests NOT RUN |
| Path traversal | Random hex object IDs; disk test rejects traversal | Existing test source found; NOT RUN in this audit |
| MIME/content spoofing | Для avatar общий upload path не проверяет image magic bytes/MIME | Future media risk; not current exploitable path |
| Private post exposure | Публикационных endpoints нет | Not applicable yet |
| Comment/reaction ownership | Социальных endpoints и таблиц нет | Not implemented |
| Rate limiting | User search rate limited; social routes do not exist | Social abuse controls not implemented |
| Logging | Request logs normalize route roots; no post payload path exists | No feed-specific logging path to assess |

### 8.3. Security requirements before social release

- Server-side authorization on every read/write endpoint must enforce the existing approved access policy; never rely on Flutter visibility. Do not invent public/private, block or follow semantics that are absent from the approved model.
- Object-level checks for post, comment, reaction and media IDs.
- Immutable server-side authorId/createdAt; client must not choose author or publication timestamp.
- Idempotency key and database uniqueness for create/reaction operations.
- Transactional consistency for post state and counters.
- Cursor pagination with authorization filters applied before returning rows.
- Rate limits and abuse controls for create/comment/react/search.
- Strict media format validation, bounded dimensions/duration, safe processing, opaque object IDs and authenticated/signed delivery.
- Atomic cleanup or retention workflow for media and related records.
- Privacy DTO allowlist; no email, phone, backup email, provider links, device data, platform roles or internal security hints in public profile DTO.

## 9. Карта API и БД

### 9.1. Наблюдаемые profile/file endpoints

| Метод | Endpoint | Назначение | Текущее доказательство |
|---|---|---|---|
| GET | `/profile` | Собственный account summary | `server.js:1181–1193` |
| PATCH | `/profile/locale` | Только язык аккаунта | `server.js:1195–1202` |
| GET | `/users/search?nickname=...` | Ограниченный поиск пользователя | `server.js:1165–1179` |
| POST | `/files` | Резервирование загрузки | `server.js:1338–1381` |
| POST | `/files/:id/complete` | Подтверждение загрузки | `server.js:1383–1407` |
| GET | `/files/:id/url` | Получение signed download URL | `server.js:1409–1423` |
| GET/PUT | `/objects/:id` | Защищённый upload/download объекта | `server.js:529–647` |

### 9.2. Таблицы

В актуальном `schema.sql` присутствуют `profiles` и `files`, но не обнаружены:
- `posts` / `publications`;
- `post_media`;
- `comments`;
- `reactions`;
- `follows` / `subscriptions`;
- `feed_cursors` / feed materialization tables;
- profile visibility/blocked-user/social privacy tables.

Не предлагается создавать эти таблицы до утверждения продуктового scope и контракта. Сначала требуется domain/API design, связанный с текущей схемой аккаунтов и объектного хранилища.

## 10. Flutter/Dart: экраны и интеграции

| Экран/компонент | Файл | Фактический статус |
|---|---|---|
| Собственный профиль | `mobile/lib/ui_dart_source/screens/main/inone_profile_screen.dart` | Native UI; получает model/callbacks |
| Profile DTO | `mobile/lib/core/data/inone_profile.dart` | Account summary parser |
| Typed repository | `mobile/lib/core/data/inone_repositories.dart` | GET profile + locale update; no social methods |
| App host | `mobile/lib/app/inone_mobile_app.dart` | Loads profile, maps fields, routes profile |
| Feed tab | `mobile/lib/app/inone_mobile_app.dart:2918–2929` | Not connected; explicit unavailable notice |
| Avatar edit | `mobile/lib/app/inone_mobile_app.dart:3173–3176` | `onEditAvatar: null` |
| Profile statistics | `mobile/lib/app/inone_mobile_app.dart:901–913` | Tasks/activity/projects are placeholders `—` |
| Other user's profile | No production Dart screen in active tree | Not implemented/connected |
| Feed/post/comments screens | No production Dart files in active tree | Not implemented/connected |

`mobile/README.md` identifies `mobile/lib/main.dart` as the production entry point and says HTML screens are retained only in the archive, not bundled/loaded. The production API contract test also asserts no WebView runtime dependency. No old HTML screen should be restored; the target remains native Flutter/Dart.

### 10.1. Source-of-truth note

The repository contains both `inone-development-archive-0.6.0/engine` and `inone-engine-poc-0.6.0`. The archive package describes itself as the canonical Beta 1.0 backend; current backend acceptance documentation identifies it as the production source. However, `mobile/README.md` still contains a local-start instruction pointing at `inone-engine-poc-0.6.0`. The POC copy has an older `GET /profile` route but does not show the current locale addition in the same handler. This documentation/source-selection drift must be reconciled before local end-to-end testing; this audit uses the canonical archive backend and does not treat the POC as a second production implementation.

## 11. Тестовое покрытие и пробелы

### 11.1. Найденные тесты

- `mobile/test/core/data/inone_profile_test.dart` — parsing/validation tests for account summary DTO, nullable fields, locale, platformRole and invalid response shapes.
- `inone-development-archive-0.6.0/engine/test/files.test.js` — integration tests for upload/download authorization, device binding, expiry, size, checksum, quota and room membership.
- `inone-development-archive-0.6.0/engine/test/files-disk.test.js` — disk object naming, path traversal rejection, durable stream writes and temporary-file cleanup.
- `inone-development-archive-0.6.0/engine/test/api-contract.test.js` — source-contract checks for known API operations and Flutter entrypoint/transport boundaries.

Наличие этих файлов не означает, что тесты были запущены в этой сессии или прошли на проверенном SHA.

### 11.2. Матрица обязательных тестов

| Область | Сценарий | Ожидаемый результат | Текущее покрытие |
|---|---|---|---|
| Posts | Создание своей публикации | Сохранена один раз, автор назначен сервером | NOT IMPLEMENTED |
| Posts | Редактирование чужой публикации | 403/404; данные не изменены | NOT IMPLEMENTED |
| Posts | Удаление чужой публикации | Отказ; связи не затронуты | NOT IMPLEMENTED |
| Feed | Cursor pagination при вставке новых записей | Нет пропусков/дубликатов при фиксированном cursor | NOT IMPLEMENTED |
| Feed | Удалённые записи и записи, недоступные по утверждённой модели доступа | Недоступные записи не выдаются | NOT IMPLEMENTED |
| Feed | Повторный запрос страницы | Детерминированная выдача | NOT IMPLEMENTED |
| Comments | Изменение/удаление чужого комментария | Отказ в доступе | NOT IMPLEMENTED |
| Reactions | Повторная реакция и конкурентные запросы | Уникальная реакция и согласованный счётчик | NOT IMPLEMENTED |
| Media | Чтение чужого приватного файла | 403/404 | Generic file tests exist; avatar/public policy NOT TESTED |
| Media | Подмена MIME/формата avatar | Файл отвергнут до публикации | NOT IMPLEMENTED |
| Media | Замена/удаление avatar | Новая ссылка актуальна; старый объект удалён/retained per policy | NOT IMPLEMENTED |
| Profile | Изменение чужого профиля | Отказ в доступе | NOT IMPLEMENTED |
| Profile | Публичный просмотр другого профиля | Только allowlisted public fields | NOT IMPLEMENTED |
| Privacy | Попытка получить email/phone/providers в public DTO | Закрытые поля отсутствуют | No public DTO |
| Account | Блокировка/удаление/восстановление | Профиль и публикации соблюдают retention/access policy | NOT IMPLEMENTED |
| Sync | Изменение профиля на другом устройстве | После refresh серверное состояние совпадает | NOT TESTED |
| Idempotency | Повтор POST публикации после timeout | Нет дублирующей публикации | NOT IMPLEMENTED |
| Race | Одновременное edit/delete | Версионный конфликт или сериализованное состояние | NOT IMPLEMENTED |
| Abuse | Массовые публикации/комментарии/поиск | Rate limits и abuse policy срабатывают | NOT IMPLEMENTED |

### 11.3. Запуск тестов и CI

- Локальные Node/PostgreSQL/Flutter/Rust tests: **NOT RUN**.
- Physical Android/iOS tests: **NOT RUN**.
- На exact SHA `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250` при просмотре GitHub check-runs не найдено запусков. Исторические результаты на других SHA не засчитываются как доказательство текущего состояния.
- Никакой тест не объявляется пройденным на основании одного лишь исходного файла.

## 12. Разделение Beta 1.0 и Beta 2.0

### 12.1. Утверждённая продуктовая граница

`docs/continuity/DECISIONS.md` §1 фиксирует первоначальный Beta 1.0 scope: Chats, Organizations, Profile, auth/recovery и серверные API. Для Feed это историческая запись, superseded решением владельца от 2026-11-26 в §9 того же документа. WBS v1.2 (`development/PROGRESS-BASELINE.md`) включает утверждённое владельцем расширение scope: Feed входит в Beta 1.0 с 2026-11-26. Веса доменов не меняются; исторические проценты v1.1 не являются новой оценкой расширенного scope.

В то же время `DECISIONS.md` §7 определяет InOne как personal/social product с News feed и User publications/posts. В entitlement hypothesis § соответствующего раздела также упомянуты доступные публикации. Владелец отдельно утвердил Feed для Beta 1.0 2026-11-26; решение и scope amendment зафиксированы в WBS v1.2 и `DECISIONS.md` §9.

### 12.2. Решение владельца и scope amendment (2026-11-26)

**APPROVED FOR BETA 1.0:** владелец подтвердил, что лента публикаций и новостей входит в Beta 1.0. SCOPE-001 закрыт как продуктовое решение; WBS обновляется до v1.2. Отсутствие Feed является безусловным P1 release blocker до реализации и приёмки минимального объёма.

- Вариант В остаётся обязательным: существующая модель приватности сохраняется без изменений.
- Решение не вводит публичность по умолчанию, новые visibility preferences, блокировки, подписки или новую социальную графику.
- Минимальный Feed Beta 1.0: create/read/edit/delete собственных публикаций; собственная лента; общая новостная лента с опубликованными элементами, доступными всем зарегистрированным и авторизованным аккаунтам InOne; анонимный доступ запрещён; стабильная cursor pagination; native Flutter/Dart UI; server-side authorization, idempotency, abuse controls and security regression tests.
- Вложения проходят только через validated media lifecycle: content validation, association to post, owner/access checks on download, cleanup. Никаких открытых object URLs.
- Comments/reactions, follows/subscriptions, stories, recommendations/ranking, public profiles, public-by-default posts/media и новые visibility controls не считаются автоматически включёнными этим решением; для них требуется отдельное решение или они остаются Beta 2.0 candidates.
- **Feed visibility decision:** владелец утвердил, что все опубликованные элементы общей новостной ленты доступны каждому зарегистрированному и авторизованному аккаунту InOne; анонимный доступ запрещён. Вложения наследуют это правило и повторно проверяются при скачивании. Это не делает публичными профили, черновики и личные данные. Код пока не реализует эту политику; межаккаунтное чтение остаётся выключенным до server-side enforcement и security tests. `sharesOrgOrLink` не используется как feed authorization.
- WBS v1.2 сохраняет существующие веса 25/25/15/20/10/5 и не пересчитывает исторический baseline 42%/31%. Эти цифры не являются текущей оценкой расширенного scope.

### 12.3. Разделение релизов

**Beta 1.0:** минимальный lifecycle собственных публикаций, собственная лента и общая лента опубликованных записей для всех зарегистрированных и авторизованных аккаунтов (анонимный доступ запрещён), cursor pagination, безопасные вложения с повторной проверкой доступа, native Flutter/Dart UI и backend/API/DB/security tests.

**Beta 2.0 candidates / separate approval required:** comments/reactions (если не утверждены отдельно), follows/subscriptions, stories, сложное ранжирование/персонализация, creator tooling, promotion/analytics, расширенные публичные профили и social graph.

Критические security/privacy исправления обязательны до релиза и не переносятся в Beta 2.0. Коммерческие ограничения и paywalls в рамках этого аудита не вводятся.

### 12.4. Детализация scope и исключения

**Beta 1.0 approved scope**
- Собственные публикации: create/read/edit/delete.
- Собственная лента и общая лента опубликованных элементов для всех зарегистрированных и авторизованных аккаунтов InOne; анонимный доступ запрещён.
- Stable cursor pagination, refresh, deduplication and deletion consistency.
- Native Flutter/Dart Feed screens and typed API/repository integration.
- Server-side authorization, idempotency, abuse controls and security/regression tests.
- Secure post attachment lifecycle where attachments are in the approved screen contract.

**Beta 2.0 candidates / separate approval required**
- Comments/reactions unless separately approved.
- Follows/subscriptions, stories, advanced recommendations/ranking, creator tools, promotion and analytics.
- Public profiles, public-by-default posts/media, new visibility preferences and block semantics.

## 13. Реестр подтверждённых пробелов и рисков

Приоритет отражает важность для релиза, а не утверждение о наличии эксплуатируемой уязвимости. Для задач с пометкой conditional P1 приоритет становится блокирующим только после утверждения соответствующего scope.

### FP-001 — Публикационная подсистема отсутствует

- **Приоритет:** P1 — безусловный Beta 1.0 release blocker.
- **Подсистема:** feed/posts.
- **Фактическое поведение:** отсутствуют post/feed endpoints, domain tables, Flutter screens и typed repository operations.
- **Ожидаемое:** сквозной lifecycle собственных публикаций, собственной ленты и общей ленты с опубликованными записями, доступными всем зарегистрированным и авторизованным аккаунтам; анонимный доступ запрещён.
- **Расположение:** backend `engine/src/server.js`; schema `engine/src/schema.sql`; mobile `mobile/lib/core/data/inone_repositories.dart`; production screen tree `mobile/lib/ui_dart_source/screens/main/`.
- **Доказательство:** полный tree inventory, route review и schema table inventory на указанном SHA; `mobile/app` блокирует Feed tab.
- **Воспроизведение:** выбрать Feed в нижней навигации; app показывает notice «раздел пока не входит в подключённый объём Beta 1.0».
- **Влияние:** публикации и новости недоступны.
- **Security/privacy:** пока нет endpoint, нет доказанной уязвимости; будущие read/write endpoints должны быть object-authorized.
- **Исправление:** реализовать в Beta 1.0 согласно уже утверждённому FEED-PRIVACY-001; использовать существующий canonical backend, DB and object store, не создавать параллельный backend.
- **Тесты:** create/read/edit/delete, auth, owner, visibility, idempotency, feed pagination, multi-device.
- **Acceptance:** пользователь проходит create → own view → feed view → edit/delete; сервер гарантирует owner/visibility.
- **Зависимости:** SCOPE-001, FEED-SEC-001, FEED-CORE-001.
- **Релиз:** Beta 1.0.
- **Статус:** OPEN / NOT IMPLEMENTED.

### FP-002 — Профиль поддерживает чтение, но не полноценное редактирование

- **Приоритет:** P2 при текущей WBS; повысить до P1 только если владелец включает редактирование в Beta 1.0.
- **Подсистема:** profile lifecycle.
- **Фактическое поведение:** backend exposes GET /profile and PATCH /profile/locale only; profile DTO has no bio/avatar/cover; Flutter has no profile edit form.
- **Ожидаемое:** изменяемые поля строго по утверждённой profile contract.
- **Расположение:** `server.js:1181–1202`; `mobile/lib/core/data/inone_profile.dart`; `mobile/lib/core/data/inone_repositories.dart`; `mobile/lib/app/inone_mobile_app.dart`.
- **Доказательство:** route source and repository operation inventory.
- **Воспроизведение:** открыть профиль; доступно изменение языка, но нет операции редактирования nickname/about.
- **Влияние:** пользователь не может управлять профильными атрибутами через этот экран.
- **Security/privacy:** нельзя добавлять mass-assignment DTO; allowlist полей и owner scope обязательны.
- **Исправление:** определить editable fields and validation, затем typed PATCH contract with server-owned immutable fields.
- **Тесты:** чужой owner, protected fields, empty/oversized strings, concurrent update, invalid locale.
- **Acceptance:** только разрешённые поля меняются и синхронизируются на втором устройстве.
- **Зависимости:** SCOPE-001, PROFILE-CORE-001.
- **Релиз:** Beta 2.0 unless owner approves scope change.
- **Статус:** OPEN / NOT IMPLEMENTED.

### FP-003 — Нет API полноценного публичного профиля другого пользователя

- **Приоритет:** P2.
- **Подсистема:** public profile/privacy.
- **Фактическое поведение:** `GET /users/search` выдаёт ограниченный search result; отдельного public profile read endpoint/DTO нет.
- **Ожидаемое:** отдельный профиль другого пользователя может появиться только после отдельного owner decision; вариант В сам по себе не разрешает публичное чтение. До этого search result остаётся единственным ограниченным способом обнаружения пользователя.
- **Расположение:** `server.js:1165–1193`; `mobile/lib/core/data/inone_repositories.dart`; production mobile screen tree.
- **Доказательство:** только search route и own-profile route обнаружены.
- **Воспроизведение:** найти nickname; API возвращает краткую карточку, не полноценный профиль.
- **Влияние:** просмотр чужого профиля не поддерживается.
- **Security/privacy:** расширять search response до profile response нельзя; email/phone/backupEmail/providers/securityHints/platformRole/device metadata не должны попасть в public DTO.
- **Исправление:** не расширять текущий API. Если владелец отдельно утвердит чужой профиль, сначала зафиксировать точные разрешённые поля и совместимость с существующей моделью доступа; отдельный versioned DTO и server-side authorization обязательны.
- **Тесты:** текущий search relationship gate (допустимая связь/нет связи), минимальный DTO, отсутствие email/phone/backupEmail/providers/securityHints/platformRole/device metadata; никаких тестов новой public/private или block policy до её отдельного утверждения.
- **Acceptance:** текущий search не раскрывает account fields и не обходит relationship gate; endpoint чтения чужого профиля не создаётся без отдельного решения владельца.
- **Зависимости:** SCOPE-001 COMPLETE, FEED-PRIVACY-001, PROFILE-PRIVACY-001.
- **Релиз:** Beta 2.0 unless owner explicitly approves.
- **Статус:** OPEN / NOT IMPLEMENTED.

### FP-004 — Avatar upload primitive не связан с профилем

- **Приоритет:** P2.
- **Подсистема:** profile media.
- **Фактическое поведение:** `POST /files` принимает kind avatar и создаёт owner/device-bound file reservation; нет endpoint/DB relation для установки avatar_file_id и публичной выдачи.
- **Ожидаемое:** управляемая загрузка, привязка, замена, отображение и удаление/retention согласно policy.
- **Расположение:** `server.js:493–503, 1338–1423`; `schema.sql` profiles/files; `mobile/lib/app/inone_mobile_app.dart:3173–3176`.
- **Доказательство:** file upload route and `onEditAvatar: null`; no profile avatar field/endpoint.
- **Воспроизведение:** UI avatar callback отсутствует; generic upload does not set profile image.
- **Влияние:** avatar/cover не редактируются и не видны другим пользователям.
- **Security/privacy:** owner-only current file access is safer than accidental public access. Before public image delivery validate actual file format, enforce size/dimensions, use safe processing, keep owner and visibility checks.
- **Исправление:** profile-media binding contract and cleanup lifecycle after scope approval.
- **Тесты:** wrong owner/device, MIME/magic bytes, replacement race, revoked device, denial for another account, old object cleanup. Публичная выдача не включается без отдельного решения.
- **Acceptance:** avatar visible only to permitted viewers; old link revoked or policy-retained; no orphan leaks.
- **Зависимости:** FEED-MEDIA-001 if posts share media; PROFILE-MEDIA-001.
- **Релиз:** Beta 2.0 unless owner approves profile edit in Beta 1.0.
- **Статус:** OPEN / PARTIAL INFRASTRUCTURE ONLY.

### FP-005 — Отсутствуют публикационные комментарии и реакции

- **Приоритет:** P2 conditional on product requirements.
- **Подсистема:** feed interaction.
- **Фактическое поведение:** no tables/routes/mobile operations found.
- **Ожидаемое:** minimum owner-authorized comment/reaction lifecycle only if included in release scope.
- **Расположение:** `engine/src/schema.sql`, `engine/src/server.js`, `mobile/lib/core/data/inone_repositories.dart`.
- **Доказательство:** schema/API inventory.
- **Воспроизведение:** нет UI/API action to comment/react.
- **Влияние:** взаимодействие с публикациями отсутствует.
- **Security/privacy:** future endpoints must enforce post visibility, comment owner, uniqueness and rate limits.
- **Исправление:** separate transactional data model; never trust client counters.
- **Тесты:** foreign comment edit/delete, repeated reaction, concurrent reaction count, deleted post, access checks strictly against approved current policy; no assumed block semantics.
- **Acceptance:** counters equal persisted relation counts; unauthorized writes denied.
- **Зависимости:** FEED-CORE-001, FEED-SEC-001.
- **Релиз:** Beta 2.0 unless owner scope approval.
- **Статус:** OPEN / NOT IMPLEMENTED.

### FP-006 — Нет профильного API integration/security regression matrix

- **Приоритет:** P2.
- **Подсистема:** QA/profile.
- **Фактическое поведение:** Flutter profile test covers DTO parsing/validation; no matching backend profile ownership/privacy integration suite was found.
- **Ожидаемое:** tests for authenticated own profile, locale update, unauthorized access, field allowlist, account lifecycle and cross-device refresh.
- **Расположение:** `mobile/test/core/data/inone_profile_test.dart`; backend `engine/test/`.
- **Доказательство:** test tree inventory; no profile-specific backend test file.
- **Воспроизведение:** inspect test list; DTO tests do not exercise backend HTTP authorization.
- **Влияние:** future profile changes risk regression.
- **Security/privacy:** static code is not dynamic BOLA proof.
- **Исправление:** add backend HTTP integration and Flutter repository/widget tests.
- **Тесты:** use §11.2 profile/privacy/account rows.
- **Acceptance:** test matrix runs on exact PR SHA; negative authorization tests assert no data mutation/leak.
- **Зависимости:** PROFILE-CORE-001, PROFILE-PRIVACY-001.
- **Релиз:** Beta 1.0 for existing profile read; broader matrix follows feature scope.
- **Статус:** OPEN / NOT RUN.

### FP-007 — Профильные показатели являются placeholders

- **Приоритет:** P3.
- **Подсистема:** Flutter profile UX.
- **Фактическое поведение:** tasks/activity/projects mapped to `—` because GET /profile does not provide these values.
- **Ожидаемое:** placeholders remain clearly non-data or be removed/hidden until backed by approved APIs.
- **Расположение:** `mobile/lib/app/inone_mobile_app.dart:901–913`; `inone_profile_screen.dart`.
- **Доказательство:** explicit literal values.
- **Воспроизведение:** open own profile; three tiles show em dash.
- **Влияние:** visual-only fields may imply metrics exist when they do not.
- **Security/privacy:** none established.
- **Исправление:** product/UI decision; do not fabricate metrics or create unapproved endpoints.
- **Тесты:** widget test verifies placeholder state.
- **Acceptance:** UI labels clearly indicate unavailable values or are removed under owner-approved design.
- **Зависимости:** product/UI approval.
- **Релиз:** Beta 2.0 or remove/hide for Beta 1.0.
- **Статус:** OPEN / PLACEHOLDER.

### FP-008 — Avatar media validation is incomplete for future image use

- **Приоритет:** P2 architecture/security readiness risk; not a confirmed current exploit.
- **Подсистема:** media upload.
- **Фактическое поведение:** generic `/files` reservation checks kind, declared size and SHA-256. Avatar upload path does not validate MIME/magic bytes or image dimensions; object delivery is octet-stream attachment.
- **Ожидаемое:** image-specific validation/processing before any profile/public display.
- **Расположение:** `server.js:493–503, 1338–1423`; `files.test.js`.
- **Доказательство:** route logic and absence of avatar-specific image parser/validation in the reviewed path.
- **Воспроизведение:** static: avatar branch accepts declared kind/size/checksum; no image-format check appears before object storage.
- **Влияние:** invalid or oversized-dimension image payload could be stored as an opaque avatar object if feature is later wired without validation.
- **Security/privacy:** future image decoder/renderer risk; no current browser rendering path is connected.
- **Исправление:** MIME allowlist plus magic bytes, decode/re-encode, dimensions/pixel limits, metadata stripping and safe delivery.
- **Тесты:** spoofed MIME, extension mismatch, malformed image, decompression bomb, huge dimensions, metadata privacy.
- **Acceptance:** only validated normalized image variants are publishable; original upload is not publicly served.
- **Зависимости:** PROFILE-MEDIA-001 / FEED-MEDIA-001.
- **Релиз:** before any avatar/post media feature release.
- **Статус:** OPEN / FUTURE MEDIA GATE.

### Сводка приоритетов

| Приоритет | Количество | Интерпретация |
|---|---:|---|
| P0 | 0 | Не обнаружено подтверждённой критической уязвимости/потери данных в просмотренных путях |
| P1 | 1 | FP-001: отсутствующая публикационная подсистема, блокер только если включена в Beta 1.0 |
| P2 | 6 | FP-002…FP-006 и FP-008; часть зависит от scope |
| P3 | 1 | FP-007 placeholder UI |

Эта сводка считает зарегистрированные функциональные пробелы и риски, а не число доказанных security exploits. Подтверждённых P0/P1 security vulnerabilities в статическом обзоре нет.

## 14. Архитектурные риски

1. **Scope drift:** social product direction включает feed/posts, но approved Beta 1.0 WBS не выделяет feed workstream.
2. **Media semantic mismatch:** общий file service поддерживает room attachments и owner-only avatar reservation, но это не готовая public media platform.
3. **Public profile boundary:** search result и own account profile нельзя объединять в один DTO.
4. **No social authorization graph:** блокировки, подписки, скрытие и social visibility controls не представлены в текущем profile/feed path. По варианту В их нельзя изобретать в рамках этого аудита; при необходимости будущая функция требует отдельного продуктового решения.
5. **No feed consistency model:** нет cursor, stable ordering key, deduplication или invalidation semantics.
6. **No post deletion/retention model:** нет политики для media/comments/reactions после удаления публикации/аккаунта.
7. **Backend runbook drift:** `mobile/README.md` указывает локально запускать POC backend, в то время как canonical Beta 1.0 source/acceptance docs указывают на archive engine. Перед runtime tests нужно однозначно закрепить актуальный backend tree; в этом аудите использован canonical archive.
8. **Test evidence boundary:** найденные тесты не запускались на exact audited SHA; статический обзор не подтверждает runtime readiness.

## 15. Отсутствующая функциональность

- Feed/post domain, endpoints, DB schema and Flutter screens.
- Own publications list and public/global news feed.
- Public profile DTO and other-user profile screen.
- Profile edit API and UI beyond locale.
- Social profile visibility/preferences and block/follow controls (не входят в текущий scope; вариант В сохраняет действующую модель без изменений).
- Avatar/cover binding, display, replacement and deletion lifecycle.
- Post media binding and visibility-aware downloads.
- Comments, reactions, counters and anti-abuse controls.
- Feed cursor pagination, deterministic ordering and refresh.
- Moderation/report/block/hide flows.
- Cross-device profile/post sync acceptance.

## 16. Обязательные задачи и порядок реализации

Все implementation tasks ниже имеют статус **NOT STARTED**, если не указано иное. Закрытых implementation tasks нет; зачёркивание не применяется. Feed включён в Beta 1.0 по решению владельца; security/privacy gates должны предшествовать feed endpoints.

### SCOPE-001 — Утвердить релизную границу Feed/Profile

- **Приоритет:** P1.
- **Описание:** владелец подтвердил включение Feed в Beta 1.0 2026-11-26.
- **Файлы:** `docs/continuity/DECISIONS.md`, `development/PROGRESS-BASELINE.md`.
- **Ожидаемое изменение:** versioned scope decision WBS v1.2.
- **Зависимости:** none.
- **Тесты:** document consistency review.
- **Acceptance:** release scope однозначно фиксирует Feed в Beta 1.0.
- **Релиз:** governance gate.
- **Статус:** COMPLETE — owner decision recorded; implementation is tracked by FEED tasks.

### PROFILE-CORE-001 — Зафиксировать и проверить own-profile contract

- **Приоритет:** P1.
- **Описание:** закрепить response allowlist, auth boundary и текущую семантику `GET /profile`; не расширять DTO произвольными account fields.
- **Файлы:** `engine/src/server.js`, `engine/src/store.js`, `mobile/lib/core/data/inone_profile.dart`, `mobile/lib/core/data/inone_repositories.dart`.
- **Ожидаемое изменение:** согласованный typed contract and negative tests.
- **Зависимости:** none.
- **Тесты:** authenticated own profile, no token, revoked device, response allowlist, malformed response.
- **Acceptance:** только own profile; closed fields are not leaked to other endpoints.
- **Релиз:** Beta 1.0.
- **Статус:** NOT STARTED.

### PROFILE-PRIVACY-001 — Зафиксировать и защитить существующие границы приватности

- **Приоритет:** P1 перед любым новым endpoint, который читает чужие профильные данные или медиа; P1 для security-регрессий текущих границ.
- **Описание:** вариант В утверждён владельцем. Не проектировать новую public/private модель, не добавлять visibility preferences, блокировки или follow semantics. Зафиксировать фактические правила существующего API: own-profile только по authenticated user; поиск только через текущий `sharesOrgOrLink` gate с минимальным DTO; owner-only files только владельцу/устройству; room files только членам комнаты. Собственный account DTO не смешивать с social/public DTO.
- **Файлы:** `inone-development-archive-0.6.0/engine/src/server.js`, `engine/src/store.js`, `engine/src/schema.sql`, `mobile/lib/core/data/inone_profile.dart`, `mobile/lib/core/data/inone_repositories.dart`, backend tests.
- **Ожидаемое изменение:** регрессионные тесты и документированная матрица текущих правил; без изменения продуктовой политики и без создания public-profile API.
- **Зависимости:** PROFILE-CORE-001. Public-profile implementation остаётся заблокированной до отдельного owner decision, если ей потребуется новая политика.
- **Тесты:** own profile с действующей сессией; отказ без auth/после device revocation; search с допустимой связью; отказ при отсутствии связи; отсутствие email/phone/backupEmail/providers/securityHints/platformRole в search DTO; cross-user owner-only file denial; room file membership checks; invalidation после device revocation.
- **Acceptance:** текущие правила не ослаблены; прямой API запрос не обходит auth/relationship/owner/device checks; нет утечки закрытых account fields; никаких новых visibility semantics не добавлено.
- **Релиз:** Beta 1.0 для защиты существующих границ; новый public-profile contract — только после отдельного решения.
- **Статус:** NOT STARTED.

### FEED-PRIVACY-001 — Owner decision for visibility of other users' publications

- **Приоритет:** P1 — security/privacy release gate for cross-account feed exposure.
- **Описание:** owner policy is approved: all published items intentionally included in the general/news feed are readable by every registered and authenticated InOne account; anonymous requests are denied. Attached media inherits the same eligibility and is re-authorized at download. This rule does not expose profiles, drafts or private account data. Do not reuse `sharesOrgOrLink`, which is a user-search gate only.
- **Файлы:** API contract, `engine/src/server.js`, `engine/src/schema.sql`, media download handler and regression tests.
- **Ожидаемое изменение:** implement the approved authenticated-feed read policy and parent-post media authorization; no unauthenticated/public object URLs.
- **Зависимости:** SCOPE-001 COMPLETE; owner policy approved; PROFILE-PRIVACY-001 and FEED-SEC-001 implementation.
- **Тесты:** authenticated cross-account allow; anonymous/expired/revoked-device deny; malformed/unknown IDs; direct post/media ID access; media URL replay and reauthorization; private DTO leakage checks.
- **Acceptance:** any registered/authenticated account can read a published general-feed item; anonymous access is denied; direct identifiers do not bypass session checks; no profile/private account fields leak.
- **Релиз:** Beta 1.0, mandatory before global feed exposure.
- **Статус:** OWNER DECISION APPROVED / READY FOR IMPLEMENTATION. Rule: every published item intentionally included in the general/news feed is readable by every registered and authenticated InOne account; anonymous access is denied. Apply the same rule to its attachments at download. This does not expose profiles, drafts or private account data. The audited code still lacks the implementation, so cross-account reads must remain disabled until server-side enforcement and regression tests pass.

### FEED-SEC-001 — Authorization model for posts, comments and media

- **Приоритет:** P1.
- **Описание:** до создания feed endpoints определить object-level access для read/edit/delete/comment/react/media на основе уже утверждённых правил; owner immutable; server time. Не предполагать block/private semantics, которых нет в текущей модели; отсутствие согласованного правила для новой функции означает BLOCKED до решения владельца.
- **Файлы:** будущие backend handlers/services/schema; reuse existing authenticated session and object store.
- **Ожидаемое изменение:** server-authoritative access checks and transactional rules.
- **Зависимости:** SCOPE-001 COMPLETE, FEED-PRIVACY-001, PROFILE-PRIVACY-001.
- **Тесты:** BOLA/IDOR matrix for post/comment/reaction/media; cross-account/device; negative cases for the exact approved access rules. Block/private cases only if separately approved.
- **Acceptance:** все direct API negative cases deny access; no UI-only authorization.
- **Релиз:** Beta 1.0.
- **Статус:** NOT STARTED.

### FEED-CORE-001 — Minimal post lifecycle

- **Приоритет:** P1 — Beta 1.0.
- **Описание:** define supported post types/fields, validation, idempotent create, edit/delete and ownership semantics using current backend architecture.
- **Файлы:** future domain modules, `engine/src/server.js`, `engine/src/schema.sql`, migrations, typed DTO/repository.
- **Ожидаемое изменение:** create/read/edit/delete of own publication.
- **Зависимости:** SCOPE-001 COMPLETE, FEED-SEC-001. Cross-account reads remain gated separately by FEED-PRIVACY-001.
- **Тесты:** create, malformed/oversized input, duplicate retry, foreign edit/delete, concurrent edit/delete, deleted URL/API.
- **Acceptance:** server owns authorId/timestamps; transaction keeps post and relations consistent.
- **Релиз:** Beta 1.0.
- **Статус:** NOT STARTED.

### FEED-LIST-001 — Own publications and global feed

- **Приоритет:** P1 — Beta 1.0.
- **Описание:** implement own posts list and global/news feed only to the exact product rules approved; no invented ranking.
- **Файлы:** future feed query/service, indexes, typed repository, Flutter feed screens.
- **Ожидаемое изменение:** authorized feed query, deterministic ordering and refresh.
- **Зависимости:** FEED-CORE-001, FEED-SEC-001; FEED-PRIVACY-001 is required for cross-account rows.
- **Тесты:** own list, только разрешённая по утверждённой модели выдача, удалённые записи исключены, duplicates, new post refresh. Не добавлять private/blocked cases без отдельного утверждённого правила.
- **Acceptance:** no unauthorized rows and deterministic ordering.
- **Релиз:** Beta 1.0.
- **Статус:** NOT STARTED.

### FEED-PAGINATION-001 — Stable cursor and ordering

- **Приоритет:** P1 — Beta 1.0 release feed.
- **Описание:** use stable composite cursor (server timestamp + unique ID or equivalent) and explicit tie-breaker; avoid deep unbounded offset.
- **Файлы:** feed query, schema indexes, repository and pagination state.
- **Ожидаемое изменение:** stable pages across inserts/deletes.
- **Зависимости:** FEED-LIST-001.
- **Тесты:** concurrent inserts, equal timestamps, deleted rows, repeated cursor, boundary rows.
- **Acceptance:** no skipped/duplicated rows for a stable traversal under documented consistency semantics.
- **Релиз:** Beta 1.0.
- **Статус:** NOT STARTED.

### FEED-MEDIA-001 — Secure post attachment lifecycle

- **Приоритет:** P1 before post media release.
- **Описание:** bind media to post with owner/device/access policy; validate real content; use signed/authenticated downloads; cleanup on post deletion according to retention policy. Do not assume MLS encryption applies to social media.
- **Файлы:** `engine/src/server.js`, `engine/src/object-store.js`, `engine/src/store.js`, `engine/src/schema.sql`, migrations, Flutter media adapter.
- **Ожидаемое изменение:** media upload → validation → association → authorized retrieval → cleanup.
- **Зависимости:** FEED-SEC-001, FEED-CORE-001.
- **Тесты:** MIME/magic mismatch, size/dimensions, wrong owner, access change caused by existing owner/device/room membership revocation, orphan cleanup, path traversal.
- **Acceptance:** only validated objects are associated; access policy is checked at retrieval; cleanup is observable/idempotent.
- **Релиз:** before any feed media release.
- **Статус:** NOT STARTED.

### FEED-INTERACTION-001 — Comments and reactions

- **Приоритет:** P2; raise to P1 only if included in approved Beta 1.0.
- **Описание:** add minimal interaction model only after product scope; enforce ownership, uniqueness and transactional counters.
- **Файлы:** future schema/service/routes/repository/UI.
- **Ожидаемое изменение:** authorized comment/reaction operations.
- **Зависимости:** FEED-CORE-001, FEED-SEC-001.
- **Тесты:** foreign edit/delete, repeat reaction, concurrent counts, deleted/hidden post, spam limits.
- **Acceptance:** no duplicate logical reaction; counts equal persisted rows.
- **Релиз:** Beta 2.0 unless approved.
- **Статус:** NOT STARTED.

### PROFILE-EDIT-001 — Profile edit fields

- **Приоритет:** P2 current scope; P1 only if owner includes it in Beta 1.0.
- **Описание:** define editable field allowlist, validation and concurrency policy. Keep account email/phone/provider credentials outside generic profile PATCH.
- **Файлы:** profile route/service/store/schema, DTO, repository, edit screen.
- **Ожидаемое изменение:** authenticated owner edits only separately approved profile fields; existing privacy model remains unchanged.
- **Зависимости:** PROFILE-CORE-001, PROFILE-PRIVACY-001.
- **Тесты:** protected fields, foreign user, invalid input, concurrent edits, sync.
- **Acceptance:** no mass assignment; only explicitly allowed fields persist.
- **Релиз:** Beta 2.0 unless approved.
- **Статус:** NOT STARTED.

### PROFILE-MEDIA-001 — Avatar and cover

- **Приоритет:** P2 current scope; P1 before public image release.
- **Описание:** connect avatar/cover metadata to profile; implement validation, replacement, authorized delivery and cleanup. Generic `kind: avatar` is not sufficient.
- **Файлы:** `server.js`, `schema.sql`, migrations, object store, Flutter profile repository/screen.
- **Ожидаемое изменение:** full owner-controlled media lifecycle.
- **Зависимости:** PROFILE-EDIT-001, PROFILE-PRIVACY-001, FP-008.
- **Тесты:** image spoofing, dimensions, old file revocation, other user access, account deletion, device revocation.
- **Acceptance:** существующая owner/device/room access policy enforced by API, not client; никакой файл не становится публичным без отдельного решения и контракта; no orphaned accessible objects.
- **Релиз:** Beta 2.0 unless approved.
- **Статус:** NOT STARTED.

### FLUTTER-FEED-001 — Native feed UI integration

- **Приоритет:** P1 — Beta 1.0.
- **Описание:** build native Dart screens only after verified backend contracts; add loading/empty/error/refresh/pagination and post composer.
- **Файлы:** `mobile/lib/ui_dart_source/screens/main/`, `mobile/lib/core/data/`, `mobile/lib/app/inone_mobile_app.dart`.
- **Ожидаемое изменение:** real typed API integration; no mock/demo production data.
- **Зависимости:** FEED-CORE-001, FEED-LIST-001, FEED-PAGINATION-001, FEED-MEDIA-001.
- **Тесты:** repository, widget, state, refresh, pagination and offline tests.
- **Acceptance:** complete Flutter → API → DB → Flutter path proven; no HTML/WebView restoration.
- **Релиз:** Beta 1.0.
- **Статус:** NOT STARTED.

### FLUTTER-PROFILE-001 — Stabilize profile read and future edit screens

- **Приоритет:** P1 for current profile-read acceptance; P2 for unapproved edit scope.
- **Описание:** test current own profile rendering and errors; only add edit/public profile screens after contract approval.
- **Файлы:** `mobile/lib/app/inone_mobile_app.dart`, `mobile/lib/core/data/inone_profile.dart`, `mobile/lib/core/data/inone_repositories.dart`, profile screen and tests.
- **Ожидаемое изменение:** current profile read maps exact backend fields; future writes are typed.
- **Зависимости:** PROFILE-CORE-001; PROFILE-EDIT-001 for edit.
- **Тесты:** loading/error/empty, refresh, logout/revocation, field mapping, two-device sync.
- **Acceptance:** no fake values; private account fields never enter public presentation.
- **Релиз:** Beta 1.0 for read; edit conditional.
- **Статус:** NOT STARTED.

### FEED-PERFORMANCE-001 — Query/index and feed load profile

- **Приоритет:** P2.
- **Описание:** only after a real feed query exists, review EXPLAIN plans, indexes, N+1 behavior, payload bounds and cache invalidation.
- **Файлы:** feed query, schema/migrations, tests/benchmarks.
- **Ожидаемое изменение:** bounded query cost and payload.
- **Зависимости:** FEED-LIST-001, FEED-PAGINATION-001.
- **Тесты:** PostgreSQL query plan and representative data volume tests.
- **Acceptance:** query plan and response-size budgets documented.
- **Релиз:** Beta 1.0 minimum capacity; advanced scaling Beta 2.0.
- **Статус:** NOT STARTED.

### FEED-TESTS-001 — Automated social security/regression matrix

- **Приоритет:** P1 before any social release.
- **Описание:** implement all applicable §11.2 tests at backend/API/DB/Flutter layers.
- **Файлы:** `engine/test/`, `mobile/test/`, integration test folders and workflows.
- **Ожидаемое изменение:** reproducible exact-SHA evidence.
- **Зависимости:** FEED-SEC-001, FEED-CORE-001, PROFILE-PRIVACY-001 and relevant UI tasks.
- **Тесты:** complete test matrix, including negative authorization and concurrency.
- **Acceptance:** required jobs green on exact proposed SHA; tests actually executed.
- **Релиз:** before corresponding Beta release.
- **Статус:** NOT STARTED.

### FEED-ACCEPTANCE-001 — Final Beta 1.0 acceptance

- **Приоритет:** P1.
- **Описание:** confirm scope, exact main SHA, API contracts, security tests, mobile builds, two-device behavior and no outstanding P0/P1.
- **Файлы:** acceptance report and implementation plan.
- **Ожидаемое изменение:** evidence-backed acceptance; no inferred PASS.
- **Зависимости:** all approved Beta 1.0 tasks.
- **Тесты:** exact-SHA CI + local/device acceptance as required.
- **Acceptance:** owner-approved release checklist fully green.
- **Релиз:** Beta 1.0.
- **Статус:** BLOCKED.

## 17. Порядок реализации и контрольные точки

1. **Gate 0 — SCOPE-001:** COMPLETE; Feed is approved for Beta 1.0 and WBS v1.2 records the scope.
2. **Gate 1 — FEED-PRIVACY-001:** OWNER DECISION APPROVED. Implement the approved rule: all registered/authenticated InOne accounts may read published general-feed posts; anonymous access is denied. Feed attachments inherit the same rule and are re-authorized at download. This does not expose profiles, drafts or private account data.
3. **Gate 2 — PROFILE-CORE-001 / PROFILE-PRIVACY-001 / FEED-SEC-001:** establish session validation, DTO privacy, ownership and server-side object authorization before feed APIs.
4. **Gate 3 — FEED-CORE-001:** own post lifecycle and database integrity.
5. **Gate 4 — FEED-LIST-001 + FEED-PAGINATION-001:** own and authenticated general-feed query with deterministic traversal and published-item eligibility.
6. **Gate 5 — FEED-MEDIA-001:** validated post attachment pipeline; enforce parent-post eligibility on every download.
7. **Gate 6 — FLUTTER-FEED-001 / FLUTTER-PROFILE-001:** native Dart integration only after backend contracts/security gates.
8. **Gate 7 — FEED-TESTS-001 / FEED-PERFORMANCE-001:** exact-SHA test matrix, anonymous-denial and cross-account-authenticated allow tests, IDOR/media tests, PostgreSQL query plan, mobile analysis/widget/integration tests.
9. **Gate 8 — FEED-ACCEPTANCE-001:** owner acceptance; no open P0/P1 and no unresolved security/privacy blockers.

## 18. Зависимости

`SCOPE-001 (COMPLETE) + FEED-PRIVACY-001 (OWNER DECISION APPROVED) → PROFILE-PRIVACY-001 / FEED-SEC-001 → FEED-CORE-001 → FEED-LIST-001 → FEED-PAGINATION-001 → FEED-MEDIA-001 → FLUTTER-FEED-001 → FEED-TESTS-001 → FEED-ACCEPTANCE-001`.

Profile path: `PROFILE-CORE-001 → PROFILE-PRIVACY-001 → PROFILE-EDIT-001 → PROFILE-MEDIA-001 → FLUTTER-PROFILE-001 → FEED-TESTS-001`.

Comments/reactions depend on the post lifecycle and server authorization, not the reverse. UI must not begin production integration before the relevant backend contracts are verified.

## 19. Критерии приёмки

- Every endpoint has request/response/error contract and backend authorization.
- Owner and access-policy checks run server-side for every object; новые visibility semantics не вводятся без решения владельца.
- Public profile DTO is separate from authenticated own-account DTO.
- Email, phone, backup email, provider details, platform role, device/session information and security hints never appear in public social DTO.
- Author and creation timestamp are server-owned.
- Create and reaction retries are idempotent.
- Feed ordering and cursor semantics are stable and documented.
- Media is validated, bound to the correct owner/post/profile and re-authorized at download.
- Replaced/deleted media follows explicit cleanup/retention policy.
- No fake profile/feed data is shown as real.
- Flutter uses native Dart and typed repositories; no HTML/WebView is restored.
- Required tests run and pass on exact proposed SHA.
- No outstanding P0/P1 security/privacy/data-integrity issue remains.

## 20. Definition of Done

A task is complete only when implementation, tests, review and merge are complete; the PR updates this plan in the same change; exact merge SHA and test evidence are recorded. A source file or test name is not a PASS.

For a closed task preserve ID, original description, acceptance criteria, PR link, merge SHA, completion date, test results, implementer and reviewer. Then strike through the task title without deleting the record. If a regression is found, remove the strike-through and reopen the task with previous closure evidence retained.

**No implementation task is closed.** SCOPE-001 is complete as a governance decision and FEED-PRIVACY-001 has an approved owner policy; its backend enforcement remains unimplemented and must be verified. All implementation tasks remain NOT STARTED. No implementation task has been struck through.

## 21. Журнал выполнения и закрытия задач

| Дата | Task ID | Событие | PR | Merge SHA | Тесты | Статус |
|---|---|---|---|---|---|---|
| 2026-11-26 | AUDIT-BASELINE | Read-only source review of code snapshot 216c6d9; revalidated against current main 920e2a2 (two intervening commits changed only development rules) | — | — | NOT RUN | COMPLETE |
| 2026-11-26 | PRIVACY-DECISION-V | Owner selected variant В: preserve current privacy model without policy changes | — | — | Owner decision recorded | COMPLETE |
| 2026-11-26 | SCOPE-001 | Owner approved Feed in Beta 1.0; WBS v1.2 scope amendment prepared | — | — | Owner decision + document review | COMPLETE |
| 2026-11-26 | FEED-PRIVACY-001 | Owner approved authenticated cross-account read of published general-feed items; anonymous denied; attachment access inherits the rule | — | — | Owner decision recorded; implementation tests NOT RUN | OWNER DECISION APPROVED / IMPLEMENTATION PENDING |
| 2026-11-26 | WBS-1.2-FEED | Owner approved Feed in Beta 1.0; scope amendment mapped into existing weighted domains | — | — | Document review | APPROVED / PR REVIEW PENDING |
| — | All implementation tasks | No implementation performed | — | — | NOT RUN | NOT STARTED |

## 22. Ограничения и что не выполнялось

- Не запускались Node, PostgreSQL, Flutter, Dart, Rust/OpenMLS, Android/iOS build, simulator или physical-device tests.
- Не запускались production endpoints и не читались реальные пользовательские данные.
- Не проводились destructive tests, load tests или live penetration tests.
- Не менялись исходный код, SQL schema/migrations, configuration, workflows, Flutter screens or UI assets.
- Не восстанавливались HTML/WebView screens.
- WBS v1.2 scope amendment prepared on this documentation branch; existing weights and historical v1.1 baseline are preserved. No implementation progress percentage is recalculated. Commercial policy unchanged.
- CI evidence from other SHAs was not counted as PASS for this audited SHA.

## 23. Публикация документа

Этот документ подготовлен в отдельной ветке от exact main SHA:

- Source snapshot: `main` / `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`
- Current main revalidation: `920e2a2ecef244c925061348eb68c8b09fe63922` (two documentation-only commits ahead of source snapshot)
- Task branch: `audit/feed-profile-beta1-main-216c6d9-20261126`
- Intended path: `development/FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md`
- Change scope: one documentation file only.

Владелец запросил публикацию этого документа в `main`. Документ опубликован отдельным документационным коммитом `8260beb7070d959dce17ee423e2768dbea4399c9`, без изменения product source, API, схемы, миграций, конфигурации или Flutter UI. После повторного чтения файла из `main` черновой PR [#167](https://github.com/vahe210991-cloud/InOne-chat/pull/167) закрыт как superseded; его task branch сохранена. Blob SHA опубликованного файла: `7365dfa59e6feec057c232cd9c7454b84e11deba`.

## 24. Owner scope approval — Feed in Beta 1.0 (2026-11-26)

Владелец подтвердил включение ленты публикаций и новостей в Beta 1.0. WBS v1.2 и решение §9 в `docs/continuity/DECISIONS.md` фиксируют это изменение. Данный scope amendment находится в отдельной документационной ветке `docs/feed-beta1-scope-approval-20261126`, созданной от main SHA `7d34b99fcc026a828b838e211d039c575aeace1d`.

- WBS v1.2 сохраняет все существующие доменные веса и исторический baseline v1.1; текущие проценты реализации/проверки не пересчитывались.
- FP-001 становится безусловным P1 Beta 1.0 release blocker.
- SCOPE-001 COMPLETE (owner decision); implementation tasks remain NOT STARTED.
- FEED-PRIVACY-001 owner policy is APPROVED: published general-feed items are readable by all registered/authenticated InOne accounts; anonymous access is denied. Feed attachments inherit the rule and are re-authorized at download. The source still lacks enforcement, so do not return cross-account post/media data until server-side implementation and security tests pass. `sharesOrgOrLink` remains user-search-only.
- Own-post CRUD/list may proceed independently while the approved global-feed policy is implemented.
- Comments/reactions and advanced social features are not automatically included in the minimum Feed scope.
- This branch changes documentation only. No application source, schema/migrations, configuration, workflow, Flutter UI or tests were changed/run.

