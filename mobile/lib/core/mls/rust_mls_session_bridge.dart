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

  Future<void> _ensureInitialized() {
    final active = _initializing;
    if (active != null) return active;

    final operation = RustLib.init();
    late final Future<void> guarded;
    guarded = operation.catchError((Object error, StackTrace stackTrace) {
      if (identical(_initializing, guarded)) _initializing = null;
      Error.throwWithStackTrace(error, stackTrace);
    });
    _initializing = guarded;
    return guarded;
  }

  Future<String> _databaseDirectory() async {
    final support = await _supportDirectory();
    final directory = Directory('${support.path}/inone/mls');
    await directory.create(recursive: true);
    return directory.path;
  }

  BigInt _toRustU64(int value, String name) {
    if (value < 0) {
      throw RangeError.value(value, name, 'must be non-negative');
    }
    return BigInt.from(value);
  }

  int _fromRustU64(BigInt value, String name) {
    if (value.isNegative || value.bitLength > 63) {
      throw ArgumentError.value(value, name, 'does not fit in a Dart int');
    }
    return value.toInt();
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
      _requireSession().ensureKeyPackages(target: _toRustU64(target, 'target'));

  @override
  Future<void> createRoom(String roomId) =>
      _requireSession().createRoom(roomId: roomId);

  @override
  Future<void> invite(String roomId, String userId) =>
      _requireSession().invite(roomId: roomId, userId: userId);

  @override
  Future<void> cancelInvite(String roomId, String userId) =>
      _requireSession().cancelInvite(roomId: roomId, userId: userId);

  @override
  Future<String?> roomRecoveryStatus(String roomId) =>
      _requireSession().roomRecoveryStatus(roomId: roomId);

  @override
  Future<List<MlsUndecryptableEvent>> undecryptable() async {
    final decoded = jsonDecode(await _requireSession().undecryptableJson());
    if (decoded is! List) {
      throw const FormatException('Native MLS returned invalid undecryptable diagnostics');
    }
    return decoded.map((item) {
      if (item is! List || item.length != 3 ||
          item[0] is! String || item[1] is! String || item[2] is! String) {
        throw const FormatException('Native MLS returned an invalid undecryptable event');
      }
      return MlsUndecryptableEvent(
        eventId: item[0] as String,
        roomId: item[1] as String,
        reason: item[2] as String,
      );
    }).toList(growable: false);
  }

  @override
  Future<String?> quarantinedCommitReason(String roomId, int epoch) =>
      _requireSession().quarantinedCommitReason(
        roomId: roomId,
        epoch: _toRustU64(epoch, 'epoch'),
      );

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
  Future<int> flushOutbox() async =>
      _fromRustU64(await _requireSession().flushOutbox(), 'flushOutbox');

  @override
  Future<int> outboxLength() async =>
      _fromRustU64(await _requireSession().outboxLen(), 'outboxLength');

  @override
  Future<int?> localEpoch(String roomId) async {
    final epoch = await _requireSession().localEpoch(roomId: roomId);
    return epoch == null ? null : _fromRustU64(epoch, 'localEpoch');
  }

  @override
  Future<List<String>> membersOf(String roomId) =>
      _requireSession().membersOf(roomId: roomId);

  @override
  Future<void> revokeDevice(String deviceId) =>
      _requireSession().revokeDevice(deviceId: deviceId);

  @override
  Future<int> removeRevokedDevices() async =>
      _fromRustU64(await _requireSession().removeRevokedDevices(), 'removeRevokedDevices');

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
