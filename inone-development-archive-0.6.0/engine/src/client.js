import { randomBytes } from 'node:crypto';
// ============================================================================
// Клиент. Работает с сервером по HTTP и с движком только через crypto-engine.js.
// ============================================================================
import { buildPrivateMessageHeader, privateMessagePayload } from './mls-wire.js';
import { TemporaryMatrixEngine, RequestType } from './crypto-engine.js';

// Пароль, которым тесты создают аккаунты. В приложении пароль выбирает пользователь.
export const DEFAULT_PASSWORD = randomBytes(24).toString('hex'); // случайный пароль на запуск, в коде секретов нет
const enc = encodeURIComponent;

export class ChatClient {
  constructor(baseUrl, userId, deviceId, engine) {
    this.baseUrl = baseUrl;
    this.userId = userId;
    this.deviceId = deviceId;
    this.engine = engine;
    this.token = null;
    this.refreshToken = null;
    this.password = null;
    this.recoveryPin = null;
    this.syncSince = 0;             // номер последнего обработанного события доставки (подтверждаем серверу, C-05)
    this.failedEvents = [];         // события доставки, которые движок не смог обработать (видны пользователю)
    this.signalSince = 0;           // номер последнего обработанного сигнала (подтверждаем серверу, C-20)
    this.sharedRooms = new Set();   // беседы, в которых у нас уже есть свой ключ отправителя
    this.roomMembers = new Map();   // беседа -> участники, как мы их знаем
    this.alerts = [];               // уведомления безопасности, пришедшие с сервера
  }

  /** Регистрирует аккаунт (если его ещё нет) и входит с этим устройством. */
  static async create(baseUrl, userId, deviceId, password = DEFAULT_PASSWORD, extra = {}) {
    const engine = await TemporaryMatrixEngine.create(userId, deviceId);
    const client = new ChatClient(baseUrl, userId, deviceId, engine);
    const pin = extra.pin ?? '80421697';
    const pinConfirmation = extra.pinConfirmation ?? pin;
    const phone = extra.phone ?? `+37477${String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0')}`;
    try {
      await client.raw('POST', '/register', {
        userId, password, phone, pin, pinConfirmation, ...extra,
      });
    } catch (e) {
      if (e.status !== 409) throw e;
    }
    const session = await client.raw('POST', '/login', { userId, password, deviceId });
    client.token = session.token;
    client.refreshToken = session.refreshToken;
    client.password = password;
    client.recoveryPin = pin;
    return client;
  }

  /** Вход на существующий аккаунт с устройства, которое уже подключено. */
  static async login(baseUrl, userId, password, deviceId, extra = {}) {
    const engine = await TemporaryMatrixEngine.create(userId, deviceId);
    const client = new ChatClient(baseUrl, userId, deviceId, engine);
    const session = await client.raw('POST', '/login', { userId, password, deviceId, ...extra });
    client.token = session.token;
    client.refreshToken = session.refreshToken;
    client.password = password;
    return client;
  }

  /**
   * Вход с нового устройства. Если в аккаунте уже есть устройства, сервер просит код
   * с одного из них: approver (клиент существующего устройства) вводит его.
   */
  static async loginFromNewDevice(baseUrl, userId, password, deviceId, approver) {
    const engine = await TemporaryMatrixEngine.create(userId, deviceId);
    const client = new ChatClient(baseUrl, userId, deviceId, engine);
    const res = await client.raw('POST', '/login', { userId, password, deviceId, label: deviceId, platform: 'test' });
    if (res.token) {
      client.token = res.token;
      client.refreshToken = res.refreshToken;
      client.password = password;
      return client;
    }
    await approver.approveDevice(res.approvalId, res.code);
    for (let i = 0; i < 5; i++) {
      const claim = await client.raw('POST', `/approvals/${res.approvalId}/claim`, { pollSecret: res.pollSecret });
      if (claim.status === 'approved') {
        client.token = claim.token;
        client.refreshToken = claim.refreshToken;
        client.password = password;
        return client;
      }
      if (claim.status !== 'pending') throw new Error(`вход отклонён: ${claim.status}`);
    }
    throw new Error('подтверждение входа не пришло');
  }

  async approveDevice(approvalId, code) {
    return this.raw('POST', `/approvals/${enc(approvalId)}/approve`, { code });
  }

  async denyDevice(approvalId) {
    return this.raw('POST', `/approvals/${enc(approvalId)}/deny`);
  }

  async listApprovals() {
    return (await this.raw('GET', '/approvals')).approvals;
  }

  async setPin(pin, currentPin) {
    return this.raw('POST', '/pin/set', { pin, currentPin });
  }

  async removePin(currentPin) {
    return this.raw('POST', '/pin/remove', { currentPin });
  }

  async refreshSession() {
    const r = await this.raw('POST', '/token/refresh', { refreshToken: this.refreshToken });
    this.token = r.token;
    this.refreshToken = r.refreshToken;
  }

  /** Сессия: обновить по токену обновления; если он истёк или неизвестен, войти снова паролем. Повтор токена не чинится молча. */
  async renewSession() {
    try {
      await this.refreshSession();
    } catch (e) {
      if (e.status !== 401 || !/refresh_(expired|unknown)/.test(e.message) || this.password === null) throw e;
      const s = await this.raw('POST', '/login', { userId: this.userId, password: this.password, deviceId: this.deviceId });
      this.token = s.token;
      this.refreshToken = s.refreshToken;
    }
  }

  async raw(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token ?? ''}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok && res.status === 401 && this.refreshToken && text.includes('token_expired') && path !== '/token/refresh' && path !== '/login') {
      await this.renewSession();
      return this.raw(method, path, body);
    }
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status} ${text}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  /** Отправляет один запрос движка на сервер и сообщает движку об ответе. */
  async sendRequest(r) {
    switch (r.type) {
      case RequestType.KeysUpload: {
        const res = await this.raw('POST', '/keys/upload', JSON.parse(r.body));
        return this.engine.markRequestAsSent(r.id, r.type, JSON.stringify(res));
      }
      case RequestType.KeysQuery: {
        const res = await this.raw('POST', '/keys/query', JSON.parse(r.body));
        return this.engine.markRequestAsSent(r.id, r.type, JSON.stringify(res));
      }
      case RequestType.KeysClaim: {
        const res = await this.raw('POST', '/keys/claim', JSON.parse(r.body));
        return this.engine.markRequestAsSent(r.id, r.type, JSON.stringify(res));
      }
      case RequestType.ToDevice: {
        await this.raw('PUT', `/sendToDevice/${enc(r.event_type)}/${enc(r.txn_id)}`, JSON.parse(r.body));
        return this.engine.markRequestAsSent(r.id, r.type, '{}');
      }
      default:
        // Неизвестный тип запроса не отправляем молча: это ошибка, а не пропуск.
        throw new Error(`неизвестный тип запроса движка: ${r.type}`);
    }
  }

  async drainOutgoing({ tolerateRestricted = false } = {}) {
    for (let i = 0; i < 20; i++) {
      const reqs = await this.engine.outgoingRequests();
      if (reqs.length === 0) return;
      for (const r of reqs) {
        try {
          await this.sendRequest(r);
        } catch (e) {
          // Окно восстановления (D5, D8): запрос отклонён. Он остаётся в очереди, чтение продолжается.
          if (tolerateRestricted && e.status === 403 && /restricted/.test(e.message)) return;
          throw e;
        }
      }
    }
    throw new Error('движок не успокоился за 20 шагов');
  }

  async publishKeys() {
    await this.drainOutgoing();
  }

  async addPeers(userIds) {
    await this.engine.updateTrackedUsers(userIds);
    await this.drainOutgoing();
  }

  async establishSessions(userIds) {
    const claim = await this.engine.getMissingSessions(userIds);
    if (claim) await this.sendRequest(claim);
  }

  /** Передаёт текущий ключ отправителя участникам (через зашифрованный канал доставки). */
  async shareRoomKey(roomId, userIds) {
    const reqs = await this.engine.shareRoomKey(roomId, userIds);
    for (const r of reqs) await this.sendRequest(r);
    await this.drainOutgoing();
    this.sharedRooms.add(roomId);
    this.roomMembers.set(roomId, [...userIds]);
  }

  /** Меняет свой ключ в беседе: старые участники больше не получат новых сообщений. */
  async rotateRoom(roomId, members) {
    await this.addPeers(members);
    await this.establishSessions(members.filter((m) => m !== this.userId));
    await this.engine.invalidateGroupSession(roomId);
    this.sharedRooms.delete(roomId);
    await this.shareRoomKey(roomId, members);
  }

  /** Создаёт беседу. Создатель становится владельцем. */
  async createRoom(roomId, members) {
    return this.raw('POST', '/rooms', { roomId, members });
  }

  /** Владелец назначает роль: 'admin' или 'member'. Состав беседы при этом не меняется. */
  async setRole(roomId, userId, role) {
    return this.raw('POST', `/rooms/${enc(roomId)}/roles`, { userId, role });
  }

  /** Состав беседы: владелец, администраторы, участники. */
  async listMembers(roomId) {
    return this.raw('GET', `/rooms/${enc(roomId)}/members`);
  }

  /** Владелец добавляет участника. Текущий ключ отправителя получает новичок, историю — нет. */
  async addMember(roomId, userId) {
    await this.raw('POST', `/rooms/${enc(roomId)}/members`, { userId });
    await this.applyMembership(roomId);
  }

  /** Удаляет участника (владелец) или выходит сам (участник). После удаления ключи меняются. */
  async removeMember(roomId, userId) {
    await this.raw('DELETE', `/rooms/${enc(roomId)}/members/${enc(userId)}`);
    await this.applyMembership(roomId);
  }

  /**
   * Сверяет состав беседы с сервером и делает нужное:
   *  - кто-то удалён: меняем свой ключ, чтобы удалённый не читал новые сообщения;
   *  - кто-то добавлен: передаём ему текущий ключ (без истории);
   *  - мы сами больше не участники: забываем беседу.
   */
  async applyMembership(roomId) {
    let current;
    try {
      current = (await this.raw('GET', `/rooms/${enc(roomId)}/members`)).members;
    } catch (e) {
      if (e.status !== 403) throw e;
      current = [];
    }
    if (!current.includes(this.userId)) {
      this.roomMembers.delete(roomId);
      this.sharedRooms.delete(roomId);
      return;
    }
    const before = this.roomMembers.get(roomId) ?? [];
    const removed = before.filter((m) => !current.includes(m));
    const added = current.filter((m) => !before.includes(m));
    this.roomMembers.set(roomId, [...current]);
    if (!this.sharedRooms.has(roomId)) return; // своего ключа в этой беседе ещё нет
    if (removed.length > 0) {
      await this.rotateRoom(roomId, current);
    } else if (added.length > 0) {
      await this.addPeers(current);
      await this.establishSessions(current.filter((m) => m !== this.userId));
      await this.shareRoomKey(roomId, current);
    }
  }

  /**
   * Забирает сигналы и события доставки и обрабатывает их.
   * Сигналы (состав устройств, беседы, уведомления безопасности) подтверждаются одним номером
   * после обработки всей пачки; события доставки — по одному, каждое после обработки (C-05, C-20).
   */
  async sync() {
    const r = await this.raw('GET', `/sync?since=${this.syncSince}&signal_since=${this.signalSince}`);
    const signals = r.signals.items;
    const changed = [...new Set(signals.filter((s) => s.stream === 'device_list').map((s) => s.userId))];
    // Состав устройств обновляем до событий: по нему движок проверяет ключи отправителей.
    await this.engine.receiveSyncChanges('[]', r.device_one_time_keys_count, changed);
    for (const s of signals) {
      if (s.stream === 'room') await this.applyMembership(s.roomId);
    }
    const changedSet = new Set(changed);
    for (const [roomId, members] of [...this.roomMembers]) {
      if (this.sharedRooms.has(roomId) && members.some((m) => changedSet.has(m))) {
        await this.rotateRoom(roomId, members);
      }
    }
    // Уведомления добавляем последними: если пачка оборвётся раньше, она придёт снова целиком, без дублей.
    this.alerts.push(...signals.filter((s) => s.stream === 'security').map((s) => s.body));
    this.signalSince = Number(r.signals.next_batch);
    // События доставки: по одному, каждое подтверждается после обработки (C-05).
    for (const ev of r.to_device.events) {
      if (ev.id <= this.syncSince) continue; // уже обработанное событие пришло снова: пропускаем (дедупликация)
      const { id, ...matrixEvent } = ev;
      try {
        await this.engine.receiveSyncChanges(JSON.stringify([matrixEvent]), r.device_one_time_keys_count, []);
      } catch (e) {
        // Непонятное событие не должно останавливать синхронизацию: запоминаем ошибку и подтверждаем.
        this.failedEvents.push({ id, type: ev.type, error: e.message });
      }
      this.syncSince = id;
    }
    await this.drainOutgoing({ tolerateRestricted: true });
  }

  /** Шифрует текст и отправляет на сервер. Сервер получит только шифротекст. */
  /** Эпоха группы для сообщения: первая эпоха создаётся тем же шагом, что у эталонного клиента. */
  async ensureMlsEpoch(roomId) {
    const current = (await this.raw('GET', `/mls/groups/${enc(roomId)}/epoch`)).epoch;
    if (current > 0) return current;
    await this.raw('POST', `/mls/groups/${enc(roomId)}/commits`, { epoch: 0, commit: Buffer.from('client-commit').toString('base64'), changes: { adds: [], removes: [] } });
    return 1;
  }

  async sendText(roomId, text) {
    if (!this.sharedRooms.has(roomId)) {
      // Первое сообщение: создаём свой ключ отправителя и передаём его участникам.
      const members = (await this.raw('GET', `/rooms/${enc(roomId)}/members`)).members;
      await this.addPeers(members);
      await this.establishSessions(members.filter((m) => m !== this.userId));
      await this.shareRoomKey(roomId, members);
    }
    const content = await this.engine.encryptRoomEvent(roomId, 'm.room.message', JSON.stringify({ msgtype: 'm.text', body: text }));
    const epoch = await this.ensureMlsEpoch(roomId);
    const message = Buffer.concat([buildPrivateMessageHeader(roomId, epoch), Buffer.from(content, 'utf8')]).toString('base64');
    return this.raw('POST', `/mls/groups/${enc(roomId)}/messages`, { message, kind: 'text', forwarded: false });
  }

  /** Расшифровывает одно событие беседы. Бросает ошибку, если ключа нет. */
  async decryptRaw(ev, roomId) {
  if (ev.content && typeof ev.content.mls === 'string') {
    ev = { ...ev, content: JSON.parse(privateMessagePayload(Buffer.from(ev.content.mls, 'base64')).toString('utf8')) };
  }
    const dec = await this.engine.decryptRoomEvent(JSON.stringify({ ...ev, room_id: roomId }), roomId);
    return JSON.parse(dec.event).content.body;
  }

  /** Читает беседу и расшифровывает. Нерасшифрованные события помечаются, а не пропускаются. */
  async readText(roomId) {
    const { events } = await this.raw('GET', `/rooms/${enc(roomId)}/events`);
    const out = [];
    for (const ev of events) {
      try {
        out.push({ sender: ev.sender, body: await this.decryptRaw(ev, roomId) });
      } catch {
        out.push({ sender: ev.sender, error: true });
      }
    }
    return out;
  }
}
