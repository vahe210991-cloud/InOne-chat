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
/// refresh pair and persists only the rotating refresh token in platform secure storage.
/// After adoption, Rust is the only refresh-token owner.
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
    Future<String?> Function()? readRefreshToken,
    Future<void> Function(String)? writeRefreshToken,
    Future<void> Function()? deleteRefreshToken,
    Future<String?> Function()? readLocale,
    Future<void> Function(String)? writeLocale,
    Future<String?> Function()? readLocaleSyncPending,
    Future<void> Function(bool)? writeLocaleSyncPending,
  })  : _httpClient = httpClient,
        _nativeMlsBridge = nativeMlsBridge,
        _readDeviceId = readDeviceId ?? (() => _storage.read(key: _deviceIdKey)),
        _writeDeviceId = writeDeviceId ??
            ((value) => _storage.write(key: _deviceIdKey, value: value)),
        _readMlsUserId = readMlsUserId ?? (() => _storage.read(key: _mlsUserIdKey)),
        _writeMlsUserId = writeMlsUserId ??
            ((value) => _storage.write(key: _mlsUserIdKey, value: value)),
        _deleteMlsUserId = deleteMlsUserId ??
            (() => _storage.delete(key: _mlsUserIdKey)),
        _readRefreshToken = readRefreshToken ??
            (() => _storage.read(key: _refreshTokenKey)),
        _writeRefreshToken = writeRefreshToken ??
            ((value) => _storage.write(key: _refreshTokenKey, value: value)),
        _deleteRefreshToken = deleteRefreshToken ??
            (() => _storage.delete(key: _refreshTokenKey)),
        _readLocale = readLocale ?? (() => _storage.read(key: _localeKey)),
        _writeLocale = writeLocale ??
            ((value) => _storage.write(key: _localeKey, value: value)),
        _readLocaleSyncPending = readLocaleSyncPending ??
            (() => _storage.read(key: _localePendingKey)),
        _writeLocaleSyncPending = writeLocaleSyncPending ??
            ((value) => _storage.write(key: _localePendingKey, value: value ? 'true' : 'false'));

  static const _deviceIdKey = 'inone.device_id';
  static const _mlsUserIdKey = 'inone.mls_user_id';
  static const _refreshTokenKey = 'inone.refresh_token';
  static const _localeKey = 'inone.app_locale';
  static const _localePendingKey = 'inone.app_locale_pending';
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
  final Future<String?> Function() _readRefreshToken;
  final Future<void> Function(String) _writeRefreshToken;
  final Future<void> Function() _deleteRefreshToken;
  final Future<String?> Function() _readLocale;
  final Future<void> Function(String) _writeLocale;
  final Future<String?> Function() _readLocaleSyncPending;
  final Future<void> Function(bool) _writeLocaleSyncPending;

  String? _accessToken;
  String? _refreshToken;
  String? _deviceId;
  String? _userId;
  String? _savedMlsUserId;
  String? _registrationToken;
  String? _pendingApprovalId;
  String? _pendingApprovalPollSecret;
  String? _pendingApprovalCode;
  String _locale = 'hy';
  bool _localeSyncPending = false;
  bool _localeSyncInFlight = false;
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

  String get locale => _locale;
  String? get deviceId => _deviceId;
  String? get userId => _userId;
  bool get isAuthenticated => _accessToken != null && _accessToken!.isNotEmpty;
  bool get isConfigured => baseUrl.trim().isNotEmpty;
  bool get hasNativeMlsSession => _mlsBridge != null;
  String? get pendingApprovalCode => _pendingApprovalCode;
  bool get hasPendingApproval => _pendingApprovalId != null && _pendingApprovalPollSecret != null;
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
    final savedLocale = await _readLocale();
    _localeSyncPending = (await _readLocaleSyncPending()) == 'true';
    if (savedLocale != null && const ['hy', 'ru', 'en'].contains(savedLocale)) {
      _locale = savedLocale;
    }

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
    } else {
      final savedRefreshToken = await _readRefreshToken();
      if (savedRefreshToken != null && savedRefreshToken.isNotEmpty) {
        _refreshToken = savedRefreshToken;
        try {
          await _refreshOnce();
          final bridge = _nativeMlsBridge;
          if (bridge != null && isAuthenticated) {
            await adoptMlsSession(bridge);
          }
          _mlsError = null;
        } on ApiException catch (error) {
          _mlsError = error.statusCode == 401 || error.statusCode == 403
              ? null
              : 'Saved session could not be restored: ' + error.code;
        } catch (_) {
          _mlsError = 'Saved session could not be restored';
        }
      }
    }
    notifyListeners();
    if (isAuthenticated) await _syncLocaleAfterAuthentication();
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
    String? identityCode,
    String? identityChallengeId,
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
    final operation = _loginOnce(email: email, password: password, identityCode: identityCode, identityChallengeId: identityChallengeId);
    _loginInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_loginInFlight, operation)) _loginInFlight = null;
    });
  }

  Future<Map<String, dynamic>> _loginOnce({
    required String email,
    required String password,
    String? identityCode,
    String? identityChallengeId,
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
        if (identityCode != null && identityCode.trim().isNotEmpty)
          'identityCode': identityCode.trim(),
        if (identityChallengeId != null && identityChallengeId.trim().isNotEmpty)
          'identityChallengeId': identityChallengeId.trim(),
        if (_localeSyncPending) 'locale': _locale,
      },
    );
    _clearPendingApproval();
    if (result['status'] == 'approval_required') {
      final approvalId = result['approvalId'];
      final pollSecret = result['pollSecret'];
      final code = result['code'];
      if (approvalId is! String || approvalId.isEmpty ||
          pollSecret is! String || pollSecret.isEmpty ||
          code is! String || code.isEmpty) {
        throw const ApiException(
          code: 'invalid_device_approval_response',
          statusCode: 502,
          retryable: false,
        );
      }
      _pendingApprovalId = approvalId;
      _pendingApprovalPollSecret = pollSecret;
      _pendingApprovalCode = code;
    }
    final safeResult = Map<String, dynamic>.from(result)
      ..remove('token')
      ..remove('refreshToken')
      ..remove('code')
      ..remove('pollSecret')
      ..remove('approvalId');
    await _acceptSession(result);
    // The login endpoint applies a pending local language choice before it can queue
    // identity-check or new-device security mail. Clear the pending marker only when
    // the server actually issued an authenticated session.
    if (_localeSyncPending && isAuthenticated) {
      await _writeLocaleSyncPending(false);
      _localeSyncPending = false;
    }
    // Do not return or display access/refresh tokens or device-approval
    // secrets to callers such as the API test panel.
    result['token'] = null;
    result['refreshToken'] = null;
    result['code'] = null;
    result['pollSecret'] = null;
    result['approvalId'] = null;
    final native = _nativeMlsBridge;
    if (native != null && isAuthenticated) {
      try {
        await adoptMlsSession(native);
      } catch (error) {
        _mlsError = 'MLS runtime could not be opened: $error';
        notifyListeners();
        // A mobile login is not usable until Rust has accepted ownership of
        // the refresh token. Never continue with Dart-side token rotation.
        rethrow;
      }
    }
    await _syncLocaleAfterAuthentication();
    return safeResult;
  }

  /// Drops the in-memory challenge when the user leaves the approval screen.
  /// The server-side request remains pending until its short expiry or owner denial.
  void discardPendingApproval() => _clearPendingApproval();

  /// Claims the one-time approval result on the device that initiated login.
  /// The poll secret never leaves this session object.
  Future<Map<String, dynamic>> claimPendingApproval() async {
    await initialize();
    final id = _pendingApprovalId;
    final pollSecret = _pendingApprovalPollSecret;
    if (id == null || pollSecret == null) {
      throw const ApiException(
        code: 'device_approval_not_pending',
        statusCode: 409,
        retryable: false,
      );
    }
    final result = await _client.post(
      '/approvals/${Uri.encodeComponent(id)}/claim',
      authenticated: false,
      body: {'pollSecret': pollSecret},
    );
    try {
      final status = result['status'];
      if (status == 'pending') return const {'status': 'pending'};
      if (status == 'denied' || status == 'expired') {
        _clearPendingApproval();
        return {'status': status as String};
      }
      if (status != 'approved') {
        throw const ApiException(
          code: 'invalid_device_approval_status',
          statusCode: 502,
          retryable: false,
        );
      }
      _acceptSession(result);
      _clearPendingApproval();
      if (!isAuthenticated) {
        throw const ApiException(
          code: 'invalid_device_approval_session',
          statusCode: 502,
          retryable: false,
        );
      }
      final native = _nativeMlsBridge;
      if (native != null) {
        try {
          await adoptMlsSession(native);
        } catch (error) {
          _mlsError = 'MLS runtime could not be opened after device approval: $error';
          notifyListeners();
          rethrow;
        }
      }
      await _syncLocaleAfterAuthentication();
      return const {'status': 'approved'};
    } finally {
      result['token'] = null;
      result['refreshToken'] = null;
      result['pollSecret'] = null;
      result['approvalId'] = null;
    }
  }

  /// Pending requests visible to the currently authenticated trusted device.
  Future<List<Map<String, dynamic>>> pendingDeviceApprovals() async {
    final result = await request('GET', '/approvals');
    final raw = result['approvals'];
    if (raw is! List) {
      throw const ApiException(
        code: 'invalid_device_approvals_response',
        statusCode: 502,
        retryable: false,
      );
    }
    final approvals = <Map<String, dynamic>>[];
    for (final item in raw) {
      if (item is! Map) {
        throw const ApiException(
          code: 'invalid_device_approval_item',
          statusCode: 502,
          retryable: false,
        );
      }
      final id = item['id'];
      final label = item['label'];
      final platform = item['platform'];
      final createdAt = item['createdAt'];
      final expiresAt = item['expiresAt'];
      if (id is! String || id.isEmpty ||
          (label != null && label is! String) ||
          (platform != null && platform is! String) ||
          createdAt is! String || expiresAt is! String) {
        throw const ApiException(
          code: 'invalid_device_approval_item',
          statusCode: 502,
          retryable: false,
        );
      }
      approvals.add({
        'id': id,
        'label': label,
        'platform': platform,
        'createdAt': createdAt,
        'expiresAt': expiresAt,
      });
    }
    return approvals;
  }

  Future<void> approvePendingDevice({
    required String approvalId,
    required String code,
    String? bioGrant,
  }) async {
    final id = approvalId.trim();
    final normalizedCode = code.trim();
    if (id.isEmpty || normalizedCode.isEmpty) {
      throw const ApiException(
        code: 'device_approval_input_required',
        statusCode: 400,
        retryable: false,
      );
    }
    await request(
      'POST',
      '/approvals/${Uri.encodeComponent(id)}/approve',
      body: {
        'code': normalizedCode,
        if (bioGrant != null && bioGrant.isNotEmpty) 'bioGrant': bioGrant,
      },
    );
  }

  Future<void> denyPendingDevice({required String approvalId}) async {
    final id = approvalId.trim();
    if (id.isEmpty) {
      throw const ApiException(
        code: 'device_approval_id_required',
        statusCode: 400,
        retryable: false,
      );
    }
    await request(
      'POST',
      '/approvals/${Uri.encodeComponent(id)}/deny',
      body: const <String, dynamic>{},
    );
  }

  Future<void> setLocale(String locale) async {
    if (!const ['hy', 'ru', 'en'].contains(locale)) {
      throw ArgumentError.value(locale, 'locale', 'Supported locales: hy, ru, en');
    }
    await initialize();
    // Serialize a language change after an in-flight login so its security emails
    // use the locale selected when that login request was sent, then persist the
    // newer choice for subsequent account events.
    final activeLogin = _loginInFlight;
    if (activeLogin != null) await activeLogin;
    if (isAuthenticated) {
      final result = await request('PATCH', '/profile/locale', body: {'locale': locale});
      if (result['locale'] != locale) {
        throw const ApiException(code: 'locale_update_failed', statusCode: 502, retryable: true);
      }
      await _writeLocale(locale);
      await _writeLocaleSyncPending(false);
      _localeSyncPending = false;
    } else {
      await _writeLocale(locale);
      await _writeLocaleSyncPending(true);
      _localeSyncPending = true;
    }
    _locale = locale;
    notifyListeners();
  }

  Future<void> _syncLocaleAfterAuthentication() async {
    if (!isAuthenticated || _localeSyncInFlight) return;
    _localeSyncInFlight = true;
    try {
      if (_localeSyncPending) {
        final updated = await request('PATCH', '/profile/locale', body: {'locale': _locale});
        if (updated['locale'] != _locale) {
          throw const ApiException(code: 'locale_update_failed', statusCode: 502, retryable: true);
        }
        await _writeLocaleSyncPending(false);
        _localeSyncPending = false;
      } else {
        final profile = await request('GET', '/profile');
        final saved = profile['locale'];
        if (saved is String && const ['hy', 'ru', 'en'].contains(saved)) {
          _locale = saved;
          await _writeLocale(saved);
          notifyListeners();
        }
      }
    } catch (_) {
      // A pending language change must be synchronized before authenticated actions
      // can trigger account emails. Keep the pending marker and fail closed.
      if (_localeSyncPending) rethrow;
      // A profile read failure does not invalidate an otherwise established session.
    } finally {
      _localeSyncInFlight = false;
    }
  }

  Future<Map<String, dynamic>> startEmailRegistration(String email) async {
    await initialize();
    _registrationToken = null;
    return _client.post(
      '/register/email',
      authenticated: false,
      body: {'email': email.trim(), 'locale': _locale},
    );
  }

  Future<Map<String, dynamic>> startRecovery({required String email}) async {
    await initialize();
    return request(
      'POST',
      '/recovery/start',
      authenticated: false,
      body: {'email': email.trim(), 'locale': _locale},
    );
  }

  /// Confirms the one-time recovery link after an explicit user tap in the app.
  /// The GET preview endpoint never mutates recovery state.
  Future<Map<String, dynamic>> confirmRecoveryLink({
    required String userId,
    required String token,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty || normalizedUserId.length > 256 ||
        token.isEmpty || token.length > 1024) {
      throw const ApiException(
        code: 'invalid_recovery_link',
        statusCode: 400,
        retryable: false,
      );
    }
    return _client.post(
      '/recovery/confirm',
      authenticated: false,
      body: {'user': normalizedUserId, 'token': token},
    );
  }

  Future<Map<String, dynamic>> cancelRecoveryByCode({
    required String email,
    required String code,
  }) async {
    await initialize();
    return request(
      'POST',
      '/recovery/cancel-by-code',
      authenticated: false,
      body: {'email': email.trim(), 'code': code.trim(), 'locale': _locale},
    );
  }

  /// Cancels a pending 48-hour admission for a new device.
  /// This is deliberately separate from recovery cancellation.
  Future<Map<String, dynamic>> cancelAdmissionByCode({
    required String email,
    required String code,
  }) async {
    await initialize();
    final normalizedEmail = email.trim();
    final normalizedCode = code.trim();
    if (normalizedEmail.isEmpty || normalizedCode.isEmpty) {
      throw const ApiException(
        code: 'admission_cancellation_input_required',
        statusCode: 400,
        retryable: false,
      );
    }
    return _client.post(
      '/admission/cancel',
      authenticated: false,
      body: {'email': normalizedEmail, 'code': normalizedCode},
    );
  }

  Future<Map<String, dynamic>> completeRecovery({
    String email = '',
    String? userId,
    required String code,
    required String newPassword,
    required String pin,
  }) async {
    await initialize();
    final normalizedEmail = email.trim();
    final normalizedUserId = userId?.trim() ?? '';
    if (normalizedEmail.isEmpty && normalizedUserId.isEmpty) {
      throw const ApiException(
        code: 'recovery_identity_required',
        statusCode: 400,
        retryable: false,
      );
    }
    return request(
      'POST',
      '/recovery/complete',
      authenticated: false,
      body: {
        if (normalizedUserId.isNotEmpty)
          'userId': normalizedUserId
        else
          'email': normalizedEmail,
        'code': code.trim(),
        'newPassword': newPassword,
        'pin': pin,
        'locale': _locale,
      },
    );
  }

  Future<Map<String, dynamic>> confirmEmailRegistration({
    required String email,
    required String code,
  }) async {
    final result = await _client.post(
      '/register/email/confirm',
      authenticated: false,
      body: {'email': email.trim(), 'code': code.trim()},
    );
    final token = result['registrationToken'];
    if (token is! String || token.isEmpty) {
      _registrationToken = null;
      throw const ApiException(
        code: 'invalid_registration_confirmation',
        statusCode: 502,
        retryable: false,
      );
    }
    // The one-time registration ticket is host-only and never returned to WebView.
    _registrationToken = token;
    return const <String, dynamic>{'ok': true};
  }

  Future<Map<String, dynamic>> registerAccount({
    required String email,
    required String password,
    required String nickname,
    required String pin,
    required String pinConfirmation,
    String? phone,
  }) async {
    final token = _registrationToken;
    if (token == null || token.isEmpty) {
      throw const ApiException(
        code: 'registration_confirmation_required',
        statusCode: 409,
        retryable: false,
      );
    }
    try {
      final result = await _client.post(
        '/register',
        authenticated: false,
        body: {
          'email': email.trim(),
          'registrationToken': token,
          'password': password,
          'nickname': nickname.trim(),
          'pin': pin,
          'pinConfirmation': pinConfirmation,
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
        },
      );
      _registrationToken = null;
      // Beta 1.0 owner decision D11: successful registration proceeds to an
      // authenticated session. The registration endpoint itself returns no
      // access token, so authenticate through the normal login flow.
      await login(email: email, password: password);
      return <String, dynamic>{
        'ok': true,
        'userId': result['userId'],
        'nickname': result['nickname'],
        'verificationLevel': result['verificationLevel'],
      };
    } catch (_) {
      // A failed registration POST leaves the ticket available for retry. Once
      // the server accepts registration, the ticket is consumed before login.
      rethrow;
    }
  }

  Future<Map<String, dynamic>> pinStatus() =>
      request('GET', '/pin/status');

  Future<Map<String, dynamic>> verifyRecoveryPin(String pin) =>
      request('POST', '/pin/verify', body: {'pin': pin});

  Future<Map<String, dynamic>> acknowledgePinReminder() =>
      request('POST', '/pin/reminder/ack');

  Future<Map<String, dynamic>> startPinReset({String password = ''}) =>
      request('POST', '/pin/reset/start', body: {
        if (password.isNotEmpty) 'password': password,
      });

  Future<Map<String, dynamic>> completePinReset({
    required String challengeId,
    required String code,
    required String pin,
    required String pinConfirmation,
  }) =>
      request('POST', '/pin/reset/complete', body: {
        'challengeId': challengeId,
        'code': code.trim(),
        'pin': pin,
        'pinConfirmation': pinConfirmation,
      });

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
      // Rust now owns refresh-token rotation. Clear the Dart copy immediately
      // after open succeeds, before requesting the access-token snapshot.
      _mlsBridge = target;
      // Rust has accepted ownership; remove the temporary Dart secure-storage copy.
      await _deleteRefreshToken();
      _refreshToken = null;
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
      _mlsError = null;
      notifyListeners();
    } catch (_) {
      if (nativeOpened) {
        try {
          await target.logout();
        } catch (_) {
          // Fall back to the ordinary API logout below if Rust could not confirm it.
          try {
            if (isAuthenticated) await _client.post('/logout');
          } catch (_) {
            // Credentials are still cleared locally below.
          }
        }
      } else {
        try {
          await target.close();
        } catch (_) {
          // Preserve the original handoff error.
        }
        try {
          if (isAuthenticated) await _client.post('/logout');
        } catch (_) {
          // Credentials are still cleared locally below.
        }
      }
      _mlsBridge = null;
      _savedMlsUserId = null;
      try {
        await _deleteMlsUserId();
      } catch (_) {
        // Never keep a resumable identity after an incomplete handoff.
      }
      await _clearSession();
      rethrow;
    } finally {
      _handoffGate = null;
      if (!gate.isCompleted) gate.complete();
    }
  }

  Future<http.Response> download(
    String path, {
    bool authenticated = true,
  }) async {
    if (_loggingOut) {
      throw const ApiException(code: 'session_logging_out', statusCode: 409, retryable: false);
    }
    if (authenticated && _localeSyncPending && path != '/profile/locale') {
      await _syncLocaleAfterAuthentication();
      if (_localeSyncPending) {
        throw const ApiException(code: 'locale_sync_pending', statusCode: 503, retryable: true);
      }
    }
    final gate = _handoffGate;
    if (gate != null) await gate.future;
    try {
      return await _client.download(path, authenticated: authenticated);
    } on ApiException catch (error) {
      if (_loggingOut) {
        throw const ApiException(code: 'session_logging_out', statusCode: 409, retryable: false);
      }
      if (!authenticated || error.statusCode != 401) rethrow;
      final native = _mlsBridge;
      if (native != null) {
        final token = await _refreshNativeOrInvalidate(native);
        _accessToken = token;
        notifyListeners();
        return _client.download(path, authenticated: true);
      }
      if (_refreshToken == null) rethrow;
      await _refreshOnce();
      return _client.download(path, authenticated: true);
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
    if (authenticated && _localeSyncPending && path != '/profile/locale') {
      await _syncLocaleAfterAuthentication();
      if (_localeSyncPending) {
        throw const ApiException(
          code: 'locale_sync_pending',
          statusCode: 503,
          retryable: true,
        );
      }
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
        final token = await _refreshNativeOrInvalidate(native);
        _accessToken = token;
        notifyListeners();
        return _client.request(method, path, body: body, authenticated: true);
      }

      if (_refreshToken == null) rethrow;
      await _refreshOnce();
      return _client.request(method, path, body: body, authenticated: true);
    }
  }

  Future<String> _refreshNativeOrInvalidate(MlsSessionBridge bridge) async {
    try {
      final token = await _refreshNativeOnce(bridge);
      if (token.isEmpty) {
        await _invalidateNativeSession(bridge);
        throw const ApiException(
          code: 'mls_session_missing_access_token',
          statusCode: 502,
          retryable: false,
        );
      }
      return token;
    } catch (error) {
      final revoked = RegExp(
        r'(?:\b401\b|unauthori[sz]ed|refresh.?token.*revok|session.*revok)',
        caseSensitive: false,
      ).hasMatch(error.toString());
      if (revoked) await _invalidateNativeSession(bridge);
      rethrow;
    }
  }

  Future<void> _invalidateNativeSession(MlsSessionBridge bridge) async {
    final userId = _savedMlsUserId ?? _userId;
    final deviceId = _deviceId;
    try {
      await bridge.logout();
    } catch (_) {
      // Rust logout performs local SQLCipher/key cleanup even if remote logout fails.
    } finally {
      if (userId != null && deviceId != null) {
        try {
          await bridge.purgeLocalSession(userId: userId, deviceId: deviceId);
        } catch (_) {
          // The persisted identity is still removed below so the app cannot resume it.
        }
      }
      try {
        await bridge.close();
      } catch (_) {
        // Preserve the original unauthorized refresh failure.
      }
      _mlsBridge = null;
      _savedMlsUserId = null;
      try {
        await _deleteMlsUserId();
      } catch (_) {
        // Do not restore an identity that the server has rejected.
      }
      await _clearSession();
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
      await _clearSession();
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
        await _acceptSession(result);
        if (!isAuthenticated || _refreshToken == null) {
          throw const ApiException(
            code: 'invalid_refresh_response',
            statusCode: 502,
            retryable: false,
          );
        }
      } catch (_) {
        await _clearSession();
        rethrow;
      } finally {
        result['token'] = null;
        result['refreshToken'] = null;
      }
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
    if (access is String &&
        access.isNotEmpty &&
        refresh is String &&
        refresh.isNotEmpty) {
      // Persist the rotated refresh token before exposing the new access token.
      await _writeRefreshToken(refresh);
      _accessToken = access;
      _refreshToken = refresh;
      notifyListeners();
    }
  }

  /// Returns the durable room recovery state reported by the native MLS client.
  Future<String?> mlsRoomRecoveryStatus(String roomId) async {
    final bridge = _mlsBridge;
    if (bridge == null) return null;
    return bridge.roomRecoveryStatus(roomId);
  }

  /// Synchronizes encrypted room events and processes them through the active native MLS client.
  Future<List<MlsIncomingMessage>> syncMlsMessages() async {
    final bridge = _mlsBridge;
    if (bridge == null) throw StateError('Native MLS session is not open');
    return bridge.sync();
  }

  /// Returns only messages already processed/decrypted by the native MLS client.
  Future<List<MlsIncomingMessage>> mlsMessagesForRoom(String roomId) async {
    final bridge = _mlsBridge;
    if (bridge == null) throw StateError('Native MLS session is not open');
    return bridge.messagesForRoom(roomId);
  }

  /// Reads durable SQLCipher history before acknowledging readable inbox items.
  Future<List<MlsIncomingMessage>> loadMlsRoomHistory(String roomId) async {
    _validateMlsRoomId(roomId);
    final bridge = _requireNativeMlsBridge();
    final messages = await bridge.messagesForRoom(roomId);
    final persistedEventIds = messages.map((message) => message.eventId).toSet();
    final pending = await bridge.pendingIncoming();
    final acceptedEventIds = pending
        .where((message) =>
            message.roomId == roomId &&
            message.isReadable &&
            persistedEventIds.contains(message.eventId))
        .map((message) => message.eventId)
        .toSet()
        .toList(growable: false);
    if (acceptedEventIds.isNotEmpty) {
      await bridge.acknowledgeIncoming(acceptedEventIds);
    }
    return messages;
  }

  /// Returns room IDs from the persistent SQLCipher-backed OpenMLS client.
  Future<List<String>> localMlsRoomIds() =>
      _requireNativeMlsBridge().localRoomIds();

  /// Returns persisted diagnostics for MLS events that could not be decrypted.
  Future<List<MlsUndecryptableEvent>> mlsUndecryptableEvents() async {
    final bridge = _mlsBridge;
    if (bridge == null) return const [];
    return bridge.undecryptable();
  }

  /// Resolves only an adopted persistent Rust bridge; there is no plaintext fallback.
  MlsSessionBridge _requireNativeMlsBridge() {
    final bridge = _mlsBridge;
    if (bridge == null) {
      throw const ApiException(
        code: 'native_mls_session_unavailable',
        statusCode: 503,
        retryable: false,
      );
    }
    return bridge;
  }

  void _validateMlsRoomId(String roomId) {
    if (roomId.trim().isEmpty || roomId.length > 255) {
      throw ArgumentError.value(roomId, 'roomId', 'A valid MLS room ID is required');
    }
  }

  /// Creates the server room and local OpenMLS group through the persistent Rust client.
  Future<void> createMlsRoom(String roomId) {
    _validateMlsRoomId(roomId);
    return _requireNativeMlsBridge().createRoom(roomId);
  }

  Future<void> ensureMlsKeyPackages(int target) {
    if (target < 1 || target > 100) {
      throw RangeError.range(target, 1, 100, 'target');
    }
    return _requireNativeMlsBridge().ensureKeyPackages(target);
  }

  Future<void> inviteMlsMember(String roomId, String userId) {
    _validateMlsRoomId(roomId);
    if (userId.trim().isEmpty || userId.length > 255) {
      throw ArgumentError.value(userId, 'userId', 'A valid user ID is required');
    }
    return _requireNativeMlsBridge().invite(roomId, userId);
  }

  /// Approves a pending join request only after native MLS Commit/Welcome ACK and sync.
  Future<void> approveMlsJoinRequest(String roomId, String userId) {
    _validateMlsRoomId(roomId);
    if (userId.trim().isEmpty || userId.length > 255) {
      throw ArgumentError.value(userId, 'userId', 'A valid user ID is required');
    }
    return _requireNativeMlsBridge().approveJoinRequest(roomId, userId);
  }

  /// Sends immediately through OpenMLS. For offline-safe UI submission use
  /// enqueueMlsText followed by flushMlsOutbox instead.
  Future<String> sendMlsText(String roomId, String plaintext) {
    _validateMlsRoomId(roomId);
    if (plaintext.trim().isEmpty) {
      throw ArgumentError.value(plaintext, 'plaintext', 'Message text cannot be empty');
    }
    return _requireNativeMlsBridge().sendText(roomId, plaintext);
  }

  /// Durably queues plaintext inside SQLCipher before attempting network delivery.
  Future<String> enqueueMlsText(String roomId, String plaintext) {
    _validateMlsRoomId(roomId);
    if (plaintext.trim().isEmpty) {
      throw ArgumentError.value(plaintext, 'plaintext', 'Message text cannot be empty');
    }
    return _requireNativeMlsBridge().enqueueText(roomId, plaintext);
  }

  Future<String> sendMlsAttachment(
    String roomId,
    String name,
    String mimeType,
    Uint8List plaintext,
    String clientMessageId,
  ) {
    _validateMlsRoomId(roomId);
    if (name.trim().isEmpty || mimeType.trim().isEmpty || plaintext.isEmpty) {
      throw ArgumentError('Attachment name, MIME type and bytes are required');
    }
    final validId = clientMessageId.isNotEmpty &&
        clientMessageId.length <= 60 &&
        clientMessageId.codeUnits.every((unit) =>
            (unit >= 48 && unit <= 57) ||
            (unit >= 65 && unit <= 90) ||
            (unit >= 97 && unit <= 122) ||
            unit == 45 ||
            unit == 95);
    if (!validId) {
      throw ArgumentError.value(
        clientMessageId,
        'clientMessageId',
        'A stable 1-60 character idempotency key is required',
      );
    }
    return _requireNativeMlsBridge().sendAttachmentWithId(
      roomId: roomId,
      name: name,
      mimeType: mimeType,
      plaintext: plaintext,
      clientMessageId: clientMessageId,
    );
  }

  Future<Uint8List> downloadMlsAttachment(String fileId) {
    if (fileId.trim().isEmpty || fileId.length > 128) {
      throw ArgumentError.value(fileId, 'fileId', 'A valid attachment ID is required');
    }
    return _requireNativeMlsBridge().downloadAttachment(fileId);
  }

  Future<List<MlsIncomingMessage>> pendingMlsMessages() =>
      _requireNativeMlsBridge().pendingIncoming();

  Future<List<MlsPendingOutboxItem>> pendingMlsOutbox(String roomId) {
    _validateMlsRoomId(roomId);
    return _requireNativeMlsBridge().pendingOutbox(roomId);
  }

  /// Call only after the app has accepted the already SQLCipher-persisted messages.
  Future<void> acknowledgeMlsMessages(List<String> eventIds) {
    if (eventIds.any((id) => id.trim().isEmpty || id.length > 128)) {
      throw ArgumentError.value(eventIds, 'eventIds', 'Invalid MLS event ID');
    }
    return _requireNativeMlsBridge().acknowledgeIncoming(eventIds);
  }

  Future<int> flushMlsOutbox() => _requireNativeMlsBridge().flushOutbox();

  Future<int> mlsOutboxLength() => _requireNativeMlsBridge().outboxLength();

  Future<int?> mlsLocalEpoch(String roomId) {
    _validateMlsRoomId(roomId);
    return _requireNativeMlsBridge().localEpoch(roomId);
  }

  Future<List<String>> mlsMembersOf(String roomId) {
    _validateMlsRoomId(roomId);
    return _requireNativeMlsBridge().membersOf(roomId);
  }

  /// Removes every device of an account from the MLS room via a native Commit.
  Future<void> removeMlsMember(String roomId, String userId) {
    _validateMlsRoomId(roomId);
    if (userId.trim().isEmpty || userId.length > 255) {
      throw ArgumentError.value(userId, 'userId', 'A valid user ID is required');
    }
    return _requireNativeMlsBridge().removeMember(roomId, userId);
  }

  Future<void> revokeMlsDevice(String deviceId) {
    if (deviceId.trim().isEmpty || deviceId.length > 255) {
      throw ArgumentError.value(deviceId, 'deviceId', 'A valid device ID is required');
    }
    return _requireNativeMlsBridge().revokeDevice(deviceId);
  }

  Future<int> removeRevokedMlsDevices() =>
      _requireNativeMlsBridge().removeRevokedDevices();

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
    _registrationToken = null;
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
        try {
          await _client.post('/logout');
        } on ApiException catch (error) {
          if (error.statusCode != 401 || _refreshToken == null) rethrow;
          // Access tokens can expire while the rotating refresh token is still valid.
          // Rotate once and retry logout so the server revokes the active device session.
          await _refreshOnce();
          await _client.post('/logout');
        }
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
          try {
            await _writeLocaleSyncPending(false);
          } catch (_) {
            // Locale preference remains local; logout must still clear credentials.
          }
          _localeSyncPending = false;
          await _clearSession();
        }
      }
    }
  }

  void _clearPendingApproval() {
    _pendingApprovalId = null;
    _pendingApprovalPollSecret = null;
    _pendingApprovalCode = null;
  }

  Future<void> _clearSession() async {
    try {
      await _deleteRefreshToken();
    } finally {
      _clearPendingApproval();
      _mlsError = null;
      _accessToken = null;
      _refreshToken = null;
      _userId = null;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    final bridge = _mlsBridge;
    if (bridge != null) unawaited(bridge.close());
    _client.close();
    super.dispose();
  }
}
