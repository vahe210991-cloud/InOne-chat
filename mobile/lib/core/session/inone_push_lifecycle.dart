import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';

import '../data/inone_push_repository.dart';
import 'inone_session.dart';

enum InOnePushAuthorizationStatus {
  authorized,
  provisional,
  denied,
  deniedPermanently,
  notDetermined,
}

abstract interface class InOnePushMessagingClient {
  Stream<String> get onRegistered;
  Stream<String> get onUnregistered;
  Future<InOnePushAuthorizationStatus> requestPermission();
  Future<void> register();
  Future<void> unregister();
  Future<String?> getApnsToken();
}

class FirebaseInOnePushMessagingClient implements InOnePushMessagingClient {
  FirebaseInOnePushMessagingClient(this.messaging);

  final FirebaseMessaging messaging;

  @override
  Stream<String> get onRegistered => messaging.onRegistered;

  @override
  Stream<String> get onUnregistered => messaging.onUnregistered;

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
      AuthorizationStatus.deniedPermanently =>
        InOnePushAuthorizationStatus.deniedPermanently,
      AuthorizationStatus.notDetermined =>
        InOnePushAuthorizationStatus.notDetermined,
    };
  }

  @override
  Future<void> register() => messaging.register();

  @override
  Future<void> unregister() => messaging.unregister();

  @override
  Future<String?> getApnsToken() => messaging.getAPNSToken();
}

/// Registers a Firebase Installation ID only after this device has an
/// authenticated InOne session and notification permission. FIDs are held in
/// memory only and sent through the authenticated current-device API.
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

  StreamSubscription<String>? _registeredSubscription;
  StreamSubscription<String>? _unregisteredSubscription;
  Completer<String>? _registrationWaiter;
  Future<void> _pending = Future<void>.value();
  bool _started = false;
  bool _suspending = false;
  bool _unregisteringFirebase = false;
  late bool _wasAuthenticated;

  void start() {
    if (_started) return;
    _started = true;
    _wasAuthenticated = _session.isAuthenticated;
    _session.addListener(_onSessionChanged);
    _registeredSubscription = _messaging.onRegistered.listen(
      _onRegistered,
      onError: (Object _) {},
    );
    _unregisteredSubscription = _messaging.onUnregistered.listen(
      _onUnregistered,
      onError: (Object _) {},
    );
    if (_wasAuthenticated) {
      unawaited(refreshRegistration().catchError((Object _) {}));
    }
  }

  void _onRegistered(String installationId) {
    if (installationId.isEmpty) return;
    final waiter = _registrationWaiter;
    if (waiter != null) {
      if (!waiter.isCompleted) waiter.complete(installationId);
      return;
    }
    if (_canRegister) {
      unawaited(
        _enqueue(() => _register(installationId)).catchError((Object _) {}),
      );
    }
  }

  void _onUnregistered(String _) {
    if (_unregisteringFirebase || !_canRegister) return;
    unawaited(_enqueue(_repository.unregister).catchError((Object _) {}));
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
    if (!_isPermitted(permission)) {
      await _removeRegistration();
      return;
    }
    if (_isApplePlatform && await _messaging.getApnsToken() == null) return;
    if (!_canRegister) return;
    final installationId = await _requestInstallationId();
    if (!_canRegister) return;
    await _repository.register(
      provider: InOnePushProvider.fcm,
      token: installationId,
    );
  }

  Future<void> _register(String installationId) async {
    if (installationId.isEmpty || !_canRegister) return;
    final permission = await _messaging.requestPermission();
    if (!_canRegister) return;
    if (!_isPermitted(permission)) {
      await _removeRegistration();
      return;
    }
    if (_isApplePlatform && await _messaging.getApnsToken() == null) return;
    if (!_canRegister) return;
    await _repository.register(
      provider: InOnePushProvider.fcm,
      token: installationId,
    );
  }

  Future<String> _requestInstallationId() async {
    final waiter = Completer<String>();
    _registrationWaiter = waiter;
    try {
      await _messaging.register();
      return await waiter.future.timeout(const Duration(seconds: 30));
    } finally {
      if (identical(_registrationWaiter, waiter)) {
        _registrationWaiter = null;
      }
    }
  }

  bool _isPermitted(InOnePushAuthorizationStatus status) =>
      status == InOnePushAuthorizationStatus.authorized ||
      status == InOnePushAuthorizationStatus.provisional;

  bool get _canRegister => _started && !_suspending && _session.isAuthenticated;

  Future<void> _unregisterFirebase() async {
    if (_unregisteringFirebase) return;
    _unregisteringFirebase = true;
    try {
      await _messaging.unregister();
    } finally {
      _unregisteringFirebase = false;
    }
  }

  Future<void> _removeRegistration() async {
    Object? firstError;
    StackTrace? firstStack;
    try {
      await _repository.unregister();
    } catch (error, stackTrace) {
      firstError = error;
      firstStack = stackTrace;
    }
    try {
      await _unregisterFirebase();
    } catch (error, stackTrace) {
      firstError ??= error;
      firstStack ??= stackTrace;
    }
    if (firstError != null) {
      Error.throwWithStackTrace(firstError, firstStack!);
    }
  }

  /// Removes the server association and FCM registration before logout while
  /// the bearer session is still valid. Server logout remains a cleanup fallback.
  Future<void> unregisterBeforeLogout() {
    if (!_started) return Future<void>.value();
    _suspending = true;
    return _enqueue(() async {
      if (_session.isAuthenticated) {
        await _removeRegistration();
      } else {
        await _unregisterFirebase();
      }
    });
  }

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
    unawaited(_registeredSubscription?.cancel());
    unawaited(_unregisteredSubscription?.cancel());
    _registeredSubscription = null;
    _unregisteredSubscription = null;
  }
}
