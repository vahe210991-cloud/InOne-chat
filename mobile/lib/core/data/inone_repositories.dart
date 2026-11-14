import '../session/inone_session.dart';
import 'inone_profile.dart';
import 'inone_organization.dart';
import 'inone_public_config.dart';
import 'inone_room.dart';

/// Typed backend repositories used by the native Flutter application.
class InOneRepositories {
  const InOneRepositories(this.session);

  final InOneSession session;

  Future<Map<String, dynamic>> health() =>
      session.request('GET', '/healthz', authenticated: false);
  Future<Map<String, dynamic>> readiness() =>
      session.request('GET', '/readyz', authenticated: false);
  Future<InOneProfile> profile() async =>
      InOneProfile.fromJson(await session.request('GET', '/profile'));
  Future<List<InOneRoom>> myRooms() async =>
      InOneRoomList.fromJson(await session.request('GET', '/rooms/mine')).rooms;
  Future<List<InOneOrganization>> myOrganizations() async =>
      InOneOrganizationList.fromJson(await session.request('GET', '/orgs/mine')).orgs;
  Future<Map<String, dynamic>> myDevices() =>
      session.request('GET', '/devices/mine');
  Future<Map<String, dynamic>> loginApprovals() =>
      session.request('GET', '/approvals');
  Future<Map<String, dynamic>> organizationRequests() =>
      session.request('GET', '/org-requests');
  Future<InOnePublicConfig> publicConfig() async =>
      InOnePublicConfig.fromJson(await session.request('GET', '/config/public', authenticated: false));

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) =>
      session.request('GET', path, authenticated: authenticated);
}
