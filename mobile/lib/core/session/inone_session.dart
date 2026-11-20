import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../network/api_client.dart';
import '../network/api_exception.dart';

/// Mobile session owner for the pre-native-MLS integration phase.
///
/// Access tokens stay in memory; the rotating refresh token is persisted in
/// Keychain/Android Keystore until the native MLS bridge takes ownership.
class InOneSession extends ChangeNotifier {
  InOneSession({required this.baseUrl});

  static const _deviceIdKey = 'inone.device_id';
  static const _refreshTokenKey = 'inone.refresh_token';
  static const _storage = FlutterSecureStorage();

  final String baseUrl;
  String? _accessToken;
  String? _refreshToken;
  String? _deviceId;
  Future<void>? _refreshInFlight;
  Future<void>? _initializeInFlight;
  bool _initialized = false;

  late final ApiClient _client = ApiClient(
    baseUrl: baseUrl,
    accessTokenProvider: () => _accessToken,
  );

  String? get deviceId => _deviceId;
  bool get isAuthenticated => _accessToken != null && _accessToken!.isNotEmpty;
  bool get isConfigured => baseUrl.trim().isNotEmpty;

  Future<void> initialize() {
    if (_initialized) return Future<void>.value();
    final active = _initializeInFlight;
    if (active != null) return active;
    final operation = _initializeInternal();
    _initializeInFlight = operation;
    return operation.whenComplete(() => _initializeInFlight = null);
  }

  Future<void> _initializeInternal() async {
    var id = await _storage.read(key: _deviceIdKey);
    if (id == null || id.isEmpty) {
      final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
      id = base64UrlEncode(bytes).replaceAll('=', '');
      await _storage.write(key: _deviceIdKey, value: id);
    }
    _deviceId = id;
    _refreshToken = await _storage.read(key: _refreshTokenKey);
    _initialized = true;
    notifyListeners();

    if (_refreshToken != null && _refreshToken!.isNotEmpty) {
      try {
        await _rotateRefreshToken();
      } on ApiException {
        // Transient errors retain the refresh token; invalid/revoked tokens are cleared.
      }
    }
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
    String? identityCode,
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
        'label': 'InOne mobile client',
        'platform': platform,
        if (identityCode != null) 'identityCode': identityCode.trim(),
      },
    );
    await _acceptSession(result);
    return result;
  }

  Future<Map<String, dynamic>> startEmailRegistration(String email) =>
      _client.post('/register/email', authenticated: false, body: {'email': email.trim()});
  Future<Map<String, dynamic>> startRecovery(String email) =>
      _client.post('/recovery/start', authenticated: false, body: {'email': email.trim()});

  Future<Map<String, dynamic>> completeRecovery({
    required String email,
    required String code,
    required String newPassword,
    String pin = '',
  }) =>
      _client.post('/recovery/complete', authenticated: false, body: {
        'email': email.trim(),
        'code': code.trim(),
        'newPassword': newPassword,
        if (pin.isNotEmpty) 'pin': pin,
      });

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
    if (deviceId == _deviceId) await _clearSession();
  }



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

  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    try {
      return await _client.request(
        method,
        path,
        body: body,
        authenticated: authenticated,
      );
    } on ApiException catch (error) {
      if (!authenticated || error.statusCode != 401 || _refreshToken == null) {
        rethrow;
      }
      await _refreshOnce();
      return _client.request(method, path, body: body, authenticated: true);
    }
  }

  /// Uploads ciphertext bytes using the backend's short-lived signed PUT URL.
  /// Encryption must happen in the native MLS layer before this method is called.
  Future<void> uploadCiphertext(String signedUrl, Uint8List ciphertext) =>
      _client.putBytes(signedUrl, ciphertext);

  /// Downloads an authenticated file URL and retries once after session rotation.
  /// The URL is same-origin and device-bound by the canonical backend.
  Future<Uint8List> downloadBytes(String signedUrl) async {
    try {
      return await _client.getBytes(signedUrl);
    } on ApiException catch (error) {
      if (error.statusCode != 401 || _refreshToken == null) rethrow;
      await _refreshOnce();
      return _client.getBytes(signedUrl);
    }
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
      await _clearSession();
      throw const ApiException(code: 'session_expired', statusCode: 401, retryable: false);
    }
    try {
      final result = await _client.post(
        '/token/refresh',
        authenticated: false,
        body: {'refreshToken': current},
      );
      await _acceptSession(result);
    } on ApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await _clearSession();
      }
      rethrow;
    }
  }

  Future<void> _acceptSession(Map<String, dynamic> result) async {
    final access = result['token'];
    final refresh = result['refreshToken'];
    if (access is String && access.isNotEmpty && refresh is String && refresh.isNotEmpty) {
      await _storage.write(key: _refreshTokenKey, value: refresh);
      _accessToken = access;
      _refreshToken = refresh;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    try {
      if (isAuthenticated) await request('POST', '/logout');
    } finally {
      await _clearSession();
    }
  }

  Future<void> _clearSession() async {
    _accessToken = null;
    _refreshToken = null;
    await _storage.delete(key: _refreshTokenKey);
    notifyListeners();
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }
}
