# InOne — тестовая среда GitHub Codespaces

## Назначение

Эта конфигурация поднимает изолированную среду разработки для InOne:

- Node.js 24.7+;
- Flutter 3.47.9 stable и соответствующий Dart SDK;
- PostgreSQL 16;
- отдельная база `inone_dev`;
- API на порту 8080;
- автоматический запуск backend после старта Codespace;
- автоматические миграции при старте сервера.

Это среда разработки и QA, не production и не публичный хостинг.

## Создание Codespace

1. Откройте репозиторий `vahe210991-cloud/InOne-chat`.
2. Выберите ветку `feat/beta1-full-screen-api-harness`.
3. Нажмите **Code → Codespaces → Create codespace on ...**.
4. Дождитесь завершения создания контейнеров и установки npm-зависимостей.
5. Конфигурация запустит API автоматически.

Не создавайте Codespace на основной ветке для этой работы: настройки находятся в ветке разработки.

### Flutter и Dart

Flutter 3.47.9 stable устанавливается в образ Codespaces из официального Linux SDK-архива с проверкой SHA-256. `FLUTTER_HOME/bin` добавлен в системный `PATH`, поэтому доступны обе команды:

```sh
flutter --version
dart --version
cd mobile
flutter pub get
flutter analyze
flutter test
```

Для существующего Codespace после изменения `.devcontainer/Dockerfile` выберите **Codespaces: Rebuild Container**. Установка выполняется при сборке образа, а не при каждом открытии терминала. CI использует тот же Flutter stable release.

Для локальной сборки Android APK дополнительно нужны JDK 17 и Android SDK с установленной платформой/Build Tools; примите лицензии через `flutter doctor --android-licenses`. Они не устанавливаются в базовый образ автоматически. CI генерирует platform-проекты и выполняет debug APK build на runner с Android tooling.

В репозитории Android platform-проект не хранится. После установки Android tooling создайте его тем же способом, что и CI, и соберите debug APK:

```sh
cd mobile
flutter create --platforms=android --project-name inone_mobile --org com.inone .
flutter build apk --debug
```

## Проверка API

В терминале Codespaces выполните:

```sh
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/readyz
```

Ожидаемый ответ health check:

```json
{"status":"ok"}
```

Логи backend:

```sh
tail -f /tmp/inone-backend.log
```

Перезапуск backend:

```sh
cd /workspace/inone-engine-poc-0.6.0
pkill -f 'node src/main.js' || true
npm start
```

## Тестовая регистрация

В этой среде задан фиксированный код подтверждения почты `000000`. Он предназначен только для разработки и разрешён сервером только при `NODE_ENV=development`.

Для создания тестовой учётной записи владельца:

```sh
cd /workspace/inone-engine-poc-0.6.0
INONE_DEV_EMAIL_CODE=000000 node scripts/dev-create-account.mjs http://127.0.0.1:8080 owner@example.test owner 'Replace-this-test-password'
```

Используйте только вымышленные тестовые данные. Не используйте реальные пароли или личные почтовые адреса.

## PostgreSQL

Backend подключается к PostgreSQL по внутреннему Compose-имени `db:5432` и базе `inone_dev`; порт базы не публикуется на хост и не форвардится в Codespaces. Отдельный именованный Docker volume хранит данные только для этой Compose-среды; данные переживают перезапуск Codespace, пока сам Codespace и его volume существуют. Автозапуск backend проверяет соединение с этой development-базой до запуска.

Для полного сброса тестовой базы из корня репозитория:

```sh
docker compose -f .devcontainer/docker-compose.yml down -v
```

Команда удаляет тестовую базу и все данные в её volume. После этого пересоздайте контейнеры Codespace.

## Доступ к порту

Порт 8080 настроен как **private** в Codespaces. Не меняйте его на public для обычной работы.

Внутри Codespace API доступен как `http://127.0.0.1:8080`. Для Flutter, запущенного вне Codespace, потребуется отдельная настройка маршрута к forwarded port. Не используйте локальные адреса `127.0.0.1` или `10.0.2.2` для Codespaces: они относятся к локальному компьютеру/эмулятору, а не к контейнеру Codespace.

Перед подключением мобильного клиента через внешний forwarded URL нужно отдельно проверить, как клиент проходит авторизацию доступа к private port. Не публикуйте порт без отдельного решения по безопасности.

## Ограничения

- Фиксированный email-код и тестовая база допустимы только в этой среде.
- SMTP и SMS не настроены; письма не отправляются наружу.
- Тестовая конфигурация не подтверждает production-готовность сервера.
- Наличие маршрута в каталоге Flutter ещё не означает, что экран прошёл интеграционный тест. Подключение засчитывается после запроса с авторизацией и проверки ожидаемой структуры ответа.
