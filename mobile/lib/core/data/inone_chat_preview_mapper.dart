import 'inone_room.dart';
import '../../ui_dart_source/models/inone_models.dart';

/// Maps verified backend room DTOs to the existing approved chat-list view model.
List<InOneChatPreview> mapInOneRoomsToChatPreviews(InOneRoomList roomList) {
  return List<InOneChatPreview>.unmodifiable(roomList.rooms.map((room) {
    final kind = switch (room.kind.toLowerCase()) {
      'direct' || 'dm' || 'person' => InOneChatKind.person,
      'support' => InOneChatKind.support,
      _ => InOneChatKind.group,
    };
    return InOneChatPreview(
      id: room.roomId,
      name: room.displayName,
      lastMessage: null,
      time: '',
      kind: kind,
    );
  }));
}
