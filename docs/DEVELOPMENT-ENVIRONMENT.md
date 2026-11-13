# InOne — Development Environment
Дата фиксации: 2026-11-13

## Рабочая директория
C:\InOne

Резервная копия: `C:\Users\я\InOne-chat`

## Операционная система
- Windows 10 Pro 64-bit
- Version 22H2
- Build 19045.6456
- Locale ru-RU

## Git
- Repository: vahe210991-cloud/InOne-chat
- Текущая ветка на момент фиксации: stage0/identity-engineering-readiness-2026-11-13
- Commit на момент фиксации: 03d985d
- Рабочее дерево на момент проверки: чистое

## Node.js
- Node.js: v24.18.0
- npm: 11.16.0

## Flutter и Dart
- Flutter: 3.44.9
- Channel: stable
- SDK: C:\flutter
- Dart: 3.12.2
- DevTools: 2.57.0

## Android
- Android SDK: C:\Android\Sdk
- SDK version: 36.0.0
- Emulator: 37.1.11.0
- Platform: android-37.0
- Build Tools: 36.0.0
- Java: C:\Program Files\Android\Android Studio\jbr\bin\java
- OpenJDK: 25.0.2
- Необходимо принять Android SDK licenses командой: `flutter doctor --android-licenses`

## Доступные устройства
- Windows Desktop
- Google Chrome 156.0.8078.48
- Microsoft Edge 156.0.4314.58
- Android-устройство или запущенный эмулятор на момент проверки не обнаружены

## Docker
- Docker Desktop: 4.81.0
- Docker Engine: 29.6.1
- Docker API: 1.55
- Context: desktop-linux

## Дополнительные инструменты
- Visual Studio Build Tools 2026
- Version: 18.11.4
- Windows SDK: 10.0.26100.0

## Стандартная проверка окружения

Выполнять из PowerShell:

```powershell
cd C:\InOne
git status --short --branch
git branch --show-current
git log -1 --oneline
git diff --check
node --version
npm --version
flutter --version
flutter doctor -v
flutter devices
docker version
```

## Правила работы
1. Все команды проекта выполнять из `C:\InOne`.
2. Не удалять резервную копию без отдельного решения.
3. Не обновлять инструменты без проверки совместимости.
4. Перед изменениями проверять `git status`.
5. Не переключать ветки без предварительной проверки.
6. Не запускать PostgreSQL-тесты без проверки тестовой БД и `DATABASE_URL`.

## Приоритет проекта
- Основная цель: InOne Beta 1.0.
- Регистрация и авторизация Beta 1.0 — локальные.
- InOne Identity — отдельный будущий этап.
- Не интегрировать Identity в Beta 1.0.
- После завершения Beta 1.0 вернуться к развитию InOne Identity.
