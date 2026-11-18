import '../network/api_exception.dart';

/// A room visible to the authenticated user in the chat list.
class InOneRoom {
  const InOneRoom({
    required this.roomId,
    required this.kind,
    required this.name,
    required this.role,
  });

  final String roomId;
  final String kind;
  final String? name;
  final String role;

  String get displayName => name?.trim().isNotEmpty == true ? name!.trim() : roomId;

  factory InOneRoom.fromJson(Map<String, dynamic> json) {
    final roomId = json['roomId'];
    final kind = json['kind'];
    final name = json['name'];
    final role = json['role'];

    if (roomId is! String ||
        roomId.trim().isEmpty ||
        kind is! String ||
        kind.trim().isEmpty ||
        (name != null && name is! String) ||
        role is! String ||
        !const {'owner', 'admin', 'member'}.contains(role)) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }

    return InOneRoom(
      roomId: roomId,
      kind: kind,
      name: name as String?,
      role: role,
    );
  }
}

/// Parses the exact GET /rooms/mine response envelope.
class InOneRoomList {
  const InOneRoomList(this.rooms);

  final List<InOneRoom> rooms;

  factory InOneRoomList.fromJson(Map<String, dynamic> json) {
    final rawRooms = json['rooms'];
    if (rawRooms is! List ||
        rawRooms.any((room) => room is! Map<String, dynamic>)) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }

    return InOneRoomList(List<InOneRoom>.unmodifiable(
      rawRooms.map((room) => InOneRoom.fromJson(room as Map<String, dynamic>)),
    ));
  }
}
