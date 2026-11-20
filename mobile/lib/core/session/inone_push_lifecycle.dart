import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';

import '../data/inone_push_repository.dart';
import 'inone_session.dart';

enum InOnePushAuthorizationStatus {
  authorized,
  provisional,
  denied,
  notDetermined,
}

abstract interface class InOnePushMessagingClient {
  Stream<String> get onTokenRefresh;
  Future<InOnePushAuthorizationStatus> requestPermission();
  Future<String?> getToken();
  Future<String?> getApnsToken();
}

class FirebaseInOnePushMessagingClient implements InOnePushMessagingClient {
  FirebaseInOnePushMessagingClient(this.messaging);

  final FirebaseMessaging messaging;

  @override
  Stream<String> get onTokenRefresh => messaging.onTokenRefresh;

  @override
  Future<InOnePushAuthorizationStatus> requestPermission() async {
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      announcement: false,
      carPlay: false,
      criticalAlert: false,
      provisional: false,
    );
    return switch (settings.authorizationStatus) {
      AuthorizationStatus.authorized => InOnePushAuthorizationStatus.authorized,
      AuthorizationStatus.provisional => InOnePushAuthorizationStatus.provisional,
      AuthorizationStatus.denied => InOnePushAuthorizationStatus.denied,
      AuthorizationStatus.notDetermined => InOnePushAuthorizationStatus.notDetermined,
    };
  }

  @override
  Future<String?> getToken() => messaging.getToken();

  @override
  Future<String?> getApnsToken() => messaging.getAPNSToken();
}

/// Synchronizes an FCM token only while this device has an authenticated session.
/// The token is sent directly to the authenticated API and is never persisted/logged.
class InOnePushLifecycle {
  InOnePushLifecycle({
    required InOneSession session,
    required InOnePushRepository repository,
    required InOnePushMessagingClient messaging,
    bool? isApplePlatform,
  })  : _session = session,
        _repository = repository,
        _messaging = messaging,
        _isApplePlatform = isApplePlatform ?? Platform.isIOS;

  factory InOnePushLifecycle.firebase({
    required InOneSession session,
    required InOnePushRepository repository,
  }) =>
      InOnePushLifecycle(
        session: session,
        repository: repository,
        messaging: FirebaseInOnePushMessagingClient(FirebaseMessaging.instance),
      );

  final InOneSession _session;
  final InOnePushRepository _repository;
  final InOnePushMessagingClient _messaging;
  final bool _isApplePlatform;

  StreamSubscription<String>? _tokenSubscription;
  Future<void> _pending = Future<void>.value();
  bool _started = false;
  bool _suspending = false;
  late bool _wasAuthenticated;

  void start() {
    if (_started) return;
    _started = true;
    _wasAuthenticated = _session.isAuthenticated;
    _session.addListener(_onSessionChanged);
    _tokenSubscription = _messaging.onTokenRefresh.listen(
      (token) {
        if (token.isEmpty) return;
        unawaited(_enqueue(() => _register(token)).catchError((Object _) {}));
      },
      onError: (Object _) {},
    );
    if (_wasAuthenticated) {
      unawaited(refreshRegistration().catchError((Object _) {}));
    }
  }

  void _onSessionChanged() {
    if (!_started) return;
    final authenticated = _session.isAuthenticated;
    if (!authenticated && _wasAuthenticated) _suspending = false;
    if (authenticated && !_wasAuthenticated) {
      unawaited(refreshRegistration().catchError((Object _) {}));
    }
    _wasAuthenticated = authenticated;
  }

  Future<void> refreshRegistration() {
    if (!_started || _suspending || !_session.isAuthenticated) {
      return Future<void>.value();
    }
    return _enqueue(_refreshRegistration);
  }

  Future<void> _refreshRegistration() async {
    if (!_canRegister) return;
    final permission = await _messaging.requestPermission();
    if (!_canRegister) return;
    final permitted = permission == InOnePushAuthorizationStatus.authorized ||
        permission == InOnePushAuthorizationStatus.provisional;
    if (!permitted) {
      await _repository.unregister();
      return;
    }

    // On Apple platforms APNs registration must exist before requesting FCM.
    // App resume and subsequent token-refresh events provide retry opportunities.
    if (_isApplePlatform && await _messaging.getApnsToken() == null) return;
    if (!_canRegister) return;
    final token = await _messaging.getToken();
    if (token == null || token.isEmpty || !_canRegister) return;
    await _repository.register(provider: InOnePushProvider.fcm, token: token);
  }

  bool get _canRegister => _started && !_suspending && _session.isAuthenticated;

  /// Runs before logout, while DELETE still has a valid bearer session.
  Future<void> unregisterBeforeLogout() {
    if (!_started) return Future<void>.value();
    _suspending = true;
    return _enqueue(() async {
      if (_session.isAuthenticated) await _repository.unregister();
    });
  }

  /// Lets lifecycle tests wait until session/token callbacks have settled.
  Future<void> waitForPendingOperations() => _pending;

  Future<void> _enqueue(Future<void> Function() operation) {
    final result = _pending.then((_) => operation());
    _pending = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {},
    );
    return result;
  }

  void dispose() {
    if (!_started) return;
    _started = false;
    _session.removeListener(_onSessionChanged);
    unawaited(_tokenSubscription?.cancel());
    _tokenSubscription = null;
  }
}
