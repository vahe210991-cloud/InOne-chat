# InOne UI (Flutter)

Согласованные экраны InOne в виде нативных Flutter-виджетов. Скругление убрано только у фона экрана;
внутренние элементы — как в макете. Зависимостей, кроме Flutter SDK, нет (Dart 3 / Flutter 3.10+).

## Подключение

```dart
MaterialApp(
  theme: InOneTheme.light(),
  darkTheme: InOneTheme.dark(),   // тёмные экраны D02…D50 — это та же вёрстка в тёмной теме
  themeMode: ThemeMode.system,
  home: ...,
);
```

Глобальные состояния (нет сети, техработы, 429) задаются один раз:

```dart
InOneStatusScope(state: InOneScreenState.offline, child: ...)
```

Экраны показывают баннер и блокируют кнопки сами.

## Шрифты

В `pubspec.yaml` добавьте Noto Sans и Noto Sans Armenian (TTF из Google Fonts):

```yaml
flutter:
  fonts:
    - family: NotoSans
      fonts:
        - asset: assets/fonts/NotoSans-Regular.ttf
        - asset: assets/fonts/NotoSans-Medium.ttf
          weight: 500
        - asset: assets/fonts/NotoSans-SemiBold.ttf
          weight: 600
        - asset: assets/fonts/NotoSans-Bold.ttf
          weight: 700
        - asset: assets/fonts/NotoSans-ExtraBold.ttf
          weight: 800
    - family: NotoSansArmenian
      fonts:
        - asset: assets/fonts/NotoSansArmenian-Regular.ttf
        - asset: assets/fonts/NotoSansArmenian-Bold.ttf
          weight: 700
```

## Структура

- `theme/` — токены light/dark (`InOneColors`), `InOneTheme`.
- `state/` — состояния экрана, `InOneFailure`, миксин `InOneActionState`.
- `widgets/` — общие виджеты; `inone_bottom_nav.dart` — нижняя навигация
  **Лента · Звонки · + · Сообщения · Профиль** (`+` — добавить публикацию).
- `models/` — модели представления (без HTTP).
- `screens/` — по одному файлу на экран.
- `demo/` — демо-данные и галерея экранов (только для предпросмотра).

## Контракт экранов

Экраны не знают про HTTP и навигацию. Действия — колбэки `Future<InOneFailure?> Function(...)`
(`null` = успех), переходы — `VoidCallback`/`ValueChanged`. Тексты ошибок приходят из каталога
ERROR_TEXT через `InOneFailure.message`.

## Что учтено из решений по экранам

- SC-01 принят для беты; кнопки Google и Apple — отдельные, с логотипами, под строками формы.
- SC-05 как отдельный экран не создаётся; «Назад» на SC-06 ведёт на SC-01.
- SC-09: блок про сброс ключей — заглушка до утверждения текста (D8), передаётся через `keyResetWarning`.
- Экраны без разделов в нижней навигации (организация, воркспейс, уведомления) показывают её без активного пункта.
- Статус-бар и индикатор жестов из макетов не рисуются: их отдаёт ОС.

## Известные допущения

- Иконки — Material Icons через `InOneIcons`; для кастомного набора замените значения в одном файле.
- Логотип Google — упрощённый (`InOneGoogleLogo`); для публикации в сторах используйте официальный SVG.
- `Icons.apple` требует актуального Flutter SDK.
- Код проверен разбором синтаксиса и перекрёстной проверкой имён/параметров; `flutter analyze` и тесты не запускались.
