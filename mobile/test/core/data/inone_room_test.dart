import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_room.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  test('direct conversation provisioning is internal and does not require peer approval', () {
    final conversation = InOneDirectConversation.fromJson({
      'roomId': '!dm_opaque:inone.test',
      'peerUserId': '@bob:inone.test',
      'status': 'provisioning',
      'created': true,
      'isCreator': true,
      'mlsInitializationRequired': true,
    });

    expect(conversation.status, 'provisioning');
    expect(conversation.requiresCreatorSetup, isTrue);
  });

  test('creator retry keeps the MLS initialization requirement', () {
    final conversation = InOneDirectConversation.fromJson({
      'roomId': '!dm_opaque:inone.test',
      'peerUserId': '@bob:inone.test',
      'status': 'provisioning',
      'created': false,
      'isCreator': true,
      'mlsInitializationRequired': true,
    });

    expect(conversation.created, isFalse);
    expect(conversation.requiresCreatorSetup, isTrue);
    expect(conversation.mlsInitializationRequired, isTrue);
  });

  test('rejects a provisioning creator response that omits the required MLS setup flag', () {
    expect(
      () => InOneDirectConversation.fromJson({
        'roomId': '!dm_opaque:inone.test',
        'peerUserId': '@bob:inone.test',
        'status': 'provisioning',
        'created': false,
        'isCreator': true,
        'mlsInitializationRequired': false,
      }),
      throwsA(isA<ApiException>()),
    );
  });

  test('recipient can open an automatically provisioned direct conversation without accepting it', () {
    final conversation = InOneDirectConversation.fromJson({
      'roomId': '!dm_opaque:inone.test',
      'peerUserId': '@alice:inone.test',
      'status': 'provisioning',
      'created': false,
      'isCreator': false,
      'mlsInitializationRequired': false,
    });

    expect(conversation.requiresCreatorSetup, isFalse);
    expect(conversation.isCreator, isFalse);
  });

  test('active direct conversation no longer requires MLS initialization', () {
    final conversation = InOneDirectConversation.fromJson({
      'roomId': '!dm_opaque:inone.test',
      'peerUserId': '@alice:inone.test',
      'status': 'active',
      'created': false,
      'isCreator': false,
      'mlsInitializationRequired': false,
    });

    expect(conversation.status, 'active');
    expect(conversation.requiresCreatorSetup, isFalse);
  });

  test('legacy recipient-approval state is rejected by direct-chat DTO', () {
    expect(
      () => InOneDirectConversation.fromJson({
        'roomId': '!dm_opaque:inone.test',
        'peerUserId': '@bob:inone.test',
        'status': 'pending',
        'created': false,
        'isCreator': false,
        'mlsInitializationRequired': false,
      }),
      throwsA(isA<ApiException>()),
    );
  });

  test('parses the authenticated rooms envelope', () {
    final rooms = InOneRoomList.fromJson({
      'rooms': [
        {
          'roomId': 'room-1',
          'kind': 'group',
          'name': 'Project team',
          'role': 'owner',
        },
        {
          'roomId': 'room-2',
          'kind': 'direct',
          'name': null,
          'role': 'member',
        },
      ],
    }).rooms;

    expect(rooms, hasLength(2));
    expect(rooms.first.displayName, 'Project team');
    expect(rooms.first.role, 'owner');
    expect(rooms.last.displayName, 'Личный диалог');
    expect(rooms.last.kind, 'direct');
  });

  test('accepts an empty room list', () {
    expect(InOneRoomList.fromJson({'rooms': []}).rooms, isEmpty);
  });

  test('rejects an invalid room envelope', () {
    expect(
      () => InOneRoomList.fromJson({'items': []}),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
  });

  test('rejects invalid room identity and role', () {
    expect(
      () => InOneRoom.fromJson({
        'roomId': '',
        'kind': 'group',
        'name': 'Broken',
        'role': 'owner',
      }),
      throwsA(isA<ApiException>()),
    );
    expect(
      () => InOneRoom.fromJson({
        'roomId': 'room-1',
        'kind': 'group',
        'name': 'Broken',
        'role': 'superuser',
      }),
      throwsA(isA<ApiException>()),
    );
  });

  test('exposes an immutable room collection', () {
    final rooms = InOneRoomList.fromJson({'rooms': []}).rooms;
    expect(() => rooms.add(
      const InOneRoom(roomId: 'r', kind: 'group', name: null, role: 'member'),
    ), throwsUnsupportedError);
  });
  test('parses opaque encrypted room activity and unread summary metadata', () {
    final room = InOneRoom.fromJson({
      'roomId': 'room-1',
      'kind': 'group',
      'name': 'Project',
      'role': 'member',
      'lastEventSeq': 42,
      'lastEventAt': 1795720000000,
      'unreadCount': 3,
    });

    expect(room.lastEventSeq, 42);
    expect(room.lastEventAt, 1795720000000);
    expect(room.unreadCount, 3);
    expect(room.hasSummary, isTrue);
  });

  test('room list enables unread filtering only when every room has summary metadata', () {
    final complete = InOneRoomList.fromJson({
      'rooms': [
        {
          'roomId': 'room-1',
          'kind': 'group',
          'name': 'Project',
          'role': 'member',
          'lastEventSeq': 42,
          'lastEventAt': 1795720000000,
          'unreadCount': 2,
        },
      ],
    });
    expect(complete.unreadCountsAvailable, isTrue);

    final legacy = InOneRoomList.fromJson({
      'rooms': [
        {'roomId': 'room-1', 'kind': 'group', 'name': 'Project', 'role': 'member'},
      ],
    });
    expect(legacy.unreadCountsAvailable, isFalse);
  });

  test('parses incoming contact request state without treating it as message approval', () {
    final room = InOneRoom.fromJson({
      'roomId': '!dm_opaque:inone.test',
      'kind': 'direct',
      'name': 'New contact',
      'role': 'member',
      'peerUserId': '@sender:inone.test',
      'isPeerContact': false,
      'incomingContactRequest': true,
      'isBlocked': false,
    });

    expect(room.peerUserId, '@sender:inone.test');
    expect(room.incomingContactRequest, isTrue);
    expect(room.isPeerContact, isFalse);
    expect(room.isBlocked, isFalse);
  });

  test('rejects malformed contact request state', () {
    expect(
      () => InOneRoom.fromJson({
        'roomId': '!dm_opaque:inone.test',
        'kind': 'direct',
        'name': null,
        'role': 'member',
        'incomingContactRequest': 'yes',
      }),
      throwsA(isA<ApiException>()),
    );
  });

  test('rejects malformed unread summary metadata', () {
    expect(
      () => InOneRoom.fromJson({
        'roomId': 'room-1',
        'kind': 'group',
        'name': 'Project',
        'role': 'member',
        'lastEventSeq': 42,
        'lastEventAt': 1795720000000,
        'unreadCount': -1,
      }),
      throwsA(isA<ApiException>()),
    );
  });

}
