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


/// Result of POST /direct-chats/open. Provisioning is an internal MLS setup state,
/// never a recipient approval request. The creator commits per-device Welcome automatically.
class InOneDirectConversation {
  const InOneDirectConversation({
    required this.roomId,
    required this.peerUserId,
    required this.status,
    required this.created,
    required this.isCreator,
    required this.mlsInitializationRequired,
  });

  final String roomId;
  final String peerUserId;
  final String status;
  final bool created;
  final bool isCreator;
  final bool mlsInitializationRequired;

  bool get requiresCreatorSetup => status == 'provisioning' && isCreator;

  factory InOneDirectConversation.fromJson(Map<String, dynamic> json) {
    final roomId = json['roomId'];
    final peerUserId = json['peerUserId'];
    final status = json['status'];
    final created = json['created'];
    final isCreator = json['isCreator'];
    final mlsInitializationRequired = json['mlsInitializationRequired'];
    if (roomId is! String || roomId.trim().isEmpty ||
        peerUserId is! String || peerUserId.trim().isEmpty ||
        status is! String || !const {'provisioning', 'active'}.contains(status) ||
        created is! bool || isCreator is! bool ||
        mlsInitializationRequired is! bool ||
        created && (status != 'provisioning' || !isCreator || !mlsInitializationRequired) ||
        status == 'active' && mlsInitializationRequired) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
    return InOneDirectConversation(
      roomId: roomId,
      peerUserId: peerUserId,
      status: status,
      created: created,
      isCreator: isCreator,
      mlsInitializationRequired: mlsInitializationRequired,
    );
  }
}


/// Public group search result returned by GET /rooms/search.
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
    if (roomId is! String || roomId.trim().isEmpty ||
        name is! String || name.trim().isEmpty ||
        joinPolicy is! String || !const {'open', 'approval'}.contains(joinPolicy) ||
        members is! int || members < 0) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
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

/// Parses the exact public-room search response envelope.
class InOnePublicRoomSearch {
  const InOnePublicRoomSearch(this.rooms);
  final List<InOnePublicRoom> rooms;

  factory InOnePublicRoomSearch.fromJson(Map<String, dynamic> json) {
    final raw = json['rooms'];
    if (raw is! List || raw.any((room) => room is! Map)) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
    return InOnePublicRoomSearch(List<InOnePublicRoom>.unmodifiable(
      raw.map((room) => InOnePublicRoom.fromJson(
        Map<String, dynamic>.from(room as Map),
      )),
    ));
  }
}


/// Authenticated room metadata and effective permissions for the current member.
class InOneRoomDetails {
  const InOneRoomDetails({
    required this.owner,
    required this.kind,
    required this.admins,
    required this.members,
    required this.capabilities,
    required this.name,
    required this.visibility,
    required this.joinPolicy,
    required this.readUpTo,
  });

  final String owner;
  final String kind;
  final List<String> admins;
  final List<String> members;
  final Map<String, List<String>> capabilities;
  final String? name;
  final String visibility;
  final String joinPolicy;
  final Map<String, String?> readUpTo;

  factory InOneRoomDetails.fromJson(Map<String, dynamic> json) {
    final owner = json['owner'];
    final kind = json['kind'] ?? 'group';
    final admins = json['admins'];
    final members = json['members'];
    final rawCapabilities = json['capabilities'];
    final name = json['name'];
    final visibility = json['visibility'];
    final joinPolicy = json['join_policy'];
    final rawReadUpTo = json['read_upto'];
    if (owner is! String || kind is! String ||
        !const {'group', 'channel', 'direct'}.contains(kind) ||
        admins is! List ||
        admins.any((value) => value is! String) ||
        members is! List || members.any((value) => value is! String) ||
        rawCapabilities is! Map || name != null && name is! String ||
        visibility is! String || !const {'public', 'private'}.contains(visibility) ||
        joinPolicy is! String || !const {'open', 'approval'}.contains(joinPolicy) ||
        rawReadUpTo is! Map) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    final parsedCapabilities = <String, List<String>>{};
    for (final entry in rawCapabilities.entries) {
      if (entry.key is! String || entry.value is! List ||
          (entry.value as List).any((value) => value is! String)) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      parsedCapabilities[entry.key as String] =
          List<String>.unmodifiable((entry.value as List).cast<String>());
    }
    final parsedReadUpTo = <String, String?>{};
    for (final entry in rawReadUpTo.entries) {
      if (entry.key is! String || entry.value != null && entry.value is! String) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      parsedReadUpTo[entry.key as String] = entry.value as String?;
    }
    final parsedMembers = List<String>.unmodifiable(members.cast<String>());
    if (!parsedMembers.contains(owner) ||
        parsedMembers.any((member) => !parsedCapabilities.containsKey(member))) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneRoomDetails(
      owner: owner,
      kind: kind,
      admins: List<String>.unmodifiable(admins.cast<String>()),
      members: parsedMembers,
      capabilities: Map<String, List<String>>.unmodifiable(parsedCapabilities),
      name: name as String?,
      visibility: visibility,
      joinPolicy: joinPolicy,
      readUpTo: Map<String, String?>.unmodifiable(parsedReadUpTo),
    );
  }
}


/// A pending request to join a room, returned by GET /rooms/:id/requests.
class InOneRoomJoinRequest {
  const InOneRoomJoinRequest({
    required this.userId,
    required this.createdAt,
  });

  final String userId;
  final int createdAt;

  factory InOneRoomJoinRequest.fromJson(Map<String, dynamic> json) {
    final userId = json['userId'];
    final createdAt = json['created_at'];
    if (userId is! String || userId.trim().isEmpty ||
        createdAt is! int || createdAt < 0) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 200,
        retryable: false,
      );
    }
    return InOneRoomJoinRequest(userId: userId, createdAt: createdAt);
  }
}
