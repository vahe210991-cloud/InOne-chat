import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../network/api_client.dart';
import '../network/api_exception.dart';

/// Mobile session owner for the pre-native-MLS integration phase.
///
/// Access and refresh tokens stay in memory. Only the stable, non-secret
/// device identifier is stored in Keychain/Android Keystore. When the native
/// MLS bridge becomes the refresh-token owner, rotation must move there.
class InOneSession extends ChangeNotifier {
  InOneSession({required this.baseUrl});

  static const _deviceIdKey = 'inone.device_id';
  static const _storage = FlutterSecureStorage();

  final String baseUrl;
  String? _accessToken;
  String? _refreshToken;
  String? _deviceId;
  Future<void>? _refreshInFlight;

  late final ApiClient _client = ApiClient(
    baseUrl: baseUrl,
    accessTokenProvider: () => _accessToken,
  );

  String? get deviceId => _deviceId;
  bool get isAuthenticated => _accessToken != null && _accessToken!.isNotEmpty;
  bool get isConfigured => baseUrl.trim().isNotEmpty;

  Future<void> initialize() async {
    if (_deviceId != null) return;
    var id = await _storage.read(key: _deviceIdKey);
    if (id == null || id.isEmpty) {
      final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
      id = base64UrlEncode(bytes).replaceAll('=', '');
      await _storage.write(key: _deviceIdKey, value: id);
    }
    _deviceId = id;
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
        'label': 'InOne mobile client',
        'platform': platform,
      },
    );
    _acceptSession(result);
    return result;
  }

  Future<Map<String, dynamic>> startEmailRegistration(String email) =>
      _client.post('/register/email', authenticated: false, body: {'email': email.trim()});

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
      throw const ApiException(code: 'session_expired', statusCode: 401, retryable: false);
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
    if (access is String && access.isNotEmpty && refresh is String && refresh.isNotEmpty) {
      _accessToken = access;
      _refreshToken = refresh;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    try {
      if (isAuthenticated) await request('POST', '/logout');
    } finally {
      _clearSession();
    }
  }

  void _clearSession() {
    _accessToken = null;
    _refreshToken = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }
}
