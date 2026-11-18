import 'package:flutter/material.dart';

import '../models/inone_calendar_models.dart';
import '../models/inone_models.dart';
import '../widgets/inone_icons.dart';

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

/// ДЕМО-ДАННЫЕ календаря (14 ноября 2026) — только для галереи и предпросмотра.
abstract final class InOneCalendarDemoData {
  static final DateTime today = DateTime(2026, 11, 14);
  static final DateTime now = DateTime(2026, 11, 14, 9, 41);

  static InOneCalendarEvent _e(
    String id,
    String title,
    InOneEventKind kind,
    int day,
    int h1,
    int m1, {
    int? h2,
    int m2 = 0,
    String subtitle = '',
  }) =>
      InOneCalendarEvent(
        id: id,
        title: title,
        kind: kind,
        subtitle: subtitle,
        start: DateTime(2026, 11, day, h1, m1),
        end: h2 == null ? null : DateTime(2026, 11, day, h2, m2),
      );

  static final List<InOneCalendarEvent> events = [
    _e('1', 'Նախագծի քննարկում', InOneEventKind.meeting, 14, 10, 0, h2: 11, subtitle: 'Գրասենյակ · 4 մասնակից'),
    _e('2', 'Հաճախորդի զանգ', InOneEventKind.call, 14, 12, 30, h2: 13, subtitle: 'Տեսազանգ · Աննա Գրիգորյան'),
    _e('3', 'Տեղանքի այց', InOneEventKind.visit, 14, 15, 0, h2: 16, m2: 30, subtitle: 'Կենտրոն, Երևան'),
    _e('4', 'Նախահաշվի ժամկետ', InOneEventKind.deadline, 14, 17, 0, subtitle: 'Առաջադրանք · Արամ Կարապետյան'),
    _e('5', 'Նախագծի քննարկում', InOneEventKind.meeting, 9, 10, 0, h2: 11, m2: 30, subtitle: 'Գրասենյակ'),
    _e('6', 'Հաճախորդի զանգ', InOneEventKind.call, 10, 9, 30, h2: 10, m2: 30, subtitle: 'Տեսազանգ'),
    _e('7', 'Տեղանքի այց', InOneEventKind.visit, 11, 13, 0, h2: 14, subtitle: 'Կենտրոն, Երևան'),
    _e('8', 'Թիմի հանդիպում', InOneEventKind.meeting, 12, 11, 0, h2: 12, m2: 30, subtitle: 'Գրասենյակ'),
    _e('9', 'Նախահաշվի ժամկետ', InOneEventKind.deadline, 13, 15, 0, h2: 16, subtitle: 'Առաջադրանք'),
    _e('10', 'Թիմի հանդիպում', InOneEventKind.meeting, 17, 10, 0, h2: 11, subtitle: 'Գրասենյակ'),
    _e('11', 'Հաճախորդի զանգ', InOneEventKind.call, 18, 12, 0, h2: 12, m2: 30, subtitle: 'Տեսազանգ'),
    _e('12', 'Նախահաշվի ժամկետ', InOneEventKind.deadline, 20, 17, 0, subtitle: 'Առաջադրանք'),
    _e('13', 'Թիմի հանդիպում', InOneEventKind.meeting, 24, 10, 0, h2: 11, subtitle: 'Գրասենյակ'),
    _e('14', 'Հաճախորդի զանգ', InOneEventKind.call, 24, 14, 0, h2: 14, m2: 30, subtitle: 'Տեսազանգ'),
  ];

  static const participants = [
    InOneParticipant(
      name: 'Աննա Գրիգորյան',
      initials: 'ԱԳ',
      status: InOneRsvp.going,
      isOrganizer: true,
      tone: InOneEventKind.meeting,
    ),
    InOneParticipant(
      name: 'Դավիթ Սարգսյան',
      initials: 'ԴՍ',
      status: InOneRsvp.going,
      tone: InOneEventKind.call,
    ),
    InOneParticipant(
      name: 'Մարիա Գևորգյան',
      initials: 'ՄԳ',
      status: InOneRsvp.pending,
      tone: InOneEventKind.visit,
    ),
    InOneParticipant(
      name: 'Արամ Կարապետյան',
      initials: 'ԱԿ',
      status: InOneRsvp.declined,
      tone: InOneEventKind.deadline,
    ),
  ];

  static InOneEventDetails detailsFor(InOneCalendarEvent event) => InOneEventDetails(
        event: event,
        organizerName: 'Աննա Գրիգորյան',
        dateLabel: 'Շաբաթ, 14 նոյեմբերի',
        timeLabel: '10:00 – 11:00 · 1 ժ',
        locationTitle: 'Գրասենյակ',
        locationSubtitle: 'Կենտրոն, Երևան',
        hasVideoCall: true,
        repeatLabel: 'Չի կրկնվում',
        reminderLabel: '15 րոպե առաջ',
        participants: participants,
        description: 'Քննարկում ենք նախագծի ընթացքը, ժամկետները և հաջորդ քայլերը։',
      );

  static const availability = [
    InOneAvailabilityRow(
      name: 'Աննա',
      initials: 'ԱԳ',
      busy: [InOneHourRange(12, 13)],
      tone: InOneEventKind.meeting,
    ),
    InOneAvailabilityRow(
      name: 'Դավիթ',
      initials: 'ԴՍ',
      busy: [InOneHourRange(9, 10), InOneHourRange(12.5, 13.5)],
      tone: InOneEventKind.call,
    ),
    InOneAvailabilityRow(
      name: 'Մարիա',
      initials: 'ՄԳ',
      busy: [InOneHourRange(11.5, 12.5)],
      tone: InOneEventKind.visit,
    ),
    InOneAvailabilityRow(
      name: 'Արամ',
      initials: 'ԱԿ',
      busy: [InOneHourRange(13, 14)],
      tone: InOneEventKind.deadline,
    ),
  ];

  static const slots = [
    InOneTimeSlot(label: '10:00 – 11:00', range: InOneHourRange(10, 11)),
    InOneTimeSlot(label: '11:00 – 12:00', range: InOneHourRange(11, 12)),
    InOneTimeSlot(label: '15:30 – 16:30', range: InOneHourRange(15.5, 16.5)),
  ];
}
