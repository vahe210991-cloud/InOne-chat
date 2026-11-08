/// Owner-approved InOne screen variants. Labels match HTML data-screen-label attributes.
class ApprovedScreen {
  const ApprovedScreen({required this.id, required this.label, required this.theme});
  final String id;
  final String label;
  final String theme;
}

const String approvedScreensAssetPath =
    'assets/approved-ui/InOne-approved-cross-platform.html';

const List<ApprovedScreen> approvedScreens = [
  ApprovedScreen(id: 'org-profile-light', label: '02 Organization profile', theme: 'light'),
  ApprovedScreen(id: 'workspace-light', label: '03 Workspace', theme: 'light'),
  ApprovedScreen(id: 'messages-light', label: '05 Messages', theme: 'light'),
  ApprovedScreen(id: 'notifications-light', label: '06 Notifications', theme: 'light'),
  ApprovedScreen(id: 'leads-light', label: '40 Leads', theme: 'light'),
  ApprovedScreen(id: 'kanban-light', label: '41 Kanban', theme: 'light'),
  ApprovedScreen(id: 'deal-detail-light', label: '42 Deal detail', theme: 'light'),
  ApprovedScreen(id: 'personal-profile-light', label: '43 Personal profile', theme: 'light'),
  ApprovedScreen(id: 'chat-thread-light', label: '46 Chat thread', theme: 'light'),
  ApprovedScreen(id: 'empty-states-light', label: '51 Empty states', theme: 'light'),
  ApprovedScreen(id: 'loading-error-light', label: '52 Loading and error', theme: 'light'),
  ApprovedScreen(id: 'org-profile-dark', label: 'D02 Dark — Organization profile', theme: 'dark'),
  ApprovedScreen(id: 'workspace-dark', label: 'D03 Dark Workspace', theme: 'dark'),
  ApprovedScreen(id: 'messages-dark', label: 'D05 Dark Messages', theme: 'dark'),
  ApprovedScreen(id: 'notifications-dark', label: 'D06 Dark Notifications', theme: 'dark'),
  ApprovedScreen(id: 'leads-dark', label: 'D38 Dark Leads', theme: 'dark'),
  ApprovedScreen(id: 'kanban-dark', label: 'D39 Dark Kanban', theme: 'dark'),
  ApprovedScreen(id: 'deal-detail-dark', label: 'D40 Dark Deal detail', theme: 'dark'),
  ApprovedScreen(id: 'personal-profile-dark', label: 'D41 Dark — Personal profile', theme: 'dark'),
  ApprovedScreen(id: 'chat-thread-dark', label: 'D44 Dark Chat thread', theme: 'dark'),
  ApprovedScreen(id: 'empty-states-dark', label: 'D49 Dark Empty states', theme: 'dark'),
  ApprovedScreen(id: 'loading-error-dark', label: 'D50 Dark Loading & error', theme: 'dark'),
];
