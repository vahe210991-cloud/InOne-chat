import '../session/inone_session.dart';
import 'inone_profile.dart';

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
  Future<Map<String, dynamic>> myDevices() =>
      session.request('GET', '/devices/mine');
  Future<Map<String, dynamic>> loginApprovals() =>
      session.request('GET', '/approvals');
  Future<Map<String, dynamic>> organizationRequests() =>
      session.request('GET', '/org-requests');
  Future<Map<String, dynamic>> organizationRequest(String requestId) =>
      session.request('GET', '/org-requests/${Uri.encodeComponent(requestId)}');
  Future<Map<String, dynamic>> decideOrganizationRequest(
    String requestId, {
    required String decision,
  }) =>
      session.request(
        'POST',
        '/org-requests/${Uri.encodeComponent(requestId)}/decision',
        body: {'decision': decision},
      );
  Future<Map<String, dynamic>> publicConfig() =>
      session.request('GET', '/config/public', authenticated: false);

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) =>
      session.request('GET', path, authenticated: authenticated);
}
