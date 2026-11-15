import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../mls/mls_session_bridge.dart';
import '../network/api_client.dart';
import '../network/api_exception.dart';

/// Owns the authenticated app session. Before MLS adoption, Flutter owns the
/// refresh pair in memory. After adoption, Rust is the only refresh-token owner.
class InOneSession extends ChangeNotifier {
  InOneSession({
    required this.baseUrl,
    http.Client? httpClient,
    Future<String?> Function()? readDeviceId,
    Future<void> Function(String)? writeDeviceId,
    MlsSessionBridge? nativeMlsBridge,
    Future<String?> Function()? readMlsUserId,
    Future<void> Function(String)? writeMlsUserId,
    Future<void> Function()? deleteMlsUserId,
  })  : _httpClient = httpClient,
        _nativeMlsBridge = nativeMlsBridge,
        _readDeviceId = readDeviceId ?? (() => _storage.read(key: _deviceIdKey)),
        _writeDeviceId = writeDeviceId ??
            ((value) => _storage.write(key: _deviceIdKey, value: value)),
        _readMlsUserId = readMlsUserId ?? (() => _storage.read(key: _mlsUserIdKey)),
        _writeMlsUserId = writeMlsUserId ??
            ((value) => _storage.write(key: _mlsUserIdKey, value: value)),
        _deleteMlsUserId = deleteMlsUserId ??
            (() => _storage.delete(key: _mlsUserIdKey));

  static const _deviceIdKey = 'inone.device_id';
  static const _mlsUserIdKey = 'inone.mls_user_id';
  static const _storage = FlutterSecureStorage();
  static final _secureRandom = Random.secure();

  final String baseUrl;
  final http.Client? _httpClient;
  final MlsSessionBridge? _nativeMlsBridge;
  final Future<String?> Function() _readDeviceId;
  final Future<void> Function(String) _writeDeviceId;
  final Future<String?> Function() _readMlsUserId;
  final Future<void> Function(String) _writeMlsUserId;
  final Future<void> Function() _deleteMlsUserId;

  String? _accessToken;
  String? _refreshToken;
  String? _deviceId;
  String? _userId;
  String? _savedMlsUserId;
  Future<void>? _initializing;
  Future<void>? _adoptionInFlight;
  Future<Map<String, dynamic>>? _loginInFlight;
  Future<void>? _logoutInFlight;
  bool _loggingOut = false;
  Future<void>? _refreshInFlight;
  Future<String>? _nativeRefreshInFlight;
  Completer<void>? _handoffGate;
  MlsSessionBridge? _mlsBridge;

  late final ApiClient _client = ApiClient(
    baseUrl: baseUrl,
    accessTokenProvider: () => _accessToken,
    httpClient: _httpClient,
  );

  String? get deviceId => _deviceId;
  String? get userId => _userId;
  bool get isAuthenticated => _accessToken != null && _accessToken!.isNotEmpty;
  bool get isConfigured => baseUrl.trim().isNotEmpty;
  bool get hasNativeMlsSession => _mlsBridge != null;
  String? _mlsError;
  String? get mlsError => _mlsError;

  Future<void> initialize() {
    if (_loggingOut) {
      return Future<void>.error(const ApiException(
        code: 'session_logging_out',
        statusCode: 409,
        retryable: false,
      ));
    }
    if (_deviceId != null) return Future<void>.value();
    final active = _initializing;
    if (active != null) return active;
    final operation = _initializeOnce();
    _initializing = operation;
    return operation.whenComplete(() {
      if (identical(_initializing, operation)) _initializing = null;
    });
  }

  Future<void> _initializeOnce() async {
    if (_deviceId != null) return;
    var id = await _readDeviceId();
    if (id == null || id.isEmpty) {
      final bytes = List<int>.generate(32, (_) => _secureRandom.nextInt(256));
      id = base64UrlEncode(bytes).replaceAll('=', '');
      await _writeDeviceId(id);
    }
    _deviceId = id;

    final savedUserId = await _readMlsUserId();
    _savedMlsUserId = savedUserId;
    if (savedUserId != null && savedUserId.isNotEmpty) {
      final bridge = _nativeMlsBridge;
      if (bridge == null) {
        _mlsError = 'Native MLS runtime is unavailable on this platform';
      } else {
        try {
          await bridge.resume(
            baseUrl: baseUrl,
            userId: savedUserId,
            deviceId: id,
          );
          final snapshot = await bridge.accessTokenSnapshot();
          if (snapshot.isEmpty) {
            throw const ApiException(
              code: 'mls_session_missing_access_token',
              statusCode: 502,
              retryable: false,
            );
          }
          _userId = savedUserId;
          _accessToken = snapshot;
          _mlsBridge = bridge;
          _mlsError = null;
          await _primeNativeMls(bridge);
        } catch (error) {
          _mlsError = 'Saved MLS session could not be restored: $error';
          try {
            await bridge.close();
          } catch (_) {
            // Keep the original restore error for diagnostics.
          }
        }
      }
    }
    notifyListeners();
  }

  /// Publishes key packages, accepts pending welcomes, syncs encrypted rooms,
  /// and flushes the Rust-owned text outbox. Failures are surfaced as diagnostics
  /// without rolling back an otherwise successful session handoff.
  Future<void> _primeNativeMls(MlsSessionBridge bridge) async {
    String? failure;
    try {
      await bridge.ensureKeyPackages(10);
    } catch (error) {
      failure = 'MLS key-package publication is pending: $error';
    }
    try {
      await bridge.sync();
    } catch (error) {
      failure = 'MLS room synchronization is pending: $error';
    }
    try {
      await bridge.flushOutbox();
    } catch (error) {
      failure = 'MLS offline outbox flush is pending: $error';
    }
    _mlsError = failure;
    notifyListeners();
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) {
    if (_loggingOut) {
      return Future<Map<String, dynamic>>.error(const ApiException(
        code: 'session_logging_out',
        statusCode: 409,
        retryable: false,
      ));
    }
    final active = _loginInFlight;
    if (active != null) {
      return Future<Map<String, dynamic>>.error(const ApiException(
        code: 'login_in_progress',
        statusCode: 409,
        retryable: false,
      ));
    }
    final operation = _loginOnce(email: email, password: password);
    _loginInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_loginInFlight, operation)) _loginInFlight = null;
    });
  }

  Future<Map<String, dynamic>> _loginOnce({
    required String email,
    required String password,
  }) async {
    await initialize();
    final platform = Platform.isIOS
        ? 'ios'
        : Platform.isAndroid
            ? 'android'
            : 'unknown';
    final result = await _client.post(
      '/login',
      authenticated: false,
      body: {
        'email': email.trim(),
        'password': password,
        'deviceId': _deviceId,
        'label': 'InOne Flutter test client',
        'platform': platform,
      },
    );
    final safeResult = Map<String, dynamic>.from(result)
      ..remove('token')
      ..remove('refreshToken')
      ..remove('code')
      ..remove('pollSecret')
      ..remove('approvalId');
    _acceptSession(result);
    // Do not return or display access/refresh tokens or device-approval
    // secrets to callers such as the API test panel.
    result['token'] = null;
    result['refreshToken'] = null;
    result['code'] = null;
    result['pollSecret'] = null;
    result['approvalId'] = null;
    final native = _nativeMlsBridge;
    if (native != null) {
      try {
        await adoptMlsSession(native);
      } catch (error) {
        // Authentication remains valid, but MLS stays disabled. There is no
        // Megolm or plaintext messaging fallback.
        _mlsError = 'MLS runtime could not be opened: $error';
        notifyListeners();
      }
    }
    return safeResult;
  }

  Future<Map<String, dynamic>> startEmailRegistration(String email) =>
      _client.post('/register/email',
          authenticated: false, body: {'email': email.trim()});

  Future<Map<String, dynamic>> confirmEmailRegistration({
    required String email,
    required String code,
  }) =>
      _client.post('/register/email/confirm', authenticated: false, body: {
        'email': email.trim(),
        'code': code.trim(),
      });

  Future<Map<String, dynamic>> registerAccount({
    required String email,
    required String registrationToken,
    required String password,
    required String nickname,
    String? phone,
  }) =>
      _client.post('/register', authenticated: false, body: {
        'email': email.trim(),
        'registrationToken': registrationToken,
        'password': password,
        'nickname': nickname.trim(),
        if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
      });

  Future<Map<String, dynamic>> startRecovery(String email) =>
      _client.post('/recovery/start', authenticated: false, body: {'email': email.trim()});

  Future<Map<String, dynamic>> confirmRecoveryLink({
    required String userId,
    required String token,
  }) =>
      _client.post('/recovery/confirm', authenticated: false, body: {
        'user': userId.trim(),
        'token': token.trim(),
      });

  Future<Map<String, dynamic>> completeRecovery({
    String? email,
    String? userId,
    required String code,
    required String newPassword,
    String pin = '',
  }) {
    final accountId = userId?.trim();
    final address = email?.trim();
    if ((accountId == null || accountId.isEmpty) &&
        (address == null || address.isEmpty)) {
      throw ArgumentError('email or userId is required for recovery');
    }
    return _client.post('/recovery/complete', authenticated: false, body: {
      if (accountId != null && accountId.isNotEmpty)
        'userId': accountId
      else
        'email': address,
      'code': code.trim(),
      'newPassword': newPassword,
      if (pin.isNotEmpty) 'pin': pin,
    });
  }

  Future<Map<String, dynamic>> cancelRecoveryByCode({
    required String email,
    required String code,
  }) =>
      _client.post('/recovery/cancel-by-code', authenticated: false, body: {
        'email': email.trim(),
        'code': code.trim(),
      });

  Future<List<Map<String, dynamic>>> listDevices() async {
    final result = await request('GET', '/devices/mine');
    final items = result['devices'];
    if (items is! List) return const [];
    return items.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  Future<void> revokeDevice(String deviceId) async {
    await request('DELETE', '/devices/${Uri.encodeComponent(deviceId)}');
    if (deviceId == _deviceId) await logout();
  }

  /// Transfers the active session to the persistent OpenMLS client.
  ///
  /// The authenticated profile supplies the canonical user ID. The refresh
  /// token is handed to Rust once and cleared from Dart only after Rust has
  /// accepted the session and returned a valid access-token snapshot.
  Future<void> adoptMlsSession([MlsSessionBridge? bridge]) {
    if (_loggingOut) {
      return Future<void>.error(const ApiException(
        code: 'session_logging_out',
        statusCode: 409,
        retryable: false,
      ));
    }
    final active = _adoptionInFlight;
    if (active != null) return active;
    final operation = _adoptMlsSession(bridge);
    _adoptionInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_adoptionInFlight, operation)) _adoptionInFlight = null;
    });
  }

  Future<void> _adoptMlsSession([MlsSessionBridge? bridge]) async {
    final target = bridge ?? _nativeMlsBridge;
    if (target == null) {
      throw const ApiException(
        code: 'mls_session_bridge_unavailable',
        statusCode: 503,
        retryable: false,
      );
    }
    if (_mlsBridge != null) return;
    if (!isAuthenticated || _refreshToken == null || _deviceId == null) {
      throw const ApiException(
        code: 'session_required_for_mls',
        statusCode: 401,
        retryable: false,
      );
    }

    final gate = Completer<void>();
    _handoffGate = gate;
    var nativeOpened = false;
    try {
      final refreshing = _refreshInFlight;
      if (refreshing != null) await refreshing;

      final profile = await _client.get('/profile');
      final userId = profile['userId'];
      if (userId is! String || userId.trim().isEmpty) {
        throw const ApiException(
          code: 'profile_missing_user_id',
          statusCode: 502,
          retryable: false,
        );
      }

      _savedMlsUserId = userId;
      await _writeMlsUserId(userId);
      await target.open(
        baseUrl: baseUrl,
        userId: userId,
        deviceId: _deviceId!,
        accessToken: _accessToken!,
        refreshToken: _refreshToken!,
      );
      nativeOpened = true;
      final snapshot = await target.accessTokenSnapshot();
      if (snapshot.isEmpty) {
        throw const ApiException(
          code: 'mls_session_missing_access_token',
          statusCode: 502,
          retryable: false,
        );
      }
      // Transfer ownership only after Rust confirms it can return a valid
      // access-token snapshot. If that check fails, tear down the native copy
      // rather than leaving two competing refresh-token owners.
      _mlsBridge = target;
      _refreshToken = null;
      _userId = userId;
      _savedMlsUserId = userId;
      _accessToken = snapshot;
      _mlsError = null;
      notifyListeners();
      await _primeNativeMls(target);
    } catch (_) {
      if (nativeOpened) {
        try {
          await target.logout();
        } catch (_) {
          // Rust logout always attempts local SQLCipher/key cleanup.
        }
        try {
          await target.close();
        } catch (_) {
          // Preserve the original handoff error.
        }
        _mlsBridge = null;
        _savedMlsUserId = null;
        try {
          await _deleteMlsUserId();
        } catch (_) {
          // Do not hide the original handoff failure.
        }
        _clearSession();
      } else {
        try {
          await target.close();
        } catch (_) {
          // Preserve the original handoff error.
        }
      }
      rethrow;
    } finally {
      _handoffGate = null;
      if (!gate.isCompleted) gate.complete();
    }
  }

  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    if (_loggingOut) {
      throw const ApiException(
        code: 'session_logging_out',
        statusCode: 409,
        retryable: false,
      );
    }
    final gate = _handoffGate;
    if (gate != null) await gate.future;
    try {
      return await _client.request(
        method,
        path,
        body: body,
        authenticated: authenticated,
      );
    } on ApiException catch (error) {
      if (_loggingOut) {
        throw const ApiException(
          code: 'session_logging_out',
          statusCode: 409,
          retryable: false,
        );
      }
      if (!authenticated || error.statusCode != 401) rethrow;

      final native = _mlsBridge;
      if (native != null) {
        final token = await _refreshNativeOnce(native);
        if (token.isEmpty) {
          throw const ApiException(
            code: 'mls_session_missing_access_token',
            statusCode: 502,
            retryable: false,
          );
        }
        _accessToken = token;
        notifyListeners();
        return _client.request(method, path, body: body, authenticated: true);
      }

      if (_refreshToken == null) rethrow;
      await _refreshOnce();
      return _client.request(method, path, body: body, authenticated: true);
    }
  }

  /// Uploads already-encrypted bytes using a short-lived signed PUT URL.
  /// The caller must obtain ciphertext from the native MLS layer first.
  Future<void> uploadCiphertext(String signedUrl, Uint8List ciphertext) =>
      _client.putBytes(signedUrl, ciphertext);

  /// Downloads a same-origin, device-bound file URL and retries once after
  /// rotating the access token through the current token owner.
  Future<Uint8List> downloadBytes(String signedUrl) async {
    try {
      return await _client.getBytes(signedUrl);
    } on ApiException catch (error) {
      if (error.statusCode != 401) rethrow;
      final native = _mlsBridge;
      if (native != null) {
        final token = await _refreshNativeOnce(native);
        if (token.isEmpty) {
          throw const ApiException(
            code: 'mls_session_missing_access_token',
            statusCode: 502,
            retryable: false,
          );
        }
        _accessToken = token;
        notifyListeners();
      } else {
        if (_refreshToken == null) rethrow;
        await _refreshOnce();
      }
      return _client.getBytes(signedUrl);
    }
  }

  Future<String> _refreshNativeOnce(MlsSessionBridge bridge) {
    final active = _nativeRefreshInFlight;
    if (active != null) return active;
    final operation = bridge.refreshSession();
    _nativeRefreshInFlight = operation;
    return operation.whenComplete(() => _nativeRefreshInFlight = null);
  }

  Future<void> _refreshOnce() {
    final active = _refreshInFlight;
    if (active != null) return active;
    final operation = _rotateRefreshToken();
    _refreshInFlight = operation;
    return operation.whenComplete(() => _refreshInFlight = null);
  }

  Future<void> _rotateRefreshToken() async {
    final current = _refreshToken;
    if (current == null || current.isEmpty) {
      _clearSession();
      throw const ApiException(
        code: 'session_expired',
        statusCode: 401,
        retryable: false,
      );
    }
    try {
      final result = await _client.post(
        '/token/refresh',
        authenticated: false,
        body: {'refreshToken': current},
      );
      try {
        _acceptSession(result);
      } finally {
        result['token'] = null;
        result['refreshToken'] = null;
      }
    } on ApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        _clearSession();
      }
      rethrow;
    }
  }

  void _acceptSession(Map<String, dynamic> result) {
    final access = result['token'];
    final refresh = result['refreshToken'];
    if (access is String &&
        access.isNotEmpty &&
        refresh is String &&
        refresh.isNotEmpty) {
      _accessToken = access;
      _refreshToken = refresh;
      notifyListeners();
    }
  }

  MlsSessionBridge _requireMlsBridge() {
    final bridge = _mlsBridge;
    if (bridge == null) {
      throw const ApiException(
        code: 'native_mls_unavailable',
        statusCode: 503,
        retryable: false,
      );
    }
    return bridge;
  }

  Future<void> ensureMlsKeyPackages(int target) async {
    await _requireMlsBridge().ensureKeyPackages(target);
  }

  Future<void> createMlsRoom(String roomId) async {
    await _requireMlsBridge().createRoom(roomId);
  }

  Future<void> inviteMlsUser(String roomId, String userId) async {
    await _requireMlsBridge().invite(roomId, userId);
  }

  /// Encrypts and sends through OpenMLS. There is deliberately no HTTP/plaintext fallback.
  Future<String> sendMlsText(String roomId, String plaintext) async =>
      _requireMlsBridge().sendText(roomId, plaintext);

  /// Encrypts and uploads an attachment through the native Rust MLS client.
  /// The manifest key/nonce never cross this Dart boundary.
  Future<String> sendMlsAttachment({
    required String roomId,
    required String name,
    required String mimeType,
    required Uint8List plaintext,
    required String clientMessageId,
  }) async {
    return _requireMlsBridge().sendAttachment(
      roomId: roomId,
      name: name,
      mimeType: mimeType,
      plaintext: plaintext,
      clientMessageId: clientMessageId,
    );
  }

  /// Downloads and decrypts an attachment in Rust; only verified plaintext bytes return to Dart.
  Future<Uint8List> downloadMlsAttachment(String fileId) async =>
      _requireMlsBridge().downloadAttachment(fileId);

  /// Persists an encrypted MLS message in the Rust-owned offline outbox.
  Future<String> enqueueMlsText(String roomId, String plaintext) async =>
      _requireMlsBridge().enqueueText(roomId, plaintext);

  Future<List<MlsIncomingMessage>> syncMlsMessages() async =>
      _requireMlsBridge().sync();

  Future<List<MlsIncomingMessage>> pendingMlsMessages() async =>
      _requireMlsBridge().pendingIncoming();

  Future<List<MlsIncomingMessage>> mlsMessagesForRoom(String roomId) async =>
      _requireMlsBridge().messagesForRoom(roomId);

  Future<void> acknowledgeMlsMessages(List<String> eventIds) async {
    await _requireMlsBridge().acknowledgeIncoming(eventIds);
  }

  Future<int> flushMlsOutbox() async => _requireMlsBridge().flushOutbox();

  Future<int> mlsOutboxLength() async => _requireMlsBridge().outboxLength();

  Future<int?> mlsLocalEpoch(String roomId) async =>
      _requireMlsBridge().localEpoch(roomId);

  Future<List<String>> mlsMembersOf(String roomId) async =>
      _requireMlsBridge().membersOf(roomId);

  Future<void> revokeMlsDevice(String deviceId) async {
    await _requireMlsBridge().revokeDevice(deviceId);
  }

  Future<int> removeRevokedMlsDevices() async =>
      _requireMlsBridge().removeRevokedDevices();

  /// Returns the durable room recovery state reported by the native MLS client.
  Future<String?> mlsRoomRecoveryStatus(String roomId) async {
    final bridge = _mlsBridge;
    if (bridge == null) return null;
    return bridge.roomRecoveryStatus(roomId);
  }

  /// Returns persisted diagnostics for MLS events that could not be decrypted.
  Future<List<MlsUndecryptableEvent>> mlsUndecryptableEvents() async {
    final bridge = _mlsBridge;
    if (bridge == null) return const [];
    return bridge.undecryptable();
  }

  /// Returns the quarantined Commit reason for a room epoch, when present.
  Future<String?> mlsQuarantinedCommitReason(String roomId, int epoch) async {
    final bridge = _mlsBridge;
    if (bridge == null) return null;
    return bridge.quarantinedCommitReason(roomId, epoch);
  }

  /// Cancels an invite only when the native client can safely release its claim.
  Future<void> cancelMlsInvite(String roomId, String userId) async {
    final bridge = _mlsBridge;
    if (bridge == null) {
      throw StateError('Native MLS session is not open');
    }
    await bridge.cancelInvite(roomId, userId);
  }

  Future<void> logout() {
    final active = _logoutInFlight;
    if (active != null) return active;
    _loggingOut = true;
    final operation = _logoutOnce();
    _logoutInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_logoutInFlight, operation)) _logoutInFlight = null;
      _loggingOut = false;
    });
  }

  Future<void> _logoutOnce() async {
    final login = _loginInFlight;
    if (login != null) {
      try {
        await login;
      } catch (_) {
        // Continue with local cleanup even if authentication failed.
      }
    }
    final initialization = _initializing;
    if (initialization != null) {
      try {
        await initialization;
      } catch (_) {
        // Continue with local cleanup even if session restoration failed.
      }
    }
    final adoption = _adoptionInFlight;
    if (adoption != null) {
      try {
        await adoption;
      } catch (_) {
        // The handoff may fail; the saved identity is still cleared below.
      }
    }
    final handoff = _handoffGate;
    if (handoff != null) await handoff.future;
    final refresh = _refreshInFlight;
    if (refresh != null) {
      try {
        await refresh;
      } catch (_) {
        // Logout must not be blocked by a failed token rotation.
      }
    }
    final nativeRefresh = _nativeRefreshInFlight;
    if (nativeRefresh != null) {
      try {
        await nativeRefresh;
      } catch (_) {
        // Local native cleanup remains mandatory.
      }
    }

    final bridge = _mlsBridge;
    final savedUserId = _savedMlsUserId;
    try {
      if (bridge != null) {
        try {
          await bridge.logout();
        } finally {
          if (savedUserId != null) {
            final deviceId = _deviceId;
            if (deviceId == null) {
              throw StateError(
                'Native MLS cleanup requires the persisted device identity',
              );
            }
            await bridge.purgeLocalSession(
              userId: savedUserId,
              deviceId: deviceId,
            );
          }
        }
      } else if (savedUserId != null) {
        final native = _nativeMlsBridge;
        final deviceId = _deviceId;
        if (native == null || deviceId == null) {
          throw StateError(
            'Native MLS cleanup unavailable; saved identity will not be resumed',
          );
        }
        await native.purgeLocalSession(
          userId: savedUserId,
          deviceId: deviceId,
        );
      } else if (isAuthenticated) {
        await _client.post('/logout');
      }
    } finally {
      _mlsBridge = null;
      try {
        if (bridge != null) await bridge.close();
      } finally {
        try {
          if (savedUserId != null) {
            // Never auto-resume a session after an explicit logout attempt,
            // even if native storage cleanup reports an error. The encrypted
            // database/key may remain for a later explicit recovery, but the
            // persisted identity must not silently authenticate on next launch.
            _savedMlsUserId = null;
            await _deleteMlsUserId();
          }
        } finally {
          _clearSession();
        }
      }
    }
  }

  void _clearSession() {
    _mlsError = null;
    _accessToken = null;
    _refreshToken = null;
    _userId = null;
    notifyListeners();
  }

  @override
  void dispose() {
    final bridge = _mlsBridge;
    if (bridge != null) unawaited(bridge.close());
    _client.close();
    super.dispose();
  }
}
