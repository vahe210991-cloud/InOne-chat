import 'dart:typed_data';

class MlsPendingOutgoing {
  const MlsPendingOutgoing({
    required this.localId,
    required this.roomId,
    required this.text,
  });

  final String localId;
  final String roomId;
  final String text;
}

/// Data returned from the native OpenMLS runtime after decryption.
class MlsIncomingMessage {
  const MlsIncomingMessage({
    required this.roomId,
    required this.eventId,
    this.text,
    this.fileId,
    this.name,
    this.mimeType,
    this.size,
    this.mine = false,
  });

  final String roomId;
  final String eventId;
  final String? text;
  final String? fileId;
  final String? name;
  final String? mimeType;
  final int? size;
  final bool mine;

  bool get isAttachment => fileId != null;
  bool get isReadable => text != null || isAttachment;
}

/// Durable diagnostics for an MLS event that could not be decrypted or parsed.
class MlsUndecryptableEvent {
  const MlsUndecryptableEvent({
    required this.eventId,
    required this.roomId,
    required this.reason,
  });

  final String eventId;
  final String roomId;
  final String reason;
}

/// Typed boundary between Flutter and the native OpenMLS runtime.
///
/// Refresh tokens, MLS private keys and the SQLCipher key are never returned
/// through this interface. Only the short-lived access token may cross back
/// to Flutter for ordinary authenticated API calls.
abstract interface class MlsSessionBridge {
  Future<void> open({
    required String baseUrl,
    required String userId,
    required String deviceId,
    required String accessToken,
    required String refreshToken,
  });

  /// Reopens the Rust-owned encrypted session without receiving credentials.
  Future<void> resume({
    required String baseUrl,
    required String userId,
    required String deviceId,
  });

  Future<String> accessTokenSnapshot();
  Future<String> refreshSession();

  Future<void> ensureKeyPackages(int target);
  Future<void> createRoom(String roomId);
  Future<void> invite(String roomId, String userId);
  Future<void> cancelInvite(String roomId, String userId);
  Future<String?> roomRecoveryStatus(String roomId);
  Future<List<MlsUndecryptableEvent>> undecryptable();
  Future<String?> quarantinedCommitReason(String roomId, int epoch);
  Future<String> sendText(String roomId, String plaintext);
  Future<String> enqueueText(String roomId, String plaintext);
  Future<String> sendAttachment(
    String roomId,
    String name,
    String mimeType,
    Uint8List plaintext,
  );
  Future<Uint8List> downloadAttachment(String fileId);
  Future<List<MlsIncomingMessage>> sync();
  Future<List<MlsIncomingMessage>> pendingIncoming();
  Future<List<MlsIncomingMessage>> messagesForRoom(String roomId);
  Future<List<MlsPendingOutgoing>> pendingOutgoing(String roomId);
  Future<void> acknowledgeIncoming(List<String> eventIds);
  Future<int> flushOutbox();
  Future<int> outboxLength();
  Future<int?> localEpoch(String roomId);
  Future<List<String>> membersOf(String roomId);
  Future<void> revokeDevice(String deviceId);
  Future<int> removeRevokedDevices();

  /// Removes a local session even when it cannot be reopened.
  Future<void> purgeLocalSession({
    required String userId,
    required String deviceId,
  });

  /// Attempts server logout and always purges the local encrypted session.
  Future<void> logout();

  /// Releases the native handle without destroying persistent session data.
  Future<void> close();
}
