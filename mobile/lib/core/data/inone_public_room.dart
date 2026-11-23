import '../network/api_exception.dart';

/// Public room returned by GET /rooms/search.
class InOnePublicRoom {
  const InOnePublicRoom({
    required this.roomId,
    required this.name,
    required this.joinPolicy,
    required this.members,
  });

  final String roomId;
  final String name;
  final String joinPolicy;
  final int members;

  factory InOnePublicRoom.fromJson(Map<String, dynamic> json) {
    final roomId = json['roomId'];
    final name = json['name'];
    final joinPolicy = json['join_policy'];
    final members = json['members'];
    if (roomId is! String ||
        roomId.trim().isEmpty ||
        name is! String ||
        name.trim().isEmpty ||
        joinPolicy is! String ||
        joinPolicy.trim().isEmpty ||
        members is! int ||
        members < 0) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 502,
        retryable: false,
      );
    }
    return InOnePublicRoom(
      roomId: roomId,
      name: name,
      joinPolicy: joinPolicy,
      members: members,
    );
  }
}
