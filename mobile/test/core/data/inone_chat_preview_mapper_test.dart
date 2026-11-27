import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_chat_preview_mapper.dart';
import 'package:inone_mobile/core/data/inone_room.dart';
import 'package:inone_mobile/ui_dart_source/models/inone_models.dart';

void main() {
  test('maps group, channel, direct, support and unknown rooms explicitly', () {
    final roomList = InOneRoomList.fromJson({
      'rooms': [
        {
          'roomId': 'group-1',
          'kind': 'group',
          'name': 'Project team',
          'role': 'owner',
          'lastEventSeq': 57,
          'lastEventAt': 1795720000000,
          'unreadCount': 4,
        },
        {
          'roomId': 'channel-1',
          'kind': 'channel',
          'name': 'Announcements',
          'role': 'member',
        },
        {
          'roomId': 'direct-1',
          'kind': 'direct',
          'name': 'New contact',
          'role': 'member',
          'peerUserId': '@sender:inone.test',
          'incomingContactRequest': true,
          'isPeerContact': false,
          'isBlocked': false,
        },
        {
          'roomId': 'support-1',
          'kind': 'support',
          'name': 'Support',
          'role': 'member',
        },
        {
          'roomId': 'future-1',
          'kind': 'future_kind',
          'name': 'Future',
          'role': 'member',
        },
      ],
    });

    final chats = mapInOneRoomsToChatPreviews(roomList);

    expect(chats, hasLength(5));
    expect(chats[0].id, 'group-1');
    expect(chats[0].name, 'Project team');
    expect(chats[0].kind, InOneChatKind.group);
    expect(chats[0].unread, 4);
    expect(chats[1].id, 'channel-1');
    expect(chats[1].kind, InOneChatKind.channel);
    expect(chats[2].id, 'direct-1');
    expect(chats[2].name, 'New contact');
    expect(chats[2].kind, InOneChatKind.person);
    expect(chats[2].peerUserId, '@sender:inone.test');
    expect(chats[2].incomingContactRequest, isTrue);
    expect(chats[2].isPeerContact, isFalse);
    expect(chats[2].isBlocked, isFalse);
    expect(chats[3].id, 'support-1');
    expect(chats[3].kind, InOneChatKind.support);
    expect(chats[4].kind, InOneChatKind.unknown);
    expect(chats.every((chat) => chat.lastMessage == null), isTrue);
    expect(chats.every((chat) => chat.time.isEmpty), isTrue);
  });

  test('refreshes incoming contact actions without rebuilding the chat preview', () {
    final initial = InOneChatPreview(
      id: 'direct-1',
      name: 'New contact',
      lastMessage: 'Hello',
      time: '10:30',
      kind: InOneChatKind.person,
      peerUserId: '@sender:inone.test',
      incomingContactRequest: true,
    );

    final accepted = initial.copyWith(
      incomingContactRequest: false,
      isPeerContact: true,
    );
    expect(accepted.incomingContactRequest, isFalse);
    expect(accepted.isPeerContact, isTrue);
    expect(accepted.peerUserId, '@sender:inone.test');
    expect(accepted.lastMessage, 'Hello');

    final blocked = accepted.copyWith(isBlocked: true);
    expect(blocked.isBlocked, isTrue);
    expect(blocked.isPeerContact, isTrue);
  });

  test('maps an empty backend room list to an empty chat list', () {
    expect(
      mapInOneRoomsToChatPreviews(InOneRoomList.fromJson({'rooms': []})),
      isEmpty,
    );
  });

  test('returns an immutable chat preview list', () {
    final chats = mapInOneRoomsToChatPreviews(
      InOneRoomList.fromJson({
        'rooms': [
          {
            'roomId': 'group-1',
            'kind': 'group',
            'name': 'Team',
            'role': 'member',
          },
        ],
      }),
    );

    expect(
      () => chats.add(
        const InOneChatPreview(
          id: 'other',
          name: 'Other',
          lastMessage: null,
          time: '',
          kind: InOneChatKind.group,
        ),
      ),
      throwsUnsupportedError,
    );
  });
}
