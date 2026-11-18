# InOne Beta 1.0 — план полной технической готовности и приёмочный чек-лист

**Версия:** 1.0  
**Дата:** 2026-11-18  
**Базовый commit:** `ef626c0d7c125f2f4c761e02992b475d1b2dd2e4` (merge PR #79 в `main`)  
**Статус:** план работ; выполнение пунктов этим документом не подтверждается  
**Область:** только перечисленные семь направлений завершения Beta 1.0. Новые функции Beta 2.0 не добавлять.

## 0. Правила исполнения и доказательств

1. Работать от актуального `main`; перед началом каждого потока записывать SHA, `git status --short --branch`, Node/Flutter/Rust/OS версии и используемую среду.
2. Не переписывать историю, не force-push, не удалять ветки/теги и не удалять исходники без отдельного решения владельца.
3. Любое изменение — отдельная рабочая ветка от актуального `main`, небольшие тематические коммиты, Draft PR до завершения проверок. Не вливать без отдельного разрешения владельца.
4. Старые ветки и PR сначала сравнить с `main` по ancestry, tree, diff и зависимости коммитов. Не делать массовый merge/cherry-pick и не считать PR с Draft/непройденным CI частью `main`.
5. Любой PASS привязывать к точному commit SHA, workflow/job, команде, среде и артефакту/логу. Перезапуск CI после изменения кода обязателен: предыдущий PASS не переносится на новый SHA.
6. Разделять `implemented`, `unit-tested`, `integration-tested`, `device-tested`, `owner-accepted`. Наличие исходника, теста или workflow само по себе не закрывает критерий.
7. Секреты и реальные персональные данные не записывать в Git, логи, screenshots, артефакты или отчёты. Для E2E использовать выделенные тестовые учётные записи и тестовые почтовые ящики.
8. Не включать MLS в production/runtime и не снимать fail-closed предохранители, пока весь MLS gate не пройден на обеих платформах и владелец не принял результат.
9. Не расширять scope Beta 1.0: CRM, календарь, задачи, Cindy/AI и прочие функции Beta 2.0 остаются вне этих критериев.

### Общий Definition of Done (DoD)

- Все семь направлений имеют чек-лист со статусом, ответственным, точным SHA и ссылкой на доказательство.
- Все обязательные CI workflow завершены PASS на кандидате релиза; нет пропущенных required checks.
- Все P0/P1 дефекты закрыты или явно приняты владельцем с обоснованием и ограничением риска.
- Нет известных production secrets в Git и build artifacts; конфигурация проверена без вывода значений секретов.
- Backend/API, Flutter UI, MLS, email и storage прошли интеграционные сценарии; Android и iOS проверены на реальных устройствах.
- Восстановление и отзыв устройства доказаны, включая негативные сценарии.
- Операционные инструкции, backup/restore, миграции, мониторинг, release/rollback и матрица поддержки обновлены.
- Владелец принимает Beta 1.0 по сводному протоколу на одном exact release-candidate SHA.

## 1. Завершить post-merge Flutter CI

**Цель:** получить окончательный результат Flutter analyze, Flutter tests, Rust bridge validation и Android APK на исходном merge SHA `ef626c0d7c125f2f4c761e02992b475d1b2dd2e4`, а затем на каждом последующем исправленном SHA.

### Шаги

- [ ] Проверить актуальное состояние run [44253911721](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44253911721); записать final conclusion, все jobs/steps и commit SHA. Не считать прежний статус `in_progress` итоговым результатом.
- [ ] Если run завершился ошибкой/отменой — сохранить логи, классифицировать причину (код, workflow, runner/environment, external dependency), исправить в отдельной ветке и повторить весь affected gate.
- [ ] Если run на SHA `ef626c0` успешен — зафиксировать результат как baseline проверки merge-коммита. Если main уже продвинулся, не подменять этим результатом проверку нового HEAD.
- [ ] Проверить версии Flutter (workflow закрепляет 3.47.9), Dart, Rust 1.91.0, Android NDK и FRB codegen 2.13.0.
- [ ] На чистом checkout выполнить ровно workflow sequence: verify gallery, generate platform projects, FRB integration/codegen, Android NDK preparation, UI archive integrity, `flutter pub get`, `cargo check --locked --all-targets`, `cargo test --locked`, `flutter analyze`, `flutter test`, `flutter build apk --debug`.
- [ ] Проверить, что generated Dart/Rust bindings соответствуют committed Rust API и lockfiles; генерация не меняет неожиданные файлы и не скрывает ошибки.
- [ ] Скачать Android APK artifact, проверить наличие, размер, SHA-256, установку и запуск на эмуляторе и физическом Android.
- [ ] Проверить iOS project generation/build отдельно на macOS runner; Android APK не является доказательством iOS readiness.
- [ ] Проверить read-only permissions workflow: CI не должен commit/push generated files в ветку.
- [ ] Добавить результаты в evidence ledger с run URL и exact SHA.

### Команды для локальной воспроизводимости

Из корня репозитория (PowerShell):

```powershell
Set-Location C:\InOne
git status --short --branch
git rev-parse HEAD
flutter --version
dart --version
rustc --version
cargo --version
Set-Location .\mobile
flutter pub get
cargo check --locked --all-targets --manifest-path rust/Cargo.toml
cargo test --locked --no-fail-fast --manifest-path rust/Cargo.toml
flutter analyze
flutter test
flutter build apk --debug
```

Platform-project generation и FRB codegen выполнять по закреплённым шагам `.github/workflows/flutter-mobile.yml`; не подменять их сокращённым локальным запуском.

### Критерии закрытия

- [ ] Все Flutter workflow jobs PASS на exact SHA.
- [ ] `flutter analyze` без ошибок; предупреждения разобраны и документированы.
- [ ] Все Flutter tests PASS; нет необъяснённых skips.
- [ ] Rust bridge check/tests PASS.
- [ ] Android APK собран, скачан, установлен и запускается.
- [ ] iOS build/test gate PASS на macOS.
- [ ] Артефакты и логи доступны по ссылкам.

## 2. Свести native Dart UI в единую рабочую ветку

**Цель:** перевести production mobile UI на native Flutter/Dart, сохранив одобренные HTML как неизменяемый визуальный эталон и архив, а не как production runtime.

### Шаги

- [ ] Зафиксировать canonical production entrypoint и текущую архитектуру `main`; перечислить WebView/HTML runtime dependencies, текущие host bridges и screen catalog.
- [ ] Составить реестр утверждённых экранов: screen ID, light/dark variant, HTML reference path/hash, Dart implementation path, route, API contract, states, localization, test.
- [ ] Проверить происхождение UI пакетов/архивов и SHA-256. Эталонные HTML/assets не редактировать при переносе логики.
- [ ] Исследовать PR #52 и связанные ветки по commit ancestry и path-level diff. Выделить независимые коммиты, общие предки, дубли и изменения, уже вошедшие в main.
- [ ] Не сливать PR #52 целиком вслепую: подготовить dependency map и интеграционный план, перенести только проверенные нужные изменения в единую feature branch от актуального main.
- [ ] Реализовать native Flutter app shell: routing/navigation, theme, responsive layout, localization, loading/empty/error/offline states, session lifecycle.
- [ ] Перенести production screen implementation на Dart. Для каждого экрана сверить визуальную геометрию, типографику, assets, состояния и доступность с утверждённым HTML reference.
- [ ] Удалить WebView из production execution path только после функционального паритета и успешных тестов. Сохранить HTML в явно обозначенном reference/archive path; добавить тест, который гарантирует отсутствие HTML/WebView запуска из production entrypoint.
- [ ] Проверить, что production builds не используют demo data, mock repositories, test gallery или test-only routes.
- [ ] Добавить widget/golden tests для критичных экранов и navigation tests для главных пользовательских потоков.
- [ ] Проверить Android/iOS layout, safe areas, клавиатуру, системную навигацию, dynamic text, light/dark и локали.
- [ ] Обновить ADR/README и карту экранов; зафиксировать решение: Dart — production UI, HTML — approved reference only.

### Критерии закрытия

- [ ] Production app запускает native Dart UI; HTML/WebView не является runtime экранов.
- [ ] 100% экранов, входящих в утверждённый Beta 1.0 scope, имеют Dart implementation и связанный тест.
- [ ] Для каждого экрана есть reference parity check и состояния loading/empty/error/unauthenticated.
- [ ] Нет незаполненных production placeholders/demo data на обязательных маршрутах.
- [ ] Навигация и локализация проверены на Android и iOS.
- [ ] Старые HTML assets сохранены с контрольными суммами и однозначной пометкой reference/archive.
- [ ] PR содержит карту переноса, список исключений и exact-head CI evidence.

## 3. Закончить MLS mobile pipeline

**Цель:** безопасный полный путь от регистрации/аутентификации устройства до сохранённой MLS-сессии, шифрования/расшифрования сообщений и файлов, синхронизации и отзыва устройства.

### Шаги

**A. Владение ключами и FFI**
- [ ] Утвердить единственный canonical persistent Rust MLS client и crate dependency; исключить временные/дублирующие runtime из production path.
- [ ] Проверить FRB API, типы, ошибки, ownership/lifetime, concurrency и сериализацию; Dart не должен самостоятельно владеть MLS private keys.
- [ ] Проверить генерацию и импорт bindings на чистой среде и соответствие lockfiles.
- [ ] Проверить Android Keystore и iOS Keychain: hardware-backed где поддерживается, device-only accessibility, backup/migration policy, биометрические/lock-state edge cases.
- [ ] Проверить отказ при недоступном/повреждённом secure storage; не переходить на plaintext или слабый fallback.

**B. SQLCipher и сессия**
- [ ] Проверить SQLCipher encryption at rest, key derivation/transfer, отсутствие ключа в Dart logs/preferences/backup/plain files.
- [ ] Проверить создание, открытие, закрытие, lock/unlock и восстановление базы после process kill/reboot.
- [ ] Проверить атомарность session updates, transaction rollback, crash recovery, concurrent refresh и idempotency.
- [ ] Проверить, что refresh token принадлежит Rust client; Dart получает только краткоживущий access snapshot по утверждённому контракту.
- [ ] Проверить logout, token rotation, expiry, replay rejection и очищение чувствительного состояния.

**C. MLS сообщения**
- [ ] Проверить создание группы и добавление устройств/участников, KeyPackage lifecycle, epoch transitions и membership changes.
- [ ] Проверить encrypt/decrypt на двух независимых реальных устройствах; ciphertext не должен содержать plaintext.
- [ ] Проверить duplicate, reorder, retry, offline queue, ACK, reconnect и потерю/устаревание epoch.
- [ ] Проверить invalid signature, wrong group, replay, malformed ciphertext и revoked device — все должны завершаться безопасным отказом.
- [ ] Проверить OTR/ephemeral режим, если он входит в Beta 1.0 scope, отдельными сценариями и без смешивания с persistent history.

**D. Вложения**
- [ ] Включить и проверить authenticated encryption для вложений (AEAD); ключ/nonce/tag и associated data имеют определённый протокол и versioning.
- [ ] Проверить upload/download только через разрешённый encrypted flow; серверное object storage не получает plaintext.
- [ ] Проверить целостность, неправильный ключ, tampering, truncation, повторную отправку, MIME/size limits и частичный upload.
- [ ] Проверить device binding, ACL, удаление/отзыв устройства и недоступность вложения неавторизованным устройствам.
- [ ] Проверить крупные файлы, resume/retry и очистку незавершённых объектов.

**E. Отзыв устройства и восстановление**
- [ ] Проверить отзыв устройства на backend и MLS уровне: исключение из группы, epoch update, блокировка новых credentials и прекращение доступа к новым данным.
- [ ] Проверить, что уже сохранённые локальные данные на отозванном устройстве очищаются/криптографически блокируются в соответствии с threat model.
- [ ] Проверить восстановление на новом устройстве с подтверждённым фактором; recovery deep link не должен позволять подменить аккаунт/устройство.
- [ ] Проверить lost-device, revoked-device, expired-link, replayed-link, wrong-account, no-network и partial-failure сценарии.
- [ ] Убедиться, что после восстановления старые credentials не остаются действительными без предусмотренного policy.

**F. Включение**
- [ ] Сохранить fail-closed feature flag до прохождения всех предыдущих пунктов.
- [ ] Подготовить staged rollout/kill switch и телеметрию без секретов.
- [ ] Только после exact-head CI + Android/iOS E2E + security review + owner approval разрешать включение native MLS.

### Критерии закрытия

- [ ] Rust/FRB tests и iOS/Android native builds PASS.
- [ ] Key storage и SQLCipher проверены на реальных устройствах.
- [ ] Два устройства успешно отправляют/получают MLS сообщения после перезапуска и offline периода.
- [ ] Вложения шифруются до передачи, расшифровываются только авторизованным клиентом.
- [ ] Отзыв устройства и recovery доказаны положительными и отрицательными тестами.
- [ ] Ни один секрет/ключ не попадает в Dart, logs, crash reports или plaintext storage.
- [ ] Threat model, key lifecycle и операционные инструкции обновлены.

## 4. Закрыть API-интеграцию

**Цель:** каждый Beta 1.0 screen action соединён с реальным backend route через типизированный repository и проверен сквозным тестом.

### Шаги

- [ ] Сформировать единую матрицу: screen ID → UI action → repository method → HTTP method/path → auth requirement → request DTO → response DTO → backend handler → DB transaction → tests.
- [ ] Для каждого route сверить OpenAPI/документацию с реальным handler в canonical engine `inone-development-archive-0.6.0/engine`; документация без handler не считается реализацией.
- [ ] Пометить каждый action: LIVE, PARTIAL, MOCK, PLACEHOLDER, NOT IN BETA 1.0. Не считать экран подключённым из-за одного GET или наличия route в сервере.
- [ ] Проверить auth/session refresh, 401/403/404/409/422/429/5xx, timeout, offline, malformed JSON, pagination и retry semantics.
- [ ] Проверить ownership/authorization на backend для каждого read/write, включая cross-user и cross-organization negative tests.
- [ ] Проверить DTO validation, nullability, enum/version compatibility, date/time/timezone, localization и error-code mapping.
- [ ] Убрать hard-coded demo data и локальные fake responses из production flow.
- [ ] Добавить contract tests и integration tests, запускающие реальный backend/DB; Flutter test doubles оставить только для unit/widget tests.
- [ ] Для каждого критического пользовательского сценария зафиксировать сетевой trace с redaction credentials и подтверждение изменения/чтения в БД.
- [ ] Сверить API allowlist/bridge allowlist: экран не может вызвать endpoint, не разрешённый для него.

### Обязательная матрица сценариев

- [ ] Регистрация, подтверждение email, login, logout, refresh, session expiry.
- [ ] Профиль, изменение локали и настроек, подтверждённые поля.
- [ ] Список комнат, создание/вход/выход, участники и права доступа.
- [ ] Отправка/получение сообщений через MLS, ACK и offline recovery.
- [ ] Организации и заявки — только операции, входящие в утверждённый Beta 1.0 scope.
- [ ] Поиск — только реально поддерживаемые API/данные.
- [ ] Файлы/вложения — encrypted flow, ACL и device binding.
- [ ] Восстановление доступа и подтверждение устройства.
- [ ] Push/notifications — если включены в Beta 1.0 acceptance scope; иначе явно пометить deferred.

### Критерии закрытия

- [ ] 100% Beta 1.0 UI actions имеют однозначный статус и контракт.
- [ ] Все обязательные actions — LIVE, без MOCK/PLACEHOLDER.
- [ ] Каждый write проверен в backend/DB и негативными auth/permission тестами.
- [ ] Contract/integration tests PASS на exact SHA.
- [ ] Ни одна операция не заявлена как connected только по наличию backend route.

## 5. Проверить реальную почтовую доставку

**Цель:** доказать полный путь от действия пользователя до фактического получения ожидаемого письма в тестовом mailbox на всех предусмотренных сценариях.

### Шаги

- [ ] Составить полный список email events/templates: регистрация/verification, повторная отправка кода, восстановление доступа, recovery confirmation, device/security notifications и остальные реально предусмотренные события.
- [ ] Для каждого события записать trigger, recipient, template ID, locale, outbox event, retry policy, expiry, deduplication/idempotency key и expected subject/content markers.
- [ ] Поднять тестовую среду с отдельным PostgreSQL и SMTP provider/mailbox. Не использовать реальные пользовательские адреса.
- [ ] Проверить создание outbox row в той же транзакции, что и бизнес-событие; rollback не должен оставлять ложное письмо.
- [ ] Проверить worker pickup, lease/locking, retry/backoff, timeout, provider rejection, process restart, duplicate delivery и dead-letter/terminal failure handling.
- [ ] Проверить SMTP TLS, authentication, sender identity, provider response, rate limits и отсутствие секретов в логах.
- [ ] Настроить и проверить SPF, DKIM, DMARC для тестового/production домена; зафиксировать DNS evidence.
- [ ] Выполнить каждый сценарий на Armenian/Russian/English, если эти локали предусмотрены UI. Проверить, что язык письма следует account locale и не меняет сохранённую локаль.
- [ ] Проверить получение письма через реальный mailbox API/клиент, а не только SMTP accepted или mock transport. Сопоставить message ID/correlation ID с outbox record.
- [ ] Проверить bounce, complaint, invalid recipient, mailbox delay, spam/quarantine и provider outage.
- [ ] Проверить deep links: домен, TLS, одноразовость, срок действия, привязку к account/action и безопасный fallback.
- [ ] Запустить email workflow отдельно на PR и на main; исправить branch filters так, чтобы post-merge main проверки действительно запускались при изменении engine/workflow.
- [ ] Шаблоны должны иметь устойчивый template ID и locale; возможность редактирования через admin panel — отдельная функция, не блокировать ею доставку Beta 1.0, если она не включена в утверждённый scope.

### Матрица обязательного доказательства для каждого письма

- [ ] Триггер выполнен тестовой учётной записью.
- [ ] В БД создан ровно ожидаемый outbox event.
- [ ] Worker обработал событие и записал provider result.
- [ ] SMTP provider принял сообщение.
- [ ] Письмо фактически обнаружено в mailbox.
- [ ] Recipient, template ID, locale, link expiry и content markers соответствуют сценарию.
- [ ] Retry/deduplication не создали неожиданное дублирование.
- [ ] Evidence сохранено с редактированием адресов/токенов.

### Критерии закрытия

- [ ] Каждый предусмотренный email event проверен end-to-end.
- [ ] Получение подтверждено реальным mailbox для всех тестовых сценариев и локалей.
- [ ] Bounce/retry/provider outage обработаны ожидаемо.
- [ ] SPF/DKIM/DMARC проверены на домене, который будет использоваться при выпуске.
- [ ] Никаких секретов и одноразовых ссылок в артефактах/логах.

## 6. Провести реальные испытания Android, iOS и двух устройств

**Цель:** подтвердить реальную эксплуатацию приложения и backend на физических устройствах, включая offline, восстановление, синхронизацию, сообщения и файлы.

### Подготовка

- [ ] Определить минимум один физический Android и один физический iPhone; записать модели, OS/build, app build SHA, backend environment и network conditions.
- [ ] Подготовить два отдельных тестовых аккаунта и два устройства; для проверки multi-device одного аккаунта использовать предусмотренный device enrollment flow.
- [ ] Подготовить staging backend, тестовую БД, test mailbox, push/SMS provider при наличии, TLS и тестовые данные.
- [ ] Убедиться, что backup/restore БД проверены до destructive tests.
- [ ] Включить безопасную диагностику с redaction PII/tokens/keys.

### Сценарии

- [ ] Чистая установка Android/iOS, первый запуск, permissions, локаль, onboarding.
- [ ] Регистрация, подтверждение email, вход, выход, перезапуск, истечение и обновление сессии.
- [ ] Вход одного аккаунта на двух разрешённых устройствах; проверка device list и trust state.
- [ ] Отправка/получение сообщений в обоих направлениях; проверка delivery/ACK и порядка.
- [ ] Перевод устройства offline, отправка/очередь, reconnect, синхронизация и отсутствие потери/дублирования.
- [ ] Закрытие приложения/force kill/reboot во время отправки и восстановления сессии.
- [ ] Загрузка и получение вложений разных размеров; повреждённый ciphertext и неверный ключ должны отвергаться.
- [ ] Восстановление доступа на новом устройстве с подтверждённым фактором; повторное использование/просрочка recovery link должны отвергаться.
- [ ] Отзыв потерянного/старого устройства; проверить невозможность новых операций и обновление MLS membership.
- [ ] Смена сети Wi-Fi/mobile, слабая сеть, timeout, captive portal и повтор запроса.
- [ ] Проверка push/notification delivery, если включено в Beta 1.0.
- [ ] Проверка background/foreground, app lifecycle, permissions, biometric/device lock и low-storage behavior.
- [ ] Проверка accessibility, safe areas, keyboard, dark/light, локалей и ориентации в пределах заявленной поддержки.
- [ ] Регрессия критичных сценариев после обновления приложения поверх предыдущей тестовой версии.

### Критерии закрытия

- [ ] Все P0/P1 сценарии PASS на реальных Android и iOS устройствах.
- [ ] Multi-device messaging, offline sync, recovery и revocation PASS.
- [ ] Encrypted attachments PASS; plaintext не обнаруживается на серверном объектном хранилище.
- [ ] Нет blocker/crash/data-loss/security defects.
- [ ] Протокол содержит устройство, OS, app SHA, backend SHA, сценарий, результат, время и ссылки на redacted evidence.
- [ ] Владелец подтверждает приёмку физического тестирования.

## 7. Очистить карту веток и документацию

**Цель:** оставить прозрачную Git-структуру и актуальную документацию, не потеряв полезную историю и незавершённую работу.

### Шаги

- [ ] Снять актуальный snapshot: все branches (включая protected), open PR, Draft PR, merged PR, tags, default branch HEAD.
- [ ] Для каждого открытого PR получить base/head SHA, merge-base, ahead/behind, changed files, CI status, reviews, conflicts.
- [ ] Сопоставить изменения PR с текущим `main`: файл может совпадать по пути, но содержимое/коммиты могут отличаться. Проверять patch equivalence, а не только наличие пути.
- [ ] Разделить PR/ветки на: MERGED/EQUIVALENT, REQUIRED/NOT IN MAIN, SUPERSEDED, BLOCKED, DUPLICATE, HISTORICAL/ARCHIVE.
- [ ] Для PR #52, #57, #58, #59 и других MLS/UI кандидатов построить commit dependency graph; извлечь минимальные независимые изменения, нужные для завершения Beta 1.0.
- [ ] Не закрывать PR и не удалять ветки до сохранения diff, commit SHAs, причин решения и проверки отсутствия уникальных изменений.
- [ ] Объединять логически связанные изменения через последовательные PR от актуального main; один PR — один проверяемый поток/вертикальный срез.
- [ ] Обновить `docs/continuity/CURRENT-STATE.md`, `NEXT-SESSION.md`, `development/SESSION-LOG.md`, ADR, API/screen inventory и `development/PROGRESS-BASELINE.md` только доказанными результатами.
- [ ] Сохранить WBS v1.1 и её веса. Не заменять утверждённую методику новыми произвольными процентами; пересчёт только по строкам WBS с evidence и историей.
- [ ] Удалить из актуальных документов устаревшие инструкции только после переноса в историческую запись; не переписывать исторические отчёты так, будто старое состояние не существовало.
- [ ] Проверить ссылки, пути, даты, SHA и CI URLs; выполнить markdown/link checks, если они предусмотрены репозиторием.
- [ ] Подготовить release handoff: build instructions, environment variables (без значений секретов), migration order, backup/restore, monitoring, incident response, rollback, support matrix.

### Критерии закрытия

- [ ] Каждый open PR имеет актуальный статус и явное решение.
- [ ] Нет незадокументированных уникальных изменений в ветках, которые планируется закрыть/удалить.
- [ ] Все необходимые Beta 1.0 изменения находятся в последовательных проверенных PR.
- [ ] Continuity docs отражают реальный HEAD и последний exact-head CI.
- [ ] WBS v1.1 сохранена, прогресс пересчитан по evidence.
- [ ] Следующий инженер может начать работу по NEXT-SESSION без устных пояснений.

## 8. Очерёдность и контрольные ворота

| Gate | Зависимости | Результат, необходимый для перехода |
|---|---|---|
| G0 — CI baseline | нет | окончательный post-merge Flutter результат и baseline SHA |
| G1 — native UI | G0 | production Dart UI + screen/reference inventory |
| G2 — MLS | G0, G1 частично | secure FFI/storage/session/message/attachment/revocation |
| G3 — API vertical slices | G1, G2 для chat/files | все Beta 1.0 actions mapped и integration-tested |
| G4 — email | backend + staging | фактическая mailbox delivery для каждого event |
| G5 — physical-device E2E | G1–G4 | Android/iOS + two-device acceptance |
| G6 — repository/docs/release | G0–G5 | clean branch map, WBS, runbooks, owner sign-off |

Работы G1/G2/G3/G4 могут идти параллельно в отдельных ветках после G0 baseline, но интеграция и приёмка должны следовать зависимостям. Не включать MLS production flag до G2; не объявлять Beta 1.0 готовой до G5 и G6.

## 9. Evidence ledger — обязательный формат

Для каждого критерия вести запись:

| Поле | Значение |
|---|---|
| Checklist ID | например `MLS-C-04` |
| Status | NOT STARTED / IN PROGRESS / BLOCKED / PASS / FAIL / OWNER ACCEPTED |
| Commit SHA | полный SHA, не branch name |
| Environment | runner/OS/device/backend |
| Command / Scenario | точная команда или шаги сценария |
| Result | фактический результат и число тестов |
| Evidence | workflow/job/artifact/log URL |
| Defects | issue/PR ссылки |
| Verified by / date | исполнитель и дата |
| Owner acceptance | требуется/не требуется; кто и когда принял |

Статусы `PASS` и `OWNER ACCEPTED` не взаимозаменяемы. Для device/email acceptance указывать реальное устройство/mailbox evidence. Процент по WBS обновлять только после закрытия конкретных критериев и сохранять предыдущие значения как историю.

## 10. Итоговый release acceptance

- [ ] G0–G6 закрыты.
- [ ] Все required CI checks PASS на release-candidate SHA.
- [ ] Все P0/P1 defects закрыты.
- [ ] Native Dart UI — production runtime.
- [ ] API screen-action matrix полностью закрыта.
- [ ] MLS secure pipeline и encrypted attachments приняты.
- [ ] Email delivery подтверждена фактическим получением писем.
- [ ] Android/iOS и two-device E2E приняты.
- [ ] Backup/restore, migrations, monitoring, rollback и support runbooks проверены.
- [ ] WBS v1.1 и итоговая оценка обновлены с evidence.
- [ ] Владелец явно подтвердил Beta 1.0 acceptance для exact release-candidate SHA.

**До выполнения всех применимых критериев статус продукта остаётся: IN DEVELOPMENT / NOT ACCEPTED FOR BETA 1.0.**
