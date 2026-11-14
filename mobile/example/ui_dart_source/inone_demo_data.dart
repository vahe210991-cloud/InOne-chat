import 'package:flutter/material.dart';

import 'package:inone_mobile/ui_dart_source/models/inone_models.dart';
import 'package:inone_mobile/ui_dart_source/widgets/inone_icons.dart';

/// ДЕМО-ДАННЫЕ из макетов. Только для галереи и предпросмотра:
/// в рабочем приложении данные приходят из репозиториев, а не отсюда.
abstract final class InOneDemoData {
  static const orgProfile = InOneOrgProfile(
    name: 'InOne Organization',
    subtitle: 'Organization profile',
    members: 24,
    projects: 8,
    teams: 6,
    verified: true,
    about: 'A shared workspace for the team, projects, communication and day-to-day operations.',
  );

  static const workspace = InOneWorkspaceSummary(
    name: 'InOne Workspace',
    activeProjects: 18,
    tasksDue: 36,
    teamMembers: 128,
    activeGroups: 9,
    hasUnread: true,
  );

  static List<InOneModuleTile> modules() => [
        for (final m in const [
          ('CRM', InOneIcons.crm),
          ('Kanban', InOneIcons.kanban),
          ('Projects', InOneIcons.projects),
          ('Calendar', InOneIcons.calendar),
          ('Chats', InOneIcons.chat),
          ('Groups', InOneIcons.group),
          ('Files', InOneIcons.files),
          ('Tasks', InOneIcons.tasks),
        ])
          InOneModuleTile(label: m.$1, icon: m.$2, onTap: () {}),
      ];

  static const activity = [
    InOneActivityItem(
      title: 'New lead from website',
      subtitle: 'Anna Grigoryan · Kentron',
      time: '2m',
      icon: InOneIcons.lead,
      highlighted: true,
    ),
    InOneActivityItem(
      title: 'Order #12345 confirmed',
      subtitle: r'$248.00 · paid',
      time: '15m',
      icon: InOneIcons.order,
    ),
    InOneActivityItem(
      title: 'Ad campaign launched',
      subtitle: 'Spring promotion',
      time: '1h',
      icon: InOneIcons.campaign,
    ),
  ];

  static const chats = [
    InOneChatPreview(
      id: '1',
      name: 'John Smith',
      lastMessage: 'Can you share the latest project update?',
      time: '10:30 AM',
      kind: InOneChatKind.person,
      unread: 2,
    ),
    InOneChatPreview(
      id: '2',
      name: 'InOne Support',
      lastMessage: 'The project documents are ready for review.',
      time: '9:15 AM',
      kind: InOneChatKind.support,
      initials: 'Pr',
    ),
    InOneChatPreview(
      id: '3',
      name: 'Project Team',
      lastMessage: "Let's discuss the new campaign.",
      time: 'Yesterday',
      kind: InOneChatKind.group,
    ),
    InOneChatPreview(
      id: '4',
      name: 'Anna Johnson',
      lastMessage: 'Thank you! It was very helpful.',
      time: 'Yesterday',
      kind: InOneChatKind.person,
      unread: 1,
    ),
    InOneChatPreview(
      id: '5',
      name: 'System Notifications',
      lastMessage: 'Your account settings updated.',
      time: '2 days ago',
      kind: InOneChatKind.system,
    ),
  ];

  static const notifications = [
    InOneNotificationItem(
      id: '1',
      title: 'Task assigned to you',
      body: 'Prepare the project estimate',
      timeAgo: '2 min ago',
      kind: InOneNotificationKind.task,
      unread: true,
    ),
    InOneNotificationItem(
      id: '2',
      title: 'Project deadline updated',
      body: 'Electrical works · Block A',
      timeAgo: '15 min ago',
      kind: InOneNotificationKind.deadline,
      unread: true,
    ),
    InOneNotificationItem(
      id: '3',
      title: 'New message from Anna',
      body: "Hi! I'm interested in your product.",
      timeAgo: '30 min ago',
      kind: InOneNotificationKind.message,
    ),
    InOneNotificationItem(
      id: '4',
      title: 'New CRM comment',
      body: 'Anna mentioned you in a deal.',
      timeAgo: '1 hour ago',
      kind: InOneNotificationKind.crm,
    ),
    InOneNotificationItem(
      id: '5',
      title: 'Calendar reminder',
      body: 'Site visit starts in 30 minutes',
      timeAgo: '2 hours ago',
      kind: InOneNotificationKind.calendar,
    ),
  ];

  static const leadStats = InOneLeadStats(newCount: 12, qualifiedCount: 8, wonThisMonth: 3);

  static const leads = [
    InOneLead(
      id: '1',
      name: 'Anna Grigoryan',
      source: 'Website form',
      status: InOneLeadStatus.fresh,
      statusLabel: 'New',
      timeAgo: '2m ago',
      initials: 'AG',
      tone: InOneTone.blue,
    ),
    InOneLead(
      id: '2',
      name: 'Homey Store',
      source: 'Referral',
      status: InOneLeadStatus.contacted,
      statusLabel: 'Contacted',
      timeAgo: '1h ago',
      initials: 'HS',
      tone: InOneTone.green,
    ),
    InOneLead(
      id: '3',
      name: 'Sunrise Travel',
      source: 'Ad campaign',
      status: InOneLeadStatus.qualified,
      statusLabel: 'Qualified',
      timeAgo: '3h ago',
      initials: 'ST',
      tone: InOneTone.purple,
    ),
    InOneLead(
      id: '4',
      name: 'TechPoint',
      source: 'Cold outreach',
      status: InOneLeadStatus.won,
      statusLabel: 'Won',
      timeAgo: 'Yesterday',
      initials: 'TP',
    ),
  ];

  static const kanban = [
    InOneKanbanColumn(
      title: 'New',
      color: Color(0xFF2E6EA8),
      cards: [
        InOneDealCard(
          id: '1',
          title: 'Office building · electrical works',
          company: 'Acme LLC',
          amount: r'$12,400',
          ownerInitials: 'JD',
        ),
        InOneDealCard(
          id: '2',
          title: 'Landscape lighting project',
          company: 'Homey Store',
          amount: r'$3,850',
          ownerInitials: 'AK',
          ownerTone: InOneTone.green,
        ),
      ],
    ),
    InOneKanbanColumn(
      title: 'In progress',
      color: Color(0xFFE9B44C),
      cards: [
        InOneDealCard(
          id: '3',
          title: 'Site installation package',
          company: 'TechPoint',
          amount: r'$9,600',
          ownerInitials: 'JD',
        ),
      ],
    ),
    InOneKanbanColumn(
      title: 'Won',
      color: Color(0xFF77B72C),
      cards: [
        InOneDealCard(
          id: '4',
          title: 'Engineering networks project',
          company: 'Sunrise Travel',
          amount: r'$7,200',
          ownerInitials: 'MG',
          ownerTone: InOneTone.purple,
        ),
      ],
    ),
  ];

  static const deal = InOneDealDetail(
    id: '1',
    statusLabel: 'In progress',
    title: 'Office building · electrical works',
    amount: r'$12,400',
    probability: '65%',
    closeDate: 'Dec 12',
    age: '14 days',
    contactName: 'Anna Grigoryan',
    contactInfo: 'Acme LLC · Kentron',
    contactInitials: 'AG',
    stages: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won'],
    stageIndex: 2,
    activities: [
      InOneDealActivity(title: 'Proposal sent', time: 'Today · 10:30', icon: InOneIcons.quote),
      InOneDealActivity(
        title: 'Call with client',
        time: 'Yesterday',
        icon: InOneIcons.call,
        tone: InOneTone.blue,
      ),
    ],
  );

  static const userProfile = InOneUserProfile(
    name: 'Anna Grigoryan',
    handle: '@anna.inone • Workspace',
    myTasks: '14',
    activity: '4.9',
    projects: '312',
    verified: true,
  );

  static List<InOneProfileMenuItem> profileMenu() => [
        InOneProfileMenuItem(label: 'My tasks', icon: InOneIcons.campaign, onTap: () {}, accentTile: true),
        InOneProfileMenuItem(label: 'My projects', icon: InOneIcons.note, onTap: () {}, accentTile: true),
        InOneProfileMenuItem(label: 'Files & documents', icon: InOneIcons.files, onTap: () {}, accentTile: true),
        InOneProfileMenuItem(label: 'Workspace', icon: InOneIcons.workspace, onTap: () {}, accentTile: true),
        InOneProfileMenuItem(label: 'Privacy & security', icon: InOneIcons.privacy, onTap: () {}),
        InOneProfileMenuItem(label: 'Help & support', icon: InOneIcons.help, onTap: () {}),
        InOneProfileMenuItem(label: 'Settings', icon: InOneIcons.settings, onTap: () {}),
        InOneProfileMenuItem(label: 'Log out', icon: InOneIcons.logout, onTap: () {}, destructive: true),
      ];

  static const threadHeader = InOneThreadHeader(
    name: 'John Smith',
    statusLabel: 'Online',
    online: true,
    projectTitle: 'Office building · electrical works',
    projectSubtitle: r'$12,400',
  );

  static const thread = [
    InOneThreadItem(kind: InOneThreadItemKind.dayDivider, text: 'Today'),
    InOneThreadItem(
      kind: InOneThreadItemKind.text,
      text: 'Can you share the latest project update?',
      meta: '10:30',
    ),
    InOneThreadItem(
      kind: InOneThreadItemKind.text,
      mine: true,
      text: "Sure, I'm sending the files now.",
      meta: '10:32 · Read',
    ),
    InOneThreadItem(kind: InOneThreadItemKind.file, mine: true, fileLabel: 'project file'),
    InOneThreadItem(kind: InOneThreadItemKind.typing),
  ];

  static const requests = [
    InOneOrgRequest(
      id: '1',
      name: '«Ռոմաշկա» ՍՊԸ',
      date: '12.10.2026',
      status: InOneRequestStatus.pending,
    ),
    InOneOrgRequest(
      id: '2',
      name: '«Վեկտոր» ՓԲԸ',
      date: '03.10.2026',
      status: InOneRequestStatus.approved,
    ),
    InOneOrgRequest(
      id: '3',
      name: '«Ալֆա» ՍՊԸ',
      date: '21.09.2026',
      status: InOneRequestStatus.rejected,
    ),
  ];

  static const documents = [
    InOneDocument(id: 'd1', name: 'registration.pdf', typeLabel: 'Գրանցում'),
    InOneDocument(id: 'd2', name: 'authority.pdf', typeLabel: 'Լիազորություններ'),
  ];

  static const systemStatus = InOneSystemStatus(
    version: '1.0.0',
    maintenance: false,
    flags: {'push.enabled': true, 'marketplace.enabled': false},
  );
}
