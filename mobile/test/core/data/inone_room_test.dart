import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_room.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
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
    expect(rooms.last.displayName, 'room-2');
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
}
