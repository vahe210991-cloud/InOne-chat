# InOne — постоянная точка продолжения

**Обновлено:** 2026-11-19 15:00 (UTC+3)  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Основная ветка документации:** `main`

Эта папка — обязательная стартовая точка для любого следующего чата/исполнителя. Она нужна, чтобы продолжение проекта не зависело от памяти модели, предыдущего диалога или устных пересказов.

## Читать в таком порядке

1. [CURRENT-STATE.md](CURRENT-STATE.md) — фактическое состояние проекта, GitHub и текущие блокеры.
2. [NEXT-SESSION.md](NEXT-SESSION.md) — точные инструкции следующему исполнителю: что проверить и с чего продолжить.
3. [DECISIONS.md](DECISIONS.md) — подтверждённые продуктовые и архитектурные решения владельца.
4. [SOURCE-OF-TRUTH.md](SOURCE-OF-TRUTH.md) — где находятся исходники, архивы, патчи, дизайн-система и какие источники нельзя путать.

## Правила ведения

- После каждого существенного изменения обновлять CURRENT-STATE.md и добавлять запись в журнал ниже.
- После каждого завершённого этапа сохранять commit SHA, ветку, PR, ссылки на Actions и фактические результаты тестов.
- Не писать «тесты пройдены», если тесты не запускались. Использовать статусы PASS / FAIL / BLOCKED / NOT RUN.
- Не считать архивный CI 0.6.0 проверкой актуального P0 или Beta 1.0.
- Не переписывать историю и не force-push без отдельного технического обоснования.
- Не выполнять merge, пока обязательные проверки не прошли на том SHA, который будет влиться.
- Не удалять и не заменять исходный дизайн-системный файл по догадке. Точные исходники и принятые решения сохранять.

## Актуальный P0 handoff

Перед продолжением P0 обязательно прочитать [последний GitHub recovery status](../../development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md). Он содержит точный опубликованный SHA, фактические результаты CI, source-integrity blockers и следующие действия. Старые записи ниже сохраняются как история и могут быть superseded более свежими разделами CURRENT-STATE/NEXT-SESSION.

## Журнал обновлений

| Время (UTC+3) | Изменение |
|---|---|
| 2026-11-08 08:25 | Создана постоянная папка continuity; зафиксированы состояние проекта, решения, источники и handoff-инструкции. |
| 2026-11-08 12:00 | Добавлен P0 GitHub recovery status: branch `recovery/p0-wave3-applied`, SHA `7ebdeac`; функциональные suites PASS, rustfmt FAIL, source-integrity audit остаётся открытым. |
| 2026-11-19 15:00 | Добавлен A2 FRB reconciliation audit: Rust API inventory, generated-output gap, lockfile/workflow findings, параллельные PR #90/#94 и точные следующие действия. |


## Owner-approved cumulative baseline — 2026-11-09

The owner approved the WBS and release split. All future agents/chats MUST read [development/PROGRESS-BASELINE.md](../../development/PROGRESS-BASELINE.md) before work. Baseline: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%; historical InOne overall 25% retained. Scope, weights and percentages are not to be changed without explicit owner approval and a versioned baseline update. Every work item/report must map to the WBS. Current UI integration stage report: [2026-11-09 UI integration](../../development/reports/2026-11-09-1015-ui-integration-start.md).
