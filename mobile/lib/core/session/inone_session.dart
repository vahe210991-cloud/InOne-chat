import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math';

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

  Future<Map<String, dynamic>> login({
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
    _acceptSession(result);
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
    return result;
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

  /// Transfers the active session to the persistent OpenMLS client.
  ///
  /// The authenticated profile supplies the canonical user ID. The refresh
  /// token is handed to Rust once and cleared from Dart only after Rust has
  /// accepted the session and returned a valid access-token snapshot.
  Future<void> adoptMlsSession([MlsSessionBridge? bridge]) {
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
      _userId = userId;
      _savedMlsUserId = userId;
      _accessToken = snapshot;
      _refreshToken = null;
      _mlsBridge = target;
      _mlsError = null;
      notifyListeners();
    } catch (_) {
      if (nativeOpened) {
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
      _acceptSession(result);
    } on ApiException {
      _clearSession();
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

  Future<void> logout() async {
    final bridge = _mlsBridge;
    final savedUserId = _savedMlsUserId;
    var localMlsPurged = savedUserId == null;
    try {
      if (bridge != null) {
        try {
          await bridge.logout();
        } finally {
          if (savedUserId != null && _deviceId != null) {
            await bridge.purgeLocalSession(
              userId: savedUserId,
              deviceId: _deviceId!,
            );
            localMlsPurged = true;
          }
        }
      } else if (savedUserId != null && _nativeMlsBridge != null && _deviceId != null) {
        await _nativeMlsBridge.purgeLocalSession(
          userId: savedUserId,
          deviceId: _deviceId!,
        );
        localMlsPurged = true;
      } else if (isAuthenticated) {
        await request('POST', '/logout');
      }
    } finally {
      _mlsBridge = null;
      try {
        if (bridge != null) await bridge.close();
      } finally {
        if (localMlsPurged) {
          await _deleteMlsUserId();
          _savedMlsUserId = null;
        }
        _clearSession();
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
