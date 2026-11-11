import 'dart:convert';
import 'dart:io';

import 'package:inone_mobile/src/rust/api/session.dart' as rust;
import 'package:inone_mobile/src/rust/frb_generated.dart';
import 'package:path_provider/path_provider.dart';

import 'mls_session_bridge.dart';

/// Production Flutter adapter for the generated flutter_rust_bridge API.
///
/// The database is placed in the app-private support directory. Rust derives
/// the database filename from user + device identity and keeps its SQLCipher
/// key in the platform credential store.
class RustMlsSessionBridge implements MlsSessionBridge {
  RustMlsSessionBridge({
    Future<Directory> Function()? supportDirectory,
  }) : _supportDirectory = supportDirectory ?? getApplicationSupportDirectory;

  final Future<Directory> Function() _supportDirectory;
  rust.MlsSession? _session;
  Future<void>? _initializing;

  Future<void> _ensureInitialized() =>
      _initializing ??= RustLib.init();

  Future<String> _databaseDirectory() async {
    final support = await _supportDirectory();
    final directory = Directory('${support.path}/inone/mls');
    await directory.create(recursive: true);
    return directory.path;
  }

  rust.MlsSession _requireSession() {
    final session = _session;
    if (session == null) {
      throw StateError('Native MLS session is not open');
    }
    return session;
  }

  @override
  Future<void> open({
    required String baseUrl,
    required String userId,
    required String deviceId,
    required String accessToken,
    required String refreshToken,
  }) async {
    await _ensureInitialized();
    final previous = _session;
    _session = null;
    if (previous != null) await previous.close();
    _session = await rust.openSession(
      baseUrl: baseUrl,
      userId: userId,
      deviceId: deviceId,
      accessToken: accessToken,
      refreshToken: refreshToken,
      databaseDirectory: await _databaseDirectory(),
    );
  }

  @override
  Future<void> resume({
    required String baseUrl,
    required String userId,
    required String deviceId,
  }) async {
    await _ensureInitialized();
    final previous = _session;
    _session = null;
    if (previous != null) await previous.close();
    _session = await rust.resumeSession(
      baseUrl: baseUrl,
      userId: userId,
      deviceId: deviceId,
      databaseDirectory: await _databaseDirectory(),
    );
  }

  @override
  Future<String> accessTokenSnapshot() =>
      _requireSession().accessTokenSnapshot();

  @override
  Future<String> refreshSession() =>
      _requireSession().refreshSession();

  @override
  Future<void> ensureKeyPackages(int target) =>
      _requireSession().ensureKeyPackages(target: target);

  @override
  Future<void> createRoom(String roomId) =>
      _requireSession().createRoom(roomId: roomId);

  @override
  Future<void> invite(String roomId, String userId) =>
      _requireSession().invite(roomId: roomId, userId: userId);

  @override
  Future<String> sendText(String roomId, String plaintext) =>
      _requireSession().sendText(roomId: roomId, plaintext: plaintext);

  @override
  Future<String> enqueueText(String roomId, String plaintext) =>
      _requireSession().enqueueText(roomId: roomId, plaintext: plaintext);

  @override
  Future<List<MlsIncomingMessage>> sync() async =>
      _decodeIncoming(await _requireSession().syncJson());

  @override
  Future<List<MlsIncomingMessage>> pendingIncoming() async =>
      _decodeIncoming(await _requireSession().pendingIncomingJson());

  @override
  Future<List<MlsIncomingMessage>> messagesForRoom(String roomId) async =>
      _decodeIncoming(await _requireSession().messagesForRoomJson(roomId: roomId));

  @override
  Future<void> acknowledgeIncoming(List<String> eventIds) =>
      _requireSession().acknowledgeIncoming(eventIds: eventIds);

  List<MlsIncomingMessage> _decodeIncoming(String source) {
    final decoded = jsonDecode(source);
    if (decoded is! List) {
      throw const FormatException('Native MLS returned an invalid inbox payload');
    }
    return decoded.map((item) {
      if (item is! Map) {
        throw const FormatException('Native MLS returned an invalid message');
      }
      final value = Map<String, dynamic>.from(item);
      final kind = value['type'];
      final roomId = value['room_id'];
      final eventId = value['event_id'];
      if (roomId is! String || eventId is! String) {
        throw const FormatException('Native MLS message has no room/event identity');
      }
      if (kind == 'text') {
        final text = value['text'];
        if (text is! String) {
          throw const FormatException('Native MLS text message has no plaintext');
        }
        return MlsIncomingMessage(
          roomId: roomId,
          eventId: eventId,
          text: text,
        );
      }
      if (kind == 'unreadable') {
        return MlsIncomingMessage(roomId: roomId, eventId: eventId);
      }
      throw const FormatException('Native MLS returned an unknown message kind');
    }).toList(growable: false);
  }

  @override
  Future<int> flushOutbox() => _requireSession().flushOutbox();

  @override
  Future<int> outboxLength() => _requireSession().outboxLen();

  @override
  Future<int?> localEpoch(String roomId) =>
      _requireSession().localEpoch(roomId: roomId);

  @override
  Future<List<String>> membersOf(String roomId) =>
      _requireSession().membersOf(roomId: roomId);

  @override
  Future<void> revokeDevice(String deviceId) =>
      _requireSession().revokeDevice(deviceId: deviceId);

  @override
  Future<int> removeRevokedDevices() =>
      _requireSession().removeRevokedDevices();

  @override
  Future<void> purgeLocalSession({
    required String userId,
    required String deviceId,
  }) async {
    await _ensureInitialized();
    await rust.purgeLocalSession(
      userId: userId,
      deviceId: deviceId,
      databaseDirectory: await _databaseDirectory(),
    );
  }

  @override
  Future<void> logout() async {
    final current = _session;
    if (current == null) return;
    try {
      await current.logout();
    } finally {
      _session = null;
      await current.close();
    }
  }

  @override
  Future<void> close() async {
    final current = _session;
    _session = null;
    if (current != null) await current.close();
  }
}
