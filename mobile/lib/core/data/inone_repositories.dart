import '../session/inone_session.dart';
import 'inone_profile.dart';
import 'inone_public_room.dart';
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
  Future<Map<String, dynamic>> organizationMembers(String orgId) =>
      session.request('GET', '/orgs/${Uri.encodeComponent(orgId)}/members');
  Future<List<InOnePublicRoom>> searchPublicRooms(String query) async {
    final normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 50) {
      throw ArgumentError.value(query, 'query', 'Search must contain 2 to 50 characters');
    }
    final response = await session.request(
      'GET',
      '/rooms/search?q=${Uri.encodeQueryComponent(normalized)}',
    );
    final rawRooms = response['rooms'];
    if (rawRooms is! List || rawRooms.any((room) => room is! Map)) {
      throw const ApiException(code: 'invalid_response', statusCode: 502, retryable: false);
    }
    return List<InOnePublicRoom>.unmodifiable(
      rawRooms.map((room) => InOnePublicRoom.fromJson(Map<String, dynamic>.from(room as Map))),
    );
  }
  Future<String> joinPublicRoom(String roomId) async {
    final response = await session.request(
      'POST',
      '/rooms/${Uri.encodeComponent(roomId)}/join',
    );
    final status = response['status'];
    if (status != 'joined' && status != 'requested') {
      throw const ApiException(code: 'invalid_response', statusCode: 502, retryable: false);
    }
    return status as String;
  }
  Future<Map<String, dynamic>> myDevices() =>
      session.request('GET', '/devices/mine');
  /// Returns the validated room-list DTO for the authenticated account.
  Future<InOneRoomList> myRooms() async =>
      InOneRoomList.fromJson(await session.request('GET', '/rooms/mine'));
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
