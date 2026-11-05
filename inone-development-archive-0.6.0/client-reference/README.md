# @inone/biometric-client

Референсный клиент биометрического подтверждения для InOne и Propo.

Использование:

```js
import { BiometricClient, SoftwareSigner, signingMessage, STATES } from '@inone/biometric-client';
const client = new BiometricClient({ baseUrl, token, deviceId, userId });
await client.enable({ password });          // включить: создать ключ и отправить открытую часть
const g = await client.grant('set-backup-email'); // подтвердить действие биометрией
```

Методы: `enable`, `disable`, `grant`, `approveDevice`, `shouldOffer`, `describe`, `reset`.
Состояния: `off`, `on`, `invalidated`, `unavailable`.

Подробности, тексты и чек-лист: BIOMETRIC_CLIENT_SPEC.md.
В приложении ключ создаёт платформа (Secure Enclave, Android Keystore, Windows Hello); `SoftwareSigner` — только для тестов.
