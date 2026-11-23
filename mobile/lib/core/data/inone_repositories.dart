import '../session/inone_session.dart';
import 'inone_organization.dart';
import 'inone_profile.dart';
import '../network/api_exception.dart';
import 'inone_room.dart';

/// Typed read repositories shared by approved screens and the test-screen host.
class InOneRepositories {
  const InOneRepositories(this.session);

  final InOneSession session;

  Future<Map<String, dynamic>> health() =>
      session.request('GET', '/healthz', authenticated: false);
  Future<Map<String, dynamic>> readiness() =>
      session.request('GET', '/readyz', authenticated: false);
  Future<InOneProfile> profile() async =>
      InOneProfile.fromJson(await session.request('GET', '/profile'));
  Future<Map<String, dynamic>> updateLocale(String locale) async {
    await session.setLocale(locale);
    return {'locale': session.locale};
  }
  Future<Map<String, dynamic>> myOrganizations() =>
      session.request('GET', '/orgs/mine');
  Future<List<InOneOrganizationMember>> organizationMembers(String orgId) async {
    final response = await session.request(
      'GET', '/orgs/${Uri.encodeComponent(orgId)}/members',
    );
    final raw = response['members'];
    if (raw is! List || raw.any((member) => member is! Map)) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return List<InOneOrganizationMember>.unmodifiable(raw.map((member) =>
        InOneOrganizationMember.fromJson(Map<String, dynamic>.from(member as Map))));
  }
  Future<Map<String, dynamic>> myDevices() =>
      session.request('GET', '/devices/mine');
  /// Returns the validated room-list DTO for the authenticated account.
  Future<InOneRoomList> myRooms() async =>
      InOneRoomList.fromJson(await session.request('GET', '/rooms/mine'));
  /// Searches only public rooms; the backend enforces the 2–50 character range.
  Future<List<InOnePublicRoom>> searchPublicRooms(String query) async {
    final normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 50) {
      throw ArgumentError.value(query, 'query', 'Search must contain 2 to 50 characters');
    }
    final response = await session.request(
      'GET', '/rooms/search?q=${Uri.encodeQueryComponent(normalized)}',
    );
    return InOnePublicRoomSearch.fromJson(response).rooms;
  }

  /// Joins an open public room or creates a join request for approval-only rooms.
  Future<String> joinPublicRoom(String roomId) async {
    final response = await session.request(
      'POST', '/rooms/${Uri.encodeComponent(roomId)}/join',
    );
    final status = response['status'];
    if (status != 'joined' && status != 'requested') {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return status as String;
  }
  
  Future<InOneRoomDetails> roomDetails(String roomId) async =>
      InOneRoomDetails.fromJson(await session.request(
        'GET', '/rooms/${Uri.encodeComponent(roomId)}/members',
      ));

  Future<void> updateRoomName(String roomId, String name) async {
    final normalized = name.trim();
    if (normalized.isEmpty || normalized.length > 100) {
      throw ArgumentError.value(name, 'name', 'Room name must contain 1 to 100 characters');
    }
    await session.request(
      'POST',
      '/rooms/${Uri.encodeComponent(roomId)}/settings',
      body: {'name': normalized},
    );
  }
  Future<void> markRoomRead(String roomId, String upToEventId) async {
    final prefix = String.fromCharCode(36);
    final sequence = upToEventId.startsWith(prefix) && upToEventId.length > 1
        ? int.tryParse(upToEventId.substring(1))
        : null;
    if (sequence == null || sequence < 0) {
      throw ArgumentError.value(upToEventId, 'upToEventId', 'Expected a server event ID');
    }
    await session.request(
      'POST',
      '/rooms/${Uri.encodeComponent(roomId)}/read',
      body: {'upTo': upToEventId},
    );
  }

  Future<Map<String, dynamic>> loginApprovals() =>
      session.request('GET', '/approvals');
  Future<Map<String, dynamic>> organizationRequests() =>
      session.request('GET', '/org-requests');
  Future<Map<String, dynamic>> publicConfig() =>
      session.request('GET', '/config/public', authenticated: false);

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) =>
      session.request('GET', path, authenticated: authenticated);
}
).hasMatch(upToEventId)) {
      throw ArgumentError.value(upToEventId, 'upToEventId', 'Expected a server event ID');
    }
    await session.request(
      'POST',
      '/rooms/${Uri.encodeComponent(roomId)}/read',
      body: {'upTo': upToEventId},
    );
  }

  Future<Map<String, dynamic>> loginApprovals() =>
      session.request('GET', '/approvals');
  Future<Map<String, dynamic>> organizationRequests() =>
      session.request('GET', '/org-requests');
  Future<Map<String, dynamic>> publicConfig() =>
      session.request('GET', '/config/public', authenticated: false);

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) =>
      session.request('GET', path, authenticated: authenticated);
}
