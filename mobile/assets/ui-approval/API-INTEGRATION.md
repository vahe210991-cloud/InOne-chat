# Интеграция HTML-экранов во Flutter (партия 1: регистрация и вход)
Экраны — самостоятельные .html на весь дисплей (прямоугольник, без рамки и скруглений): один и тот же файл для iOS и Android. Фон красится на `html` и `body`, поэтому полос по краям нет на любом соотношении сторон.

## Загрузка
```dart
final c = WebViewController()
  ..setJavaScriptMode(JavaScriptMode.unrestricted)
  ..setBackgroundColor(themeBg) // цвет --bg текущей темы: нет белой вспышки
  ..addJavaScriptChannel('InOneBridge', onMessageReceived: (m) => handle(jsonDecode(m.message)))
  ..setNavigationDelegate(NavigationDelegate(onPageFinished: (_) => c.runJavaScript(
      "InOne.setThemeMode('$mode');InOne.setInsets($top,$bottom)")))
  ..loadFlutterAsset('assets/ui/screens/auth/SC-01.html');
```
- Во Flutter `assets:` в pubspec не рекурсивны: перечислить каждую папку (`assets/ui/`, `assets/ui/assets/fonts/`, `assets/ui/screens/auth/` …).
- Экраны подключают `../../design-tokens.v2.css` и `../../interactions.v2.js`. Не проверено на iOS: WKWebView может ограничить чтение родительских папок. Если ресурсы не загрузятся — собрать самодостаточные файлы (CSS/JS/шрифты внутрь).

## Тема
Настройка приложения: тёмная | светлая | автоматическая. Хост вызывает `InOne.setThemeMode('dark'|'light'|'auto')`. `auto` = системная тема (`prefers-color-scheme`). Своего переключателя на экранах нет.

## Safe area
`InOne.setInsets(top, bottom)` в логических пикселях (`MediaQuery.padding`), вызывать после загрузки и при повороте. Без вызова используется `env(safe-area-inset-*)`. Системные строки рисует ОС; экран их не рисует. Элементы не стоят в углах (боковые поля 20px).

## События экран → Flutter (`InOneBridge`, JSON)
- `{type:'navigate', screen:'SC-02'}`; `screen:'back'` — вернуться.
- `{type:'api', screen:'SC-01', data:{call:'POST /login', body:{email,password}}}` — запрос выполняет репозиторий, HTML сам ничего не отправляет.
- `{type:'pick', data:{what:'document'}}` — открыть выбор файла (RQ-02); имя файла вернуть `InOne.setData({fileName:'…'})`.
Секреты (пароль, PIN, код) приходят только в `body`; не логировать и не сохранять.

## Flutter → экран
- `InOne.setState(name, text?)`: `default | loading | error | offline | maintenance | unavailable | rate` и состояния конкретных экранов (`waiting`, `sent`, `admin`, `owner`, `empty`, `found`, `notfound`, `on`, `test`; см. `states` в `screen-manifest.json`). Для `error` передать текст по коду из ERROR_TEXT. Кнопки записи блокируются в `loading/waiting/offline/maintenance/unavailable/rate`.
- `InOne.setData({activateAt:'14:30'})` — подстановка значений (SC-11).

## Утверждённые экраны v1 (chat, rooms, organizations, profile)
Это утверждённые экраны; их файлы кладёт владелец, генератор их не трогает. Подключают `../../design-tokens.css` и `../../interactions.js` (v1, оригинальные имена). API хоста у v1 другой: `InOne.setTheme('dark'|'light')`, `InOne.showError(text)`; события моста `navigate`/`api` те же, но без поля `screen`. В v1 есть рамка телефона 390×844 (скругление 36px) и переключатель темы на самом экране: для Android и темы из настроек нужны прямоугольные копии отдельными файлами, оригиналы не трогаются. Прежняя инструкция: `API-INTEGRATION-v1.md`.

## Что ещё не решено (см. `screen-manifest.json`, поле `req`)
D8 — текст предупреждения о сбросе ключей (SC-09, сейчас помечено место); G13 — формат ответов входа и регистрации (телефон при регистрации обязателен, без SMS-подтверждения: решение владельца); D4/D7 — вход через провайдера; D5, D6, D11.
Тексты ошибок в превью — заглушка: каталог ERROR_TEXT (client-screens/common/api.mjs) не передавался.
