import 'dart:typed_data';

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

/// A durable operation waiting in the native SQLCipher-backed MLS outbox.
class MlsPendingOutboxItem {
  const MlsPendingOutboxItem({
    required this.localId,
    required this.roomId,
    required this.kind,
    this.text,
    this.payloadBytes = 0,
    this.fileId,
    this.name,
    this.mimeType,
    this.size,
    this.uploaded,
  });

  final String localId;
  final String roomId;
  final String kind;
  final String? text;
  final int payloadBytes;
  final String? fileId;
  final String? name;
  final String? mimeType;
  final int? size;
  final bool? uploaded;

  factory MlsPendingOutboxItem.fromJson(Map<String, dynamic> json) {
    final localId = json['local_id'];
    final roomId = json['room_id'];
    final kind = json['kind'];
    if (localId is! String || localId.isEmpty ||
        roomId is! String || roomId.isEmpty ||
        kind is! String ||
        !const {'text', 'opaque', 'attachment'}.contains(kind)) {
      throw const FormatException('Native MLS returned an invalid pending outbox identity');
    }

    final text = json['text'];
    final payloadBytes = json['payload_bytes'] ?? 0;
    if (text != null && text is! String) {
      throw const FormatException('Native MLS returned invalid pending text');
    }
    if (payloadBytes is! int || payloadBytes < 0) {
      throw const FormatException('Native MLS returned invalid pending payload size');
    }

    if (kind == 'attachment') {
      final fileId = json['file_id'];
      final name = json['name'];
      final mimeType = json['mime_type'];
      final size = json['size'];
      final uploaded = json['uploaded'];
      if (fileId is! String || fileId.isEmpty ||
          name is! String || name.isEmpty ||
          mimeType is! String || mimeType.isEmpty ||
          size is! int || size <= 0 ||
          uploaded is! bool) {
        throw const FormatException('Native MLS returned invalid pending attachment metadata');
      }
      return MlsPendingOutboxItem(
        localId: localId,
        roomId: roomId,
        kind: kind,
        payloadBytes: payloadBytes,
        fileId: fileId,
        name: name,
        mimeType: mimeType,
        size: size,
        uploaded: uploaded,
      );
    }

    if ((kind == 'text' && text is! String) ||
        (kind == 'opaque' && text != null)) {
      throw const FormatException('Native MLS returned an invalid pending message body');
    }
    return MlsPendingOutboxItem(
      localId: localId,
      roomId: roomId,
      kind: kind,
      text: text as String?,
      payloadBytes: payloadBytes,
    );
  }
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
  Future<void> approveJoinRequest(String roomId, String userId);
  Future<void> cancelInvite(String roomId, String userId);
  Future<String?> roomRecoveryStatus(String roomId);
  Future<List<MlsUndecryptableEvent>> undecryptable();
  Future<String?> quarantinedCommitReason(String roomId, int epoch);
  Future<String> sendText(String roomId, String plaintext);
  Future<String> sendTextWithId(String roomId, String plaintext, String clientMessageId);
  Future<List<MlsPendingOutboxItem>> pendingOutbox(String roomId);
  Future<String> sendAttachment({
    required String roomId,
    required String name,
    required String mimeType,
    required Uint8List plaintext,
  });
  Future<String> sendAttachmentWithId({
    required String roomId,
    required String name,
    required String mimeType,
    required Uint8List plaintext,
    required String clientMessageId,
  });
  Future<Uint8List> downloadAttachment(String fileId);
  Future<String> enqueueText(String roomId, String plaintext);
  Future<List<MlsIncomingMessage>> sync();
  Future<List<MlsIncomingMessage>> pendingIncoming();
  Future<List<MlsIncomingMessage>> messagesForRoom(String roomId);
  Future<List<String>> localRoomIds();
  Future<void> acknowledgeIncoming(List<String> eventIds);
  Future<int> flushOutbox();
  Future<int> outboxLength();
  Future<int?> localEpoch(String roomId);
  Future<List<String>> membersOf(String roomId);
  Future<void> removeMember(String roomId, String userId);
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
