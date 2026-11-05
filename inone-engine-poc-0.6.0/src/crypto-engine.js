// ============================================================================
// ВРЕМЕННЫЙ ДВИЖОК ШИФРОВАНИЯ (вариант A, решение заказчика).
//
// Это НЕ финальный движок. Он будет заменён на собственный (вариант B)
// после обкатки в бета-версии Propo. Все остальные модули работают только
// с этим файлом, поэтому замена затронет один модуль.
//
// Что внутри: официальная сборка matrix-sdk-crypto-wasm (движок Element),
// Olm для передачи ключей и Megolm для шифрования сообщений.
// ============================================================================
import * as sdk from '@matrix-org/matrix-sdk-crypto-wasm';

const {
  OlmMachine, UserId, DeviceId, RoomId, DeviceLists, DecryptionSettings,
  EncryptionSettings, EncryptionAlgorithm, CollectStrategy, TrustRequirement, RequestType,
} = sdk;

export { RequestType };

export class TemporaryMatrixEngine {
  /** Создаёт криптографическое устройство (ключи создаются здесь, на клиенте). */
  static async create(userId, deviceId) {
    const machine = await OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId));
    return new TemporaryMatrixEngine(machine);
  }

  constructor(machine) {
    this.machine = machine;
  }

  /** Запросы, которые нужно отправить на сервер (загрузка ключей, поиск ключей, рассылка). */
  outgoingRequests() {
    return this.machine.outgoingRequests();
  }

  /** Сообщает движку, что запрос отправлен и какой ответ пришёл. */
  markRequestAsSent(id, type, responseJson) {
    return this.machine.markRequestAsSent(id, type, responseJson);
  }

  /** Указывает, чьи ключи движку нужно отслеживать. */
  updateTrackedUsers(userIds) {
    return this.machine.updateTrackedUsers(userIds.map((u) => new UserId(u)));
  }

  /** Возвращает запрос на получение сессий, которых ещё нет (или null). */
  getMissingSessions(userIds) {
    return this.machine.getMissingSessions(userIds.map((u) => new UserId(u)));
  }

  /** Создаёт ключ беседы и возвращает запросы на его отправку получателям. */
  shareRoomKey(roomId, userIds) {
    const settings = new EncryptionSettings();
    settings.algorithm = EncryptionAlgorithm.MegolmV1AesSha2;
    settings.sharingStrategy = CollectStrategy.allDevices();
    return this.machine.shareRoomKey(new RoomId(roomId), userIds.map((u) => new UserId(u)), settings);
  }

  /** Сбрасывает свой ключ беседы: следующее сообщение пойдёт под новым ключом. */
  invalidateGroupSession(roomId) {
    return this.machine.invalidateGroupSession(new RoomId(roomId));
  }

  /** Шифрует событие беседы. Возвращает JSON содержимого для m.room.encrypted. */
  encryptRoomEvent(roomId, type, contentJson) {
    return this.machine.encryptRoomEvent(new RoomId(roomId), type, contentJson);
  }

  /**
   * Принимает события доставки (ключи бесед и т. п.).
   * counts — остаток одноразовых ключей, changed — собеседники, у которых изменились устройства.
   */
  receiveSyncChanges(toDeviceEventsJson, counts, changed = []) {
    return this.machine.receiveSyncChanges(
      toDeviceEventsJson,
      new DeviceLists(changed.map((u) => new UserId(u)), []),
      new Map(Object.entries(counts)),
      undefined,
      new DecryptionSettings(TrustRequirement.Untrusted),
    );
  }

  /** Расшифровывает событие беседы. Бросает ошибку, если ключа нет. */
  decryptRoomEvent(eventJson, roomId) {
    return this.machine.decryptRoomEvent(eventJson, new RoomId(roomId), new DecryptionSettings(TrustRequirement.Untrusted));
  }

  close() {
    this.machine.close();
  }
}
