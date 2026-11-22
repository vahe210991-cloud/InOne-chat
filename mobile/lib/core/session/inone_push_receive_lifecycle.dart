import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';

/// A validated, relative InOne room/event route from a generic push payload.
class InOnePushRoute {
  const InOnePushRoute({required this.roomId, required this.eventId});

  final String roomId;
  final String eventId;

  static InOnePushRoute? parse(Map<String, dynamic> data) {
    if (data.length != 3 ||
        data['type'] != 'message' ||
        data['event_id'] is! String ||
        data['path'] is! String) {
      return null;
    }
    final eventId = data['event_id'] as String;
    final rawPath = data['path'] as String;
    if (eventId.isEmpty || eventId.length > 128 ||
        eventId.contains('/') || eventId.contains('\\') || RegExp(r'[\x00-\x1f\x7f]').hasMatch(eventId)) {
      return null;
    }

    final uri = Uri.tryParse(rawPath);
    if (uri == null ||
        uri.hasScheme ||
        uri.hasAuthority ||
        uri.hasQuery ||
        uri.hasFragment ||
        !rawPath.startsWith('/rooms/')) {
      return null;
    }
    final segments = uri.pathSegments;
    if (segments.length != 4 ||
        segments[0] != 'rooms' ||
        segments[2] != 'events') {
      return null;
    }
    final roomId = segments[1];
    final pathEventId = segments[3];
    if (roomId.isEmpty ||
        roomId.length > 512 ||
        roomId == '.' ||
        roomId == '..' ||
        roomId.contains('/') || roomId.contains('\\') || RegExp(r'[\x00-\x1f\x7f]').hasMatch(roomId) ||
        pathEventId != eventId) {
      return null;
    }
    return InOnePushRoute(roomId: roomId, eventId: eventId);
  }

  @override
  bool operator ==(Object other) =>
      other is InOnePushRoute &&
      other.roomId == roomId &&
      other.eventId == eventId;

  @override
  int get hashCode => Object.hash(roomId, eventId);
}


/// A small FIFO for opened notification routes. Duplicate routes are ignored;
/// completing one route never discards a newer route received while it runs.
class InOnePushRouteQueue {
  InOnePushRouteQueue({this.maxLength = 128});

  final int maxLength;
  final List<InOnePushRoute> _routes = <InOnePushRoute>[];

  InOnePushRoute? get next => _routes.isEmpty ? null : _routes.first;

  bool enqueue(InOnePushRoute route) {
    if (_routes.contains(route)) return false;
    _routes.add(route);
    if (_routes.length > maxLength) _routes.removeAt(0);
    return true;
  }

  bool complete(InOnePushRoute route) => _routes.remove(route);

  void clear() => _routes.clear();
}

/// Owns Firebase foreground/tap/terminated receive subscriptions. It never
/// fetches room data or decrypts a message; the authenticated app session does.
class InOnePushReceiveLifecycle {
  InOnePushReceiveLifecycle({
    required Stream<RemoteMessage> foregroundMessages,
    required Stream<RemoteMessage> openedMessages,
    required Future<RemoteMessage?> Function() getInitialMessage,
    required this.onForeground,
    required this.onOpen,
  })  : _foregroundMessages = foregroundMessages,
        _openedMessages = openedMessages,
        _getInitialMessage = getInitialMessage;

  factory InOnePushReceiveLifecycle.firebase({
    required void Function(InOnePushRoute route) onForeground,
    required Future<void> Function(InOnePushRoute route) onOpen,
  }) =>
      InOnePushReceiveLifecycle(
        foregroundMessages: FirebaseMessaging.onMessage,
        openedMessages: FirebaseMessaging.onMessageOpenedApp,
        getInitialMessage: FirebaseMessaging.instance.getInitialMessage,
        onForeground: onForeground,
        onOpen: onOpen,
      );

  final Stream<RemoteMessage> _foregroundMessages;
  final Stream<RemoteMessage> _openedMessages;
  final Future<RemoteMessage?> Function() _getInitialMessage;
  final void Function(InOnePushRoute route) onForeground;
  final Future<void> Function(InOnePushRoute route) onOpen;

  StreamSubscription<RemoteMessage>? _foregroundSubscription;
  StreamSubscription<RemoteMessage>? _openedSubscription;
  final Set<InOnePushRoute> _openedRoutes = <InOnePushRoute>{};
  bool _started = false;
  bool _disposed = false;

  Future<void> start() async {
    if (_started || _disposed) return;
    _started = true;
    _foregroundSubscription = _foregroundMessages.listen(
      _onForeground,
      onError: (Object _) {},
    );
    _openedSubscription = _openedMessages.listen(
      (message) => unawaited(_onOpened(message)),
      onError: (Object _) {},
    );

    // Handles a notification that launched the app from a terminated state.
    final initial = await _getInitialMessage();
    if (!_disposed && initial != null) await _onOpened(initial);
  }

  void _onForeground(RemoteMessage message) {
    if (_disposed) return;
    final route = InOnePushRoute.parse(message.data);
    if (route != null) onForeground(route);
  }

  Future<void> _onOpened(RemoteMessage message) async {
    if (_disposed) return;
    final route = InOnePushRoute.parse(message.data);
    if (route == null || !_openedRoutes.add(route)) return;
    if (_openedRoutes.length > 128) _openedRoutes.remove(_openedRoutes.first);
    await onOpen(route);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _foregroundSubscription?.cancel();
    await _openedSubscription?.cancel();
    _foregroundSubscription = null;
    _openedSubscription = null;
    _openedRoutes.clear();
  }
}
