import 'package:flutter/widgets.dart';

/// Модели представления для экранов. Не содержат HTTP/хранилища:
/// репозиторий/контроллер приложения преобразует данные backend в эти типы.
/// Даты и время передаются уже отформатированными строками (локализация — на стороне вызывающего).

// --- Заявки организаций (RQ-xx, PS-xx)

enum InOneRequestStatus { pending, approved, rejected }

enum InOneDocType { registration, authority, other }

enum InOneDecision { approve, reject }

@immutable
class InOneOrgRequest {
  const InOneOrgRequest({
    required this.id,
    required this.name,
    required this.date,
    required this.status,
  });
  final String id;
  final String name;
  final String date;
  final InOneRequestStatus status;
}

@immutable
class InOneDocument {
  const InOneDocument({required this.id, required this.name, required this.typeLabel, this.mimeType});
  final String id;
  final String name;
  final String typeLabel;
  final String? mimeType;
}

@immutable
class InOneSystemStatus {
  const InOneSystemStatus({required this.version, required this.maintenance, required this.flags});
  final String version;
  final bool maintenance;
  final Map<String, bool> flags;
}

// --- Общее

enum InOneTone { blue, green, purple, neutral }

// --- Организация, пространство (Screen 02, 03)

@immutable
class InOneOrgProfile {
  const InOneOrgProfile({
    required this.name,
    required this.subtitle,
    required this.members,
    required this.projects,
    required this.teams,
    required this.about,
    this.verified = false,
    this.cover,
    this.logo,
    this.organizationMembers = const [],
    this.currentUserId,
    this.canAddMembers = false,
    this.canChangeMemberRoles = false,
    this.removableMemberIds = const {},
  });
  final String name;
  final String subtitle;
  final int? members;
  final List<({String userId, String role})> organizationMembers;
  final String? currentUserId;
  final bool canAddMembers;
  final bool canChangeMemberRoles;
  final Set<String> removableMemberIds;
  final int? projects;
  final int? teams;
  final String? about;
  final bool verified;
  final ImageProvider? cover;
  final ImageProvider? logo;
}

@immutable
class InOneWorkspaceSummary {
  const InOneWorkspaceSummary({
    required this.name,
    required this.activeProjects,
    required this.tasksDue,
    required this.teamMembers,
    required this.activeGroups,
    this.hasUnread = false,
    this.projectsCaption = 'in progress',
  });
  final String name;
  final int? activeProjects;
  final int? tasksDue;
  final int? teamMembers;
  final int? activeGroups;
  final bool hasUnread;
  final String projectsCaption;
}

@immutable
class InOneModuleTile {
  const InOneModuleTile({required this.label, required this.icon, required this.onTap});
  final String label;
  final IconData icon;
  final VoidCallback? onTap;
}

@immutable
class InOneActivityItem {
  const InOneActivityItem({
    required this.title,
    required this.subtitle,
    required this.time,
    required this.icon,
    this.highlighted = false,
  });
  final String title;
  final String subtitle;
  final String time;
  final IconData icon;
  final bool highlighted;
}

// --- Сообщения, уведомления (Screen 05, 06)

enum InOneChatKind { person, support, group, channel, system, unknown }

@immutable
class InOneChatPreview {
  const InOneChatPreview({
    required this.id,
    required this.name,
    required this.lastMessage,
    required this.time,
    required this.kind,
    this.unread = 0,
    this.initials,
  });
  final String id;
  final String name;
  final String? lastMessage;
  final String time;
  final InOneChatKind kind;
  final int unread;
  final String? initials;

  InOneChatPreview copyWith({int? unread, String? lastMessage, String? time}) => InOneChatPreview(
        id: id,
        name: name,
        lastMessage: lastMessage ?? this.lastMessage,
        time: time ?? this.time,
        kind: kind,
        unread: unread ?? this.unread,
        initials: initials,
      );
}

enum InOneNotificationKind { task, deadline, message, crm, calendar }

@immutable
class InOneNotificationItem {
  const InOneNotificationItem({
    required this.id,
    required this.title,
    required this.body,
    required this.timeAgo,
    required this.kind,
    this.unread = false,
  });
  final String id;
  final String title;
  final String body;
  final String timeAgo;
  final InOneNotificationKind kind;
  final bool unread;
}

// --- CRM (Screen 40, 41, 42)

enum InOneLeadStatus { fresh, contacted, qualified, won }

@immutable
class InOneLead {
  const InOneLead({
    required this.id,
    required this.name,
    required this.source,
    required this.status,
    required this.statusLabel,
    required this.timeAgo,
    required this.initials,
    this.tone = InOneTone.neutral,
  });
  final String id;
  final String name;
  final String source;
  final InOneLeadStatus status;
  final String statusLabel;
  final String timeAgo;
  final String initials;
  final InOneTone tone;
}

@immutable
class InOneLeadStats {
  const InOneLeadStats({
    required this.newCount,
    required this.qualifiedCount,
    required this.wonThisMonth,
  });
  final int newCount;
  final int qualifiedCount;
  final int wonThisMonth;
}

@immutable
class InOneDealCard {
  const InOneDealCard({
    required this.id,
    required this.title,
    required this.company,
    required this.amount,
    required this.ownerInitials,
    this.ownerTone = InOneTone.blue,
  });
  final String id;
  final String title;
  final String company;
  final String amount;
  final String ownerInitials;
  final InOneTone ownerTone;
}

@immutable
class InOneKanbanColumn {
  const InOneKanbanColumn({required this.title, required this.color, required this.cards});
  final String title;
  final Color color;
  final List<InOneDealCard> cards;
}

@immutable
class InOneDealActivity {
  const InOneDealActivity({
    required this.title,
    required this.time,
    required this.icon,
    this.tone = InOneTone.green,
  });
  final String title;
  final String time;
  final IconData icon;
  final InOneTone tone;
}

@immutable
class InOneDealDetail {
  const InOneDealDetail({
    required this.id,
    required this.statusLabel,
    required this.title,
    required this.amount,
    required this.probability,
    required this.closeDate,
    required this.age,
    required this.contactName,
    required this.contactInfo,
    required this.contactInitials,
    required this.stages,
    required this.stageIndex,
    required this.activities,
  });
  final String id;
  final String statusLabel;
  final String title;
  final String amount;
  final String probability;
  final String closeDate;
  final String age;
  final String contactName;
  final String contactInfo;
  final String contactInitials;

  /// Названия этапов воронки по порядку (New … Won).
  final List<String> stages;

  /// Индекс текущего этапа в [stages].
  final int stageIndex;
  final List<InOneDealActivity> activities;
}

// --- Профиль (Screen 43)

@immutable
class InOneUserProfile {
  const InOneUserProfile({
    required this.name,
    required this.handle,
    required this.myTasks,
    required this.activity,
    required this.projects,
    this.verified = false,
    this.avatar,
  });
  final String name;
  final String handle;
  final String myTasks;
  final String activity;
  final String projects;
  final bool verified;
  final ImageProvider? avatar;
}

@immutable
class InOneProfileMenuItem {
  const InOneProfileMenuItem({
    required this.label,
    required this.icon,
    required this.onTap,
    this.accentTile = false,
    this.destructive = false,
  });
  final String label;
  final IconData icon;
  final VoidCallback? onTap;

  /// Зелёная подложка иконки (рабочие разделы) вместо нейтральной.
  final bool accentTile;
  final bool destructive;
}

// --- Чат (Screen 46)

enum InOneThreadItemKind { text, file, typing, dayDivider }

@immutable
class InOneThreadItem {
  const InOneThreadItem({
    required this.kind,
    this.text,
    this.mine = false,
    this.meta,
    this.fileLabel,
    this.fileId,
  });
  final InOneThreadItemKind kind;
  final String? text;
  final bool mine;

  /// Подпись под сообщением (время, «Read»).
  final String? meta;

  /// Подпись вложения (для [InOneThreadItemKind.file]).
  final String? fileLabel;
  final String? fileId;
}

@immutable
class InOneThreadHeader {
  const InOneThreadHeader({
    required this.name,
    required this.statusLabel,
    required this.online,
    this.projectTitle,
    this.projectSubtitle,
  });
  final String name;
  final String statusLabel;
  final bool online;
  final String? projectTitle;
  final String? projectSubtitle;
}
