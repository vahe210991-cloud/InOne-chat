# Beta 1.0 — этап Email Delivery и подготовка безопасной интеграции в main

**Дата актуализации:** 2026-11-18  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Рабочая ветка:** `feature/email-delivery-service-2026-11-16-b1`  
**PR реализации:** [#61](https://github.com/vahe210991-cloud/InOne-chat/pull/61)  
**Проверенный HEAD реализации:** `72560086aa91944b28a3820237aa6893d1c06b9b`  
**PR документации:** [#77](https://github.com/vahe210991-cloud/InOne-chat/pull/77)

## 1. Решение владельца и границы текущего этапа

Владелец подтвердил, что для Beta 1.0 допустим локальный запуск Backend на Windows-компьютере. Публичный HTTPS Backend и публичный домен пока не настроены. Локальный запуск сервера и тестирование на iPhone отложены до завершения текущего этапа.

Текущая цель — проверить состав выбранной ветки, историю, код, миграции, безопасность и CI, подготовить интеграцию в `main` с сохранением истории. Отложенные испытания на локальном Backend и iPhone не должны выдаваться за пройденные.

## 2. Подтверждённое SMTP/Brevo свидетельство

Локальный SMTP-тест владельца завершился:
- `SEND=PASS`
- `ELAPSED_MS=1019`
- `MESSAGE_ID=<024d4343-cca0-21c6-9a41-f0ff6c399e8a@gmail.com>`
- SMTP host `smtp-relay.brevo.com`, port `587`
- STARTTLS, Nodemailer `secure: false`, `requireTLS: true`, минимум TLS 1.2.

Тест выполнялся временным Node.js-скриптом на Windows, после выполнения скрипт удалён. Это подтверждает успешную передачу тестового сообщения напрямую из Node.js через Brevo. Это НЕ доказывает отправку через InOne Backend API, сквозную регистрацию/восстановление, конечную доставку по полной трассировке, SPF/DKIM/DMARC или доступность публичного API. Домен в Message-ID не доказывает последний почтовый hop.

SMTP credentials — секреты: не помещать их в Git, документацию, PR, issue, исходники или CI-логи. Если действующий ключ раскрывался, выполнить ротацию. Указанный владельцем бесплатный лимит 300 писем/сутки — ориентир тарифа, который требуется перепроверить у провайдера перед эксплуатацией.

## 3. Инфраструктурная граница

На момент актуализации:
- публичный HTTPS Backend и домен не настроены;
- GitHub хранит исходный код, но не является запущенным Backend;
- Vercel preview является статическим preview, не Backend API;
- SMTP тест не проходил через InOne API;
- локальный Backend/PostgreSQL и подключение iPhone ещё не запускались в рамках текущего этапа.

## 4. Текущие GitHub refs и история

PR #61:
- base: `feature/beta1-screen-api-integration-2026-11-12`;
- head: `feature/email-delivery-service-2026-11-16-b1`;
- state: open, draft; GitHub сообщил mergeable=true;
- head SHA: `72560086aa91944b28a3820237aa6893d1c06b9b`;
- 264 commits в PR #61, 86 изменённых файлов, +4,114/-639.

Сравнение ветки Email Delivery с `main` на SHA `d9d699f1c7e27107123c8a019a780f7060531a08`:
- статус ahead;
- ahead_by 623, behind_by 0;
- merge base совпадает с main;
- 128 файлов в полном сравнении, +17,743/-584.

623 коммита — это совокупная Beta 1.0 история, а не только Email Delivery. В неё входят backend, Flutter, Rust/OpenMLS MLS runtime, session/recovery, screen/API integration, tests, CI и документация. Историю нельзя переносить cherry-pick/squash выборкой: целевая интеграция должна сохранять граф коммитов обычным merge PR.

PR #48 остаётся открытым промежуточным PR между Stage 4 и Screen/API branch; его не следует отдельно вливать в main поверх уже интегрированной цепочки.

## 5. Объём ветки относительно main

Сравнение содержит изменения в следующих областях:
- Backend engine: Email Delivery/outbox, SMTP adapter, server/store/config, migrations 0029–0031, тесты регистрации и восстановления;
- Rust/OpenMLS: persistent MLS client, consistency/quarantine/outbox/welcome recovery tests;
- Flutter: Rust FFI crate, session bridge, secure storage, locale, API client, recovery deep links и тесты;
- CI: Email Delivery/PostgreSQL, Native MLS, Flutter, OpenMLS/FRB codegen, P0 validation;
- docs: ADR, engineering/operations, continuity и stage reports.

Наличие файлов и тестов не равнозначно подтверждённому runtime acceptance. Каждый workflow и локально не выполненный тест учитывается отдельно.

## 6. CI — точный текущий HEAD

Для `72560086aa91944b28a3820237aa6893d1c06b9b` GitHub вернул четыре завершённых успешных workflow:
1. Email delivery and PostgreSQL validation — run `44230295545`, success.
2. Native MLS client validation — run `44230295517`, success.
3. Validate recovered InOne P0 source — run `44230295509`, success.
4. Flutter mobile validation — run `44230295585`, success.

Старый failure Flutter run `43834981126` относился к более раннему SHA `1bddce2d77477faa0fb804173c97e8b06ad9ae8b`; он не описывает текущий HEAD. В CI анализе приоритет имеет exact SHA. Зелёные workflows подтверждают только команды/сценарии, которые реально входят в их jobs; они не заменяют локальный Backend/iPhone E2E.

## 7. Owner review и незавершённые доказательства

PR #61 остаётся Draft. Его описание содержит owner approval gate для визуального preview email-шаблонов. Preview не считать утверждённым без явного решения владельца. Отдельно следует удостовериться, что все необходимые Node/PostgreSQL/Flutter проверки действительно покрыты зелёными workflows; не заявлять npm audit, полный локальный `npm test`, `npm run test:db`, `flutter test` или `flutter analyze` как отдельно выполненные, если нет соответствующего точного лога.

SPF/DKIM/DMARC, реальная эксплуатационная конфигурация и end-to-end Backend → SMTP → mailbox остаются за границей доступных доказательств. Локальный Backend и iPhone-тестирование отложены по решению владельца.

## 8. Безопасная стратегия интеграции

1. Сохранить исходную feature-ветку и весь commit graph; не делать force push, cherry-pick или squash.
2. Включить этот актуализированный отчёт в feature-ветку.
3. Создать отдельный интеграционный PR из `feature/email-delivery-service-2026-11-16-b1` непосредственно в `main`.
4. Повторно проверить точный PR head, полный diff, миграции и конфликтность; убедиться, что PR включает всю историю Beta 1.0 и не исключает готовые MLS/Flutter/API работы.
5. Проверить все обязательные workflow на точном PR head и изучить фактические jobs/логи, а не только общий статус.
6. Проверить секреты, миграционный порядок/идемпотентность, конфигурацию SMTP и безопасное логирование.
7. Получить необходимые owner approvals. Draft preview шаблонов остаётся явно неутверждённым до отдельного решения.
8. Выполнить merge commit (не squash/rebase), если все обязательные проверки и approvals удовлетворены.
9. После merge проверить SHA `main`, повторный CI и записать merge SHA в continuity-документы.

GitHub `mergeable=true` — только сигнал об отсутствии известного конфликта на момент запроса, не доказательство корректности.

## 9. Критерии готовности к merge

- полный diff относительно актуального main проверен;
- все критичные workflows завершились PASS на точном PR HEAD;
- миграции 0029/0030/0031 и upgrade path проверены;
- нет секретов в изменениях и логах;
- нет открытых блокирующих review threads или необработанных замечаний;
- owner approval по тем частям, которые PR явно помечает как требующие такого approval, получен либо эти части явно исключены/отложены владельцем;
- PR не Draft и GitHub разрешает merge;
- merge выполняется с сохранением истории;
- после merge проверен main.

## 10. Отложенный этап

После интеграции в main отдельным этапом выполнить локальный запуск Backend/PostgreSQL на Windows и сквозные проверки Flutter-клиента на iPhone в доверенной локальной сети. До этого не заявлять, что реальная эксплуатационная готовность подтверждена.

---
Отчёт фиксирует наблюдаемые refs и evidence на дату актуализации. Он не утверждает, что локальный Backend/iPhone E2E завершён или что merge в main уже выполнен.
