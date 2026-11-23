import '../../ui_dart_source/models/inone_models.dart';
import 'inone_organization.dart';
import 'inone_workspace_repository.dart';

/// A single read snapshot for the workspace and organization profile screens.
/// Unsupported metrics intentionally remain null so the UI never displays
/// fabricated project, task, team, group, or activity values.
class InOneWorkspaceScreenData {
  const InOneWorkspaceScreenData({
    required this.organizations,
    required this.selectedOrganization,
    required this.workspaceSummary,
    required this.organizationProfile,
  });

  final List<InOneOrganization> organizations;
  final InOneOrganization? selectedOrganization;
  final InOneWorkspaceSummary workspaceSummary;
  final InOneOrgProfile? organizationProfile;

  static Future<InOneWorkspaceScreenData> load(
    InOneWorkspaceRepository repository, {
    String? selectedOrganizationId,
  }) async {
    final organizations = await repository.organizations();
    final selected = organizations.where(
      (item) => item.orgId == selectedOrganizationId,
    ).firstOrNull ?? (selectedOrganizationId == null && organizations.isNotEmpty
        ? organizations.first
        : null);

    if (selected == null) {
      return InOneWorkspaceScreenData(
        organizations: List.unmodifiable(organizations),
        selectedOrganization: null,
        workspaceSummary: const InOneWorkspaceSummary(
          name: 'Личное пространство',
          activeProjects: null,
          tasksDue: null,
          teamMembers: null,
          activeGroups: null,
          projectsCaption: '',
        ),
        organizationProfile: null,
      );
    }

    final overview = await repository.organizationOverview(selected);
    return InOneWorkspaceScreenData(
      organizations: List.unmodifiable(organizations),
      selectedOrganization: selected,
      workspaceSummary: InOneWorkspaceSummary(
        name: selected.name,
        activeProjects: null,
        tasksDue: null,
        teamMembers: overview.memberCount,
        activeGroups: null,
        projectsCaption: '',
      ),
      organizationProfile: InOneOrgProfile(
        name: selected.name,
        subtitle: '${selected.role} · ${selected.status}',
        members: overview.memberCount,
        projects: null,
        teams: null,
        about: null,
        verified: overview.verified,
      ),
    );
  }
}
