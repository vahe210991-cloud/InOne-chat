import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/chats_screen.dart';
import 'package:inone_mobile/core/data/inone_repositories.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  testWidgets('CH-01 loads the authenticated room list from the repository',
      (tester) async {
    final session = _RoomsSession();
    await tester.pumpWidget(MaterialApp(
      home: InOneChatsScreen(
        repositories: InOneRepositories(session),
        session: session,
      ),
    ));
    await tester.pumpAndSettle();

    expect(session.requestedMethod, 'GET');
    expect(session.requestedPath, '/rooms/mine');
    expect(find.text('Подрядчики — объект Сочи'), findsOneWidget);
    expect(find.text('Группа · Владелец'), findsOneWidget);
    expect(find.text('Новости компании'), findsOneWidget);

    session.dispose();
  });

  testWidgets('chat search opens a full-screen page and filters room names',
      (tester) async {
    final session = _RoomsSession();
    await tester.pumpWidget(MaterialApp(
      home: InOneChatsScreen(
        repositories: InOneRepositories(session),
        session: session,
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Поиск по чатам'));
    await tester.pumpAndSettle();
    expect(find.text('Отмена'), findsOneWidget);

    await tester.enterText(
      find.byType(TextField),
      'Новости',
    );
    await tester.pumpAndSettle();

    expect(find.text('Новости компании'), findsOneWidget);
    expect(find.text('Подрядчики — объект Сочи'), findsNothing);
    session.dispose();
  });
}

class _RoomsSession extends InOneSession {
  _RoomsSession() : super(baseUrl: 'https://api.inone.test');

  String? requestedMethod;
  String? requestedPath;

  @override
  bool get isAuthenticated => true;

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    requestedMethod = method;
    requestedPath = path;
    return {
      'rooms': [
        {
          'roomId': 'room-contractors',
          'kind': 'group',
          'name': 'Подрядчики — объект Сочи',
          'role': 'owner',
        },
        {
          'roomId': 'room-news',
          'kind': 'channel',
          'name': 'Новости компании',
          'role': 'member',
        },
      ],
    };
  }
}
