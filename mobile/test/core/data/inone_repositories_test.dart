import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_profile.dart';
import 'package:inone_mobile/core/data/inone_room.dart';
import 'package:inone_mobile/core/data/inone_repositories.dart';
import 'package:inone_mobile/core/network/api_exception.dart';
import 'package:inone_mobile/core/session/inone_session.dart';

void main() {
  test('requests the authenticated profile route and parses its response',
      () async {
    final session = _ProfileSession({
      'userId': 'user-1',
      'nickname': 'Test User',
      'email': 'user@example.test',
      'verificationLevel': 1,
      'providers': [],
      'backupEmail': null,
      'securityHints': ['no_backup_email'],
    });

    final profile = await InOneRepositories(session).profile();

    expect(session.method, 'GET');
    expect(session.path, '/profile');
    expect(session.authenticated, isTrue);
    expect(profile, isA<InOneProfile>());
    expect(profile.nickname, 'Test User');
    expect(profile.verificationLevel, 1);
    session.dispose();
  });


  test('requests authenticated rooms and parses the verified room DTO', () async {
    final session = _ProfileSession({
      'rooms': [
        {
          'roomId': 'room-1',
          'kind': 'group',
          'name': 'Project room',
          'role': 'member',
        },
      ],
    });

    final rooms = await InOneRepositories(session).myRooms();

    expect(session.method, 'GET');
    expect(session.path, '/rooms/mine');
    expect(session.authenticated, isTrue);
    expect(rooms, isA<InOneRoomList>());
    expect(rooms.rooms, hasLength(1));
    expect(rooms.rooms.single.roomId, 'room-1');
    expect(rooms.rooms.single.kind, 'group');
    expect(rooms.rooms.single.displayName, 'Project room');
    expect(rooms.rooms.single.role, 'member');
    session.dispose();
  });

  test('room list returns unread counts and encrypted activity cursors', () async {
    final session = _ProfileSession({
      'rooms': [
        {
          'roomId': 'room-1',
          'kind': 'group',
          'name': 'Project room',
          'role': 'member',
          'lastEventSeq': 57,
          'lastEventAt': 1795720000000,
          'unreadCount': 4,
        },
      ],
    });

    final rooms = await InOneRepositories(session).myRooms();

    expect(rooms.unreadCountsAvailable, isTrue);
    expect(rooms.rooms.single.lastEventSeq, 57);
    expect(rooms.rooms.single.lastEventAt, 1795720000000);
    expect(rooms.rooms.single.unreadCount, 4);
    session.dispose();
  });

  test('opens the canonical direct conversation through the authenticated API', () async {
    final session = _ProfileSession({
      'roomId': '!dm_0123456789abcdef',
      'peerUserId': 'peer-1',
      'status': 'provisioning',
      'created': true,
      'isCreator': true,
      'mlsInitializationRequired': true,
    });

    final conversation =
        await InOneRepositories(session).openDirectConversation(' peer-1 ');

    expect(session.method, 'POST');
    expect(session.path, '/direct-chats/open');
    expect(session.authenticated, isTrue);
    expect(session.body, {'userId': 'peer-1'});
    expect(conversation.roomId, '!dm_0123456789abcdef');
    expect(conversation.status, 'provisioning');
    expect(conversation.requiresCreatorSetup, isTrue);
    expect(conversation.mlsInitializationRequired, isTrue);
    session.dispose();
  });

  test('accepts a first-message contact request independently from message delivery', () async {
    final session = _ProfileSession({
      'accepted': true,
      'userId': '@sender:inone.test',
    });

    await InOneRepositories(session).acceptContactRequest('@sender:inone.test');

    expect(session.method, 'POST');
    expect(session.path, '/contacts/%40sender%3Ainone.test/accept');
    expect(session.authenticated, isTrue);
    expect(session.body, isNull);
    session.dispose();
  });

  test('blocks a non-contact through the authenticated contact action', () async {
    final session = _ProfileSession({
      'blocked': true,
      'userId': '@sender:inone.test',
    });

    await InOneRepositories(session).blockContact('@sender:inone.test');

    expect(session.method, 'POST');
    expect(session.path, '/contacts/%40sender%3Ainone.test/block');
    expect(session.authenticated, isTrue);
    expect(session.body, isNull);
    session.dispose();
  });

  test('rejects malformed direct conversation responses', () async {
    final session = _ProfileSession({
      'roomId': '',
      'peerUserId': 'peer-1',
      'status': 'provisioning',
      'created': true,
      'isCreator': true,
      'mlsInitializationRequired': true,
    });

    await expectLater(
      InOneRepositories(session).openDirectConversation('peer-1'),
      throwsA(isA<ApiException>()),
    );
    session.dispose();
  });

  test('rejects a malformed rooms response instead of showing fake chats', () async {
    final session = _ProfileSession({'rooms': [{'roomId': ''}]});

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

  test('propagates unauthorized rooms responses from the existing session', () async {
    final session = _ProfileSession(
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
    expect(session.path, '/rooms/mine');
    expect(session.authenticated, isTrue);
    session.dispose();
  });

  test('loads organization request details through the authenticated route', () async {
    final session = _ProfileSession({
      'request': {'requestId': 'request-1'},
      'documents': [],
    });
    final result = await InOneRepositories(session).organizationRequest('request-1');
    expect(session.method, 'GET');
    expect(session.path, '/org-requests/request-1');
    expect(session.authenticated, isTrue);
    expect(result['request'], isA<Map<String, dynamic>>());
    session.dispose();
  });

  test('submits an explicit organization decision to the owner-gated route', () async {
    final session = _ProfileSession({'status': 'approved'});
    final result = await InOneRepositories(session).decideOrganizationRequest(
      'request/with space',
      decision: 'approve',
    );
    expect(session.method, 'POST');
    expect(session.path, '/org-requests/request%2Fwith%20space/decision');
    expect(session.authenticated, isTrue);
    expect(session.body, {'decision': 'approve'});
    expect(result['status'], 'approved');
    session.dispose();
  });

  test('updates the authenticated profile locale through session persistence', () async {
    final session = _ProfileSession({'locale': 'en'});
    final result = await InOneRepositories(session).updateLocale('en');

    expect(session.method, 'PATCH');
    expect(session.path, '/profile/locale');
    expect(session.authenticated, isTrue);
    expect(session.body, {'locale': 'en'});
    expect(session.locale, 'en');
    expect(result['locale'], 'en');
    session.dispose();
  });

  test('propagates unauthorized responses from the existing session', () async {
    final session = _ProfileSession(
      const {},
      error: const ApiException(
        code: 'unauthorized',
        statusCode: 401,
        retryable: false,
      ),
    );

    await expectLater(
      InOneRepositories(session).profile(),
      throwsA(isA<ApiException>().having(
        (error) => error.statusCode,
        'statusCode',
        401,
      )),
    );
    session.dispose();
  });

  test('propagates backend server errors', () async {
    final session = _ProfileSession(
      const {},
      error: const ApiException(
        code: 'server_error',
        statusCode: 500,
        retryable: true,
      ),
    );

    await expectLater(
      InOneRepositories(session).profile(),
      throwsA(isA<ApiException>().having(
        (error) => error.statusCode,
        'statusCode',
        500,
      )),
    );
    session.dispose();
  });

  test('rejects a successful response with an invalid profile shape', () async {
    final session = _ProfileSession({
      'userId': 'user-1',
      'nickname': 'Test User',
      'email': 'user@example.test',
      'verificationLevel': 'verified',
      'providers': [],
      'backupEmail': null,
      'securityHints': [],
    });

    await expectLater(
      InOneRepositories(session).profile(),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
    session.dispose();
  });
}

class _ProfileSession extends InOneSession {
  _ProfileSession(this.response, {this.error})
      : super(baseUrl: 'https://api.inone.test');

  final Map<String, dynamic> response;
  final ApiException? error;
  String? method;
  String? path;
  bool? authenticated;
  Object? body;
  String _selectedLocale = 'hy';

  @override
  String get locale => _selectedLocale;

  @override
  Future<void> setLocale(String locale) async {
    method = 'PATCH';
    path = '/profile/locale';
    authenticated = true;
    body = {'locale': locale};
    if (error != null) throw error!;
    _selectedLocale = locale;
  }

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
    this.body = body;
    if (error != null) throw error!;
    return response;
  }
}
