# Интеграция HTML в Flutter
**Мост:** JavaScriptChannel `InOneBridge` (webview_flutter). Экран шлёт JSON `{type, data}`.
- `navigate` → `{screen:"CH-02"}`: Flutter переходит на экран по id из `screen-manifest.json`.
- `api` → `{call:"POST /login", body:{...}}`: Flutter вызывает репозиторий (не fetch из HTML), ответ возвращает через `runJavaScript("InOne.showError('текст')")` или навигацией.
- Тема: `InOne.setTheme('dark')` или `?theme=dark`.
## Правила
- HTML не хранит токены и не делает HTTP-запросы. Все вызовы идут через репозиторий и typed-клиент.
- Тексты ошибок по кодам берутся из каталога ERROR_TEXT (SCREENS-0.7.1.md, раздел 0).
- Данные на экранах демонстрационные: заменить на данные репозитория через `runJavaScript`.
- Экраны, помеченные G1/G9/G15 в manifest, заблокированы пробелами движка (раздел 13 SCREENS).
- Шрифт Noto Sans подключён с Google Fonts для просмотра; во Flutter положить в `assets/fonts`.
