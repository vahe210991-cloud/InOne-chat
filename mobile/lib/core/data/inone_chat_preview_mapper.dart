import '../../ui_dart_source/models/inone_models.dart';
import 'inone_room.dart';

/// Maps the backend room category to the canonical native chat presentation.
InOneChatKind mapInOneRoomKind(String rawKind) {
  return switch (rawKind.toLowerCase()) {
    'direct' || 'dm' || 'person' => InOneChatKind.person,
    'support' => InOneChatKind.support,
    'group' => InOneChatKind.group,
    'channel' => InOneChatKind.channel,
    'system' => InOneChatKind.system,
    _ => InOneChatKind.unknown,
  };
}

/// Converts validated backend rooms into immutable chat-list view models.
List<InOneChatPreview> mapInOneRoomsToChatPreviews(InOneRoomList roomList) {
  return List<InOneChatPreview>.unmodifiable(roomList.rooms.map((room) {
    return InOneChatPreview(
      id: room.roomId,
      name: room.displayName,
      lastMessage: null,
      time: '',
      kind: mapInOneRoomKind(room.kind),
      unread: room.unreadCount,
    );
  }));
}
