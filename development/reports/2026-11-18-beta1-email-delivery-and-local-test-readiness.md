# Beta 1.0 — этап Email Delivery и подготовка локального тестирования

**Дата фиксации:** 2026-11-18  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Рабочая ветка:** `feature/email-delivery-service-2026-11-16-b1`  
**PR:** [#61 — feat(email): build durable Email Delivery service](https://github.com/vahe210991-cloud/InOne-chat/pull/61)  
**Проверенный HEAD:** `1bddce2d77477faa0fb804173c97e8b06ad9ae8b`

## 1. Решение владельца проекта и границы этапа

Владелец подтвердил, что для Beta 1.0 допустим запуск Backend на локальном компьютере. Публичный HTTPS Backend и публичный домен пока не настроены; исходный код Backend хранится в GitHub. Владелец отдельно распорядился отложить настройку локального сервера и тестирование на iPhone до завершения текущего этапа.

Текущий приоритет: завершить проверку выбранной ветки, зафиксировать состояние и результаты в документации, затем выполнить безопасное слияние в `main`. Локальное развёртывание и iPhone-тестирование относятся к следующему этапу.

## 2. Подтверждённое состояние SMTP/Brevo

Получен результат локального SMTP-теста:

- `SEND=PASS`
- `ELAPSED_MS=1019`
- `MESSAGE_ID=<024d4343-cca0-21c6-9a41-f0ff6c399e8a@gmail.com>`
- SMTP host: `smtp-relay.brevo.com`
- Port: `587`
- TLS: STARTTLS; Nodemailer `secure: false`, `requireTLS: true`
- Minimum TLS: `TLSv1.2`
- SMTP authentication прошла успешно.
- Тест был выполнен временным Node.js-скриптом на Windows в `C:\InOne-email-test\inone-development-archive-0.6.0\engine`; скрипт после теста удалён.

Это подтверждает успешную SMTP-передачу тестового сообщения через Brevo. Это **не** подтверждает отправку через Backend API, работу регистрации/восстановления через сервер, доставку в конечный ящик по полной трассировке, SPF/DKIM/DMARC или существование публичного HTTPS API. Значение домена в Message-ID само по себе не доказывает последний почтовый hop.

SMTP credentials являются секретом. Их нельзя помещать в Git, отчёты, issue/PR body, CI-логи или исходный код. Если действующий SMTP key когда-либо публиковался, его следует ротировать. Бесплатный лимит 300 писем/сутки — заявленный владельцем тарифный ориентир; перед production-использованием проверить актуальные условия Brevo.

## 3. Состояние публичной и локальной инфраструктуры

На момент отчёта:

- публичный HTTPS Backend InOne не настроен;
- публичный домен отсутствует;
- GitHub является хранилищем исходного кода, а не постоянно работающим Backend;
- SMTP-тест был прямым подключением Node.js к Brevo, а не запросом к InOne HTTPS API;
- локальный Backend, PostgreSQL и сетевой доступ iPhone ещё не настраивались и не тестировались;
- найденный ранее Vercel preview — статический preview интерфейса, не Backend API.

Для Beta 1.0 согласован локальный вариант: Backend на Windows-компьютере, локальная БД (если требуется по фактической конфигурации), Brevo SMTP, Flutter-клиент на iPhone через доверенную локальную сеть. Развёртывание отложено до следующего этапа. Не считать пример локального IP/порта фактической конфигурацией.

## 4. Состав PR #61

PR #61 имеет заголовок `feat(email): build durable Email Delivery service`. По метаданным GitHub на момент проверки:

- base: `feature/beta1-screen-api-integration-2026-11-12`;
- head: `feature/email-delivery-service-2026-11-16-b1`;
- состояние: open, draft;
- mergeable: true (GitHub metadata);
- 86 изменённых файлов;
- 4,114 добавлений и 639 удалений;
- head SHA: `1bddce2d77477faa0fb804173c97e8b06ad9ae8b`.

Заявленный PR scope включает durable PostgreSQL delivery queue, AES-256-GCM шифрование payload, HKDF-derived keys, HMAC idempotency/fingerprints, per-recipient deliveries, TTL/retries/backoff/dead-letter/retention, 13 шаблонов на hy/ru/en, HTML escaping, безопасные HTTPS recovery links, lifecycle worker/SMTP shutdown, locale persistence и propagation для registration/login/security/recovery flows, миграции 0029/0030 и Flutter locale plumbing. Это описание PR; оно не заменяет независимое runtime acceptance.

PR body прямо отмечает, что визуальный preview шаблонов — черновик и требует одобрения владельца. Также PR body указывает, что на финальном HEAD не запускались JavaScript syntax validation, npm audit, npm test, npm run test:db, flutter test и flutter analyze. Реальная SMTP-доставка и SPF/DKIM/DMARC в рамках этого PR также не выполнялись.

## 5. Проверка CI на точном HEAD

Для SHA `1bddce2d77477faa0fb804173c97e8b06ad9ae8b` GitHub workflow lookup вернул один PR workflow run:

- workflow: `Flutter mobile validation`;
- run ID: `43834981126`;
- run number: `824`;
- conclusion: `failure`.

Combined commit status не вернул дополнительных статусов. Попытка получить job logs завершилась ошибкой GitHub BlobNotFound; список шагов также вернулся пустым. Следовательно, причина failure в рамках доступных данных не установлена. Не следует интерпретировать отсутствие остальных workflow runs как успешное прохождение соответствующих тестов.

## 6. Слияние: статус и блокирующие условия

**Слияние в `main` не выполнено на дату этого отчёта.**

Причины:

1. PR #61 остаётся Draft.
2. На точном HEAD есть зафиксированный failure Flutter validation.
3. Основные Node/PostgreSQL/Flutter проверки в PR body отмечены как NOT RUN.
4. Визуальный preview шаблонов не утверждён владельцем; PR body явно требует owner approval.
5. PR #61 направлен не в `main`, а в `feature/beta1-screen-api-integration-2026-11-12`. GitHub сравнение веток показывает, что feature base и `main` разошлись; перед слиянием требуется проверить целевую историю и состав итогового diff относительно актуального `main`, а не полагаться только на зелёный флаг mergeable.

Флаг GitHub `mergeable: true` означает отсутствие обнаруженного GitHub конфликта слияния на момент ответа API. Он не является подтверждением корректности, полноты тестов или архитектурной готовности.

Не обходить Draft/status protections и не выполнять force-push/force-merge ради формального завершения этапа.

## 7. Следующие действия — в установленном порядке

1. Получить причину Flutter CI failure на SHA `1bddce2d77477faa0fb804173c97e8b06ad9ae8b`; если артефакты недоступны, запустить проверку заново на актуальном HEAD.
2. Выполнить JavaScript syntax validation, `npm test`, `npm run test:db` с PostgreSQL, `npm audit --omit=dev --audit-level=high`, `flutter test`, `flutter analyze` на согласованном окружении.
3. Проверить миграции и upgrade path, shutdown/retry/dead-letter/idempotency, шифрование очереди, locale propagation, безопасное логирование и отсутствие секретов в diff.
4. Получить отдельное решение владельца по визуальному preview email-шаблонов.
5. Перепроверить PR head SHA и сравнение с актуальным `main`; выбрать корректный merge path, сохранить историю и проверить итоговый merge commit.
6. Только после прохождения gates и необходимых approvals выполнить merge в `main`.
7. После фиксации этапа перейти к локальному запуску Backend на Windows и сквозным тестам на iPhone.

## 8. Критерии завершения текущего этапа

Этап считается завершённым только когда:
- все требуемые проверки завершились PASS на точном HEAD;
- все обязательные owner approvals получены;
- diff относительно актуального `main` проверен;
- PR #61 действительно merged в `main`;
- SHA merge commit записан в отчёт и continuity-документы;
- `main` повторно проверен после merge.

До выполнения этих условий статус этапа — **implementation present; acceptance and merge pending**.

## 9. Источники доказательств

- [PR #61](https://github.com/vahe210991-cloud/InOne-chat/pull/61)
- [Точный HEAD](https://github.com/vahe210991-cloud/InOne-chat/commit/1bddce2d77477faa0fb804173c97e8b06ad9ae8b)
- [Flutter validation run #824](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/43834981126)
- [API integration documentation](https://github.com/vahe210991-cloud/InOne-chat/blob/main/mobile/API-INTEGRATION.md)

---
Этот отчёт фиксирует наблюдаемое состояние на момент проверки. Он не заявляет, что тесты пройдены, Backend развёрнут или слияние состоялось.
