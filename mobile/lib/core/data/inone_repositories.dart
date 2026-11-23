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
