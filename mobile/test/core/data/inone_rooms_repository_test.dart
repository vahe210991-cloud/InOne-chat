import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_repositories.dart';
import 'package:inone_mobile/core/data/inone_room.dart';
import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('requests the authenticated rooms route and parses its response',
      () async {
    final session = _RoomsSession({
      'rooms': [
        {
          'roomId': 'room-1',
          'kind': 'group',
          'name': 'Engineering',
          'role': 'admin',
        },
      ],
    });

    final rooms = await InOneRepositories(session).myRooms();

    expect(session.method, 'GET');
    expect(session.path, '/rooms/mine');
    expect(session.authenticated, isTrue);
    expect(rooms, hasLength(1));
    expect(rooms.single, isA<InOneRoom>());
    expect(rooms.single.displayName, 'Engineering');
    expect(rooms.single.role, 'admin');
    session.dispose();
  });

  test('propagates unauthorized response for the room list', () async {
    final session = _RoomsSession(
      const {},
      error: const ApiException(
        code: 'unauthorized',
        statusCode: 401,
        retryable: false,
      ),
    );

    await expectLater(
      InOneRepositories(session).myRooms(),
      throwsA(isA<ApiException>().having(
        (error) => error.statusCode,
        'statusCode',
        401,
      )),
    );
    session.dispose();
  });

  test('rejects a successful response with an invalid rooms shape', () async {
    final session = _RoomsSession({'rooms': 'not-a-list'});

    await expectLater(
      InOneRepositories(session).myRooms(),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
    session.dispose();
  });
}

class _RoomsSession extends InOneSession {
  _RoomsSession(this.response, {this.error})
      : super(baseUrl: 'https://api.inone.test');

  final Map<String, dynamic> response;
  final ApiException? error;
  String? method;
  String? path;
  bool? authenticated;

  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    this.method = method;
    this.path = path;
    this.authenticated = authenticated;
    if (error != null) throw error!;
    return response;
  }
}
