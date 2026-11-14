import 'package:flutter/foundation.dart';

/// Модели календаря. Без HTTP/хранилища; даты — настоящие [DateTime],
/// подписи форматирует [InOneCalendarLabels] (hy / ru / en).

enum InOneCalendarView { month, week, day }

/// Тип события: определяет цвет (зелёный, синий, фиолетовый, жёлтый).
enum InOneEventKind { meeting, call, visit, deadline }

enum InOneRsvp { going, pending, declined }

enum InOneReminder { none, min5, min15, hour1, day1 }

@immutable
class InOneCalendarEvent {
  const InOneCalendarEvent({
    required this.id,
    required this.title,
    required this.start,
    required this.kind,
    this.end,
    this.subtitle = '',
  });

  final String id;
  final String title;
  final DateTime start;

  /// `null` — событие без длительности (например, срок задачи).
  final DateTime? end;
  final InOneEventKind kind;
  final String subtitle;
}

@immutable
class InOneParticipant {
  const InOneParticipant({
    required this.name,
    required this.initials,
    required this.status,
    this.isOrganizer = false,
    this.tone = InOneEventKind.meeting,
  });

  final String name;
  final String initials;
  final InOneRsvp status;
  final bool isOrganizer;

  /// Цвет аватара (используется палитра типов событий).
  final InOneEventKind tone;
}

@immutable
class InOneEventDetails {
  const InOneEventDetails({
    required this.event,
    required this.organizerName,
    required this.dateLabel,
    required this.timeLabel,
    required this.repeatLabel,
    required this.reminderLabel,
    required this.participants,
    this.locationTitle,
    this.locationSubtitle,
    this.hasVideoCall = false,
    this.description,
  });

  final InOneCalendarEvent event;
  final String organizerName;

  /// Уже отформатированные строки («Շաբաթ, 14 նոյեմբերի», «10:00 – 11:00 · 1 ժ»).
  final String dateLabel;
  final String timeLabel;
  final String repeatLabel;
  final String reminderLabel;
  final List<InOneParticipant> participants;
  final String? locationTitle;
  final String? locationSubtitle;
  final bool hasVideoCall;
  final String? description;
}

/// Черновик нового события.
@immutable
class InOneEventDraft {
  const InOneEventDraft({
    required this.title,
    required this.start,
    required this.end,
    required this.allDay,
    required this.reminder,
    required this.repeatLabel,
    required this.participantCount,
    this.location = '',
  });

  final String title;
  final DateTime start;
  final DateTime end;
  final bool allDay;
  final InOneReminder reminder;
  final String repeatLabel;
  final int participantCount;
  final String location;
}

/// Строка таблицы доступности: занятые интервалы участника в часах (9.0 = 09:00).
@immutable
class InOneAvailabilityRow {
  const InOneAvailabilityRow({
    required this.name,
    required this.initials,
    required this.busy,
    this.tone = InOneEventKind.meeting,
  });

  final String name;
  final String initials;
  final List<InOneHourRange> busy;
  final InOneEventKind tone;
}

@immutable
class InOneHourRange {
  const InOneHourRange(this.startHour, this.endHour);
  final double startHour;
  final double endHour;
}

@immutable
class InOneTimeSlot {
  const InOneTimeSlot({required this.label, required this.range});
  final String label;
  final InOneHourRange range;
}
