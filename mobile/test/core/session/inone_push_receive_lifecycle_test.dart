import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/session/inone_push_receive_lifecycle.dart';

void main() {
  test('parses only same-origin message routes with matching event IDs', () {
    final route = InOnePushRoute.parse({
      'type': 'message',
      'event_id': r'$17',
      'path': '/rooms/%21push%3Ainone.test/events/%2417',
    });
    expect(route, isNotNull);
    expect(route!.roomId, '!push:inone.test');
    expect(route.eventId, r'$17');

    expect(InOnePushRoute.parse({
      'type': 'message',
      'event_id': r'$17',
      'path': 'https://attacker.example/rooms/room/events/%2417',
    }), isNull);
    expect(InOnePushRoute.parse({
      'type': 'message',
      'event_id': r'$17',
      'path': '/rooms/room/events/%2418',
    }), isNull);
    expect(InOnePushRoute.parse({
      'type': 'message',
      'event_id': r'$17',
      'path': '/rooms/room/events/%2417?redirect=https://attacker.example',
    }), isNull);
    expect(InOnePushRoute.parse({
      'type': 'message',
      'event_id': r'$17',
      'path': '/rooms/room/events/%2417',
      'url': 'https://attacker.example',
    }), isNull);
  });

  test('routes foreground, opened and terminated notifications once', () async {
    final foreground = StreamController<RemoteMessage>();
    final opened = StreamController<RemoteMessage>();
    final route = InOnePushRoute(roomId: '!room:inone.test', eventId: r'$9');
    final message = RemoteMessage(data: {
      'type': 'message',
      'event_id': r'$9',
      'path': '/rooms/%21room%3Ainone.test/events/%249',
    });
    final foregroundRoutes = <InOnePushRoute>[];
    final openedRoutes = <InOnePushRoute>[];
    final lifecycle = InOnePushReceiveLifecycle(
      foregroundMessages: foreground.stream,
      openedMessages: opened.stream,
      getInitialMessage: () async => message,
      onForeground: foregroundRoutes.add,
      onOpen: (value) async => openedRoutes.add(value),
    );

    await lifecycle.start();
    expect(openedRoutes, [route]);
    foreground.add(message);
    opened.add(message);
    await Future<void>.delayed(Duration.zero);
    expect(foregroundRoutes, [route]);
    expect(openedRoutes, [route], 'initial and opened stream are deduplicated');

    await lifecycle.dispose();
    await foreground.close();
    await opened.close();
  });

  test('invalid messages never invoke navigation callbacks', () async {
    final foreground = StreamController<RemoteMessage>();
    final opened = StreamController<RemoteMessage>();
    var foregroundCount = 0;
    var openedCount = 0;
    final lifecycle = InOnePushReceiveLifecycle(
      foregroundMessages: foreground.stream,
      openedMessages: opened.stream,
      getInitialMessage: () async => null,
      onForeground: (_) => foregroundCount++,
      onOpen: (_) async => openedCount++,
    );
    await lifecycle.start();
    foreground.add(RemoteMessage(data: {'type': 'message', 'event_id': 'x', 'path': 'https://bad'}));
    opened.add(RemoteMessage(data: {'type': 'unknown', 'event_id': 'x', 'path': '/rooms/a/events/x'}));
    await Future<void>.delayed(Duration.zero);
    expect(foregroundCount, 0);
    expect(openedCount, 0);
    await lifecycle.dispose();
    await foreground.close();
    await opened.close();
  });
}
