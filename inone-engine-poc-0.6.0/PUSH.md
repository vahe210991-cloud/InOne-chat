# Реестр устройств и push-уведомления (пункт 10)

- **Дата:** 2026-10-31 03:07 UTC (Ереван UTC+4).
- **Принцип:** уведомление только говорит «есть новое сообщение» и даёт путь для перехода. Текста, имени отправителя и содержимого в нём нет.

## Маршруты
- `GET /devices/mine` — устройства аккаунта: `deviceId`, `label`, `revoked`, `pushRegistered`. Токенов в ответе нет.
- `PUT /devices/me/push` с `{ "provider": "fcm" | "apns", "token": "..." }` — регистрация идентификатора этого устройства (один идентификатор на устройство, новый заменяет старый). Для `fcm` принимается Firebase Installation ID (FID, 22 символа base64url) или legacy FCM token; для `apns` — APNs token (32–512 символов).
- `DELETE /devices/me/push` — снять токен.

## Когда токен удаляется
- При отзыве устройства (ручном, при восстановлении аккаунта, при повторном использовании токена обновления).
- При выходе (`POST /logout`).
- Когда провайдер отвечает, что токен недействителен.

## Кому и что уходит
- После сообщения в комнате уведомление получают устройства участников комнаты, кроме устройства отправителя. Отозванные и вышедшие устройства не получают. Чужие комнаты не получают.
- Содержимое уведомления: `{ "type": "message", "path": "/rooms/<комната>/events/<событие>" }`. Тест проверяет, что других полей нет.
- Путь нужен клиенту для перехода (deep link). Идентификаторы комнаты и события — метаданные: политику по ним решает владелец.

## Состояние клиента и что остаётся
- Flutter runtime подключён к Firebase Core/Messaging 17: после авторизации и разрешения уведомлений получает FID через `register()` / `onRegistered`, синхронизирует его через аутентифицированный `PUT /devices/me/push`, снимает серверную регистрацию и вызывает `unregister()` до logout. Для iOS FID регистрируется только после готовности APNs token.
- Для iOS реальная регистрация APNs требует включённого Push Notifications capability в Apple Developer App ID и загруженного APNs authentication key в Firebase Console. Эти внешние настройки не могут быть созданы из исходников.

## Что не сделано
1. Реальный отправитель FCM и APNs не подключён. Пока отправитель не задан, уведомления не уходят. Это отдельная серверная интеграция с Firebase/Apple credentials.
2. Токены в базе хранятся открытым текстом. Шифрование полей — открыто: решение о ключе вместе с шифрованием базы.
3. Ограничение частоты уведомлений и группировка — не сделаны.
4. Обработка перехода по пути из push payload в конкретный экран пока не подключена.

## Тесты
`test/push.test.js`: 4 теста в памяти и на PostgreSQL. Поломки: отозванное устройство получает уведомления; уведомление содержит лишнее поле; выход не удаляет токен. Каждая ловится тестом.


## Firebase Messaging 17 FID registration

The Flutter client disables Firebase Messaging auto-init until an authenticated InOne session and notification permission exist. It then calls `FirebaseMessaging.register()` and sends the 22-character Firebase Installation ID from `onRegistered` through `PUT /devices/me/push`. The API accepts this FID for provider `fcm` while preserving legacy 32–512-character FCM/APNs token compatibility. Logout and denied notification permission remove the server association and call Firebase Messaging `unregister()`. The future sender must address FIDs using the Firebase FID-capable direct-send API; notification delivery remains unimplemented.
