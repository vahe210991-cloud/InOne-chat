import '../network/api_exception.dart';
import '../session/inone_session.dart';
import 'inone_organization.dart';

/// Read-only organization/workspace data backed by routes already implemented
/// by the Beta 1.0 engine. This deliberately does not invent project, task,
/// activity, or room counts: those server contracts are not available here.
class InOneOrganizationOverview {
  const InOneOrganizationOverview({
    required this.organization,
    required this.memberCount,
  });

  final InOneOrganization organization;
  final int memberCount;

  bool get verified => organization.status == 'approved';
  bool get canManage => organization.role == 'owner' || organization.role == 'admin';
}

class InOneWorkspaceRepository {
  const InOneWorkspaceRepository(this._session);

  final InOneSession _session;

  Future<List<InOneOrganization>> organizations() async {
    final response = await _session.request('GET', '/orgs/mine');
    return InOneOrganizationList.fromJson(response).orgs;
  }

  Future<InOneOrganizationOverview> organizationOverview(
    InOneOrganization organization,
  ) async {
    if (organization.orgId.trim().isEmpty) {
      throw const ApiException(
        code: 'invalid_organization_id',
        statusCode: 400,
        retryable: false,
      );
    }

    final response = await _session.request(
      'GET',
      '/orgs/${Uri.encodeComponent(organization.orgId)}/members',
    );
    final rawMembers = response['members'];
    if (rawMembers is! List) {
      throw const ApiException(
        code: 'invalid_response',
        statusCode: 502,
        retryable: false,
      );
    }

    for (final member in rawMembers) {
      if (member is! Map ||
          member['userId'] is! String ||
          (member['role'] != 'owner' &&
              member['role'] != 'admin' &&
              member['role'] != 'member')) {
        throw const ApiException(
          code: 'invalid_response',
          statusCode: 502,
          retryable: false,
        );
      }
    }

    return InOneOrganizationOverview(
      organization: organization,
      memberCount: rawMembers.length,
    );
  }
}
