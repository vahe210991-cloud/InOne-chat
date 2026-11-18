import 'package:flutter/material.dart';

import '../models/inone_calendar_models.dart';
import '../theme/inone_colors.dart';
import '../theme/inone_theme.dart';
import 'inone_calendar_labels.dart';
import 'inone_ds_widgets.dart';
import 'inone_icons.dart';

/// Цвета типа события: полоса/метка, фон блока, цвет текста/границы блока.
class InOneEventKindStyle {
  const InOneEventKindStyle({required this.bar, required this.background, required this.foreground});
  final Color bar;
  final Color background;
  final Color foreground;
}

InOneEventKindStyle inOneKindStyle(InOneColors c, InOneEventKind kind) {
  switch (kind) {
    case InOneEventKind.meeting:
      return InOneEventKindStyle(bar: c.brand, background: c.soft, foreground: c.link);
    case InOneEventKind.call:
      return InOneEventKindStyle(bar: c.blue, background: c.blueTint, foreground: c.blue);
    case InOneEventKind.visit:
      return InOneEventKindStyle(bar: c.purple, background: c.purpleTint, foreground: c.purple);
    case InOneEventKind.deadline:
      return InOneEventKindStyle(bar: c.warn, background: c.warnTint, foreground: c.warn);
  }
}

String inOneKindLabel(InOneCalendarLabels l, InOneEventKind kind) {
  switch (kind) {
    case InOneEventKind.meeting:
      return l.kindMeeting;
    case InOneEventKind.call:
      return l.kindCall;
    case InOneEventKind.visit:
      return l.kindVisit;
    case InOneEventKind.deadline:
      return l.kindDeadline;
  }
}

String inOneHm(DateTime d) =>
    '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

DateTime inOneDateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

bool inOneSameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

/// Понедельник недели, в которую входит [d].
DateTime inOneMondayOf(DateTime d) {
  final day = inOneDateOnly(d);
  return day.subtract(Duration(days: day.weekday - 1));
}

/// Шапка календарных экранов: заголовок, «Сегодня», поиск.
class InOneCalendarHeader extends StatelessWidget {
  const InOneCalendarHeader({
    super.key,
    required this.labels,
    required this.onToday,
    required this.onSearch,
  });

  final InOneCalendarLabels labels;
  final VoidCallback onToday;
  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
      child: Row(
        children: [
          Expanded(
            child: Text(
              labels.title,
              style: InOneText.style(24, FontWeight.w600, c.text, letterSpacing: -0.48),
            ),
          ),
          Semantics(
            button: true,
            label: labels.today,
            child: GestureDetector(
              onTap: onToday,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                decoration: BoxDecoration(color: c.fill, borderRadius: BorderRadius.circular(InOneRadius.pill)),
                child: Text(labels.today, style: InOneText.style(12.5, FontWeight.w600, c.textSoft)),
              ),
            ),
          ),
          const SizedBox(width: 8),
          InOneIconAction(icon: InOneIcons.search, semanticLabel: labels.search, onTap: onSearch),
        ],
      ),
    );
  }
}

/// Стрелки «назад/вперёд» с подписью периода.
class InOneCalendarNav extends StatelessWidget {
  const InOneCalendarNav({super.key, required this.label, required this.onPrev, required this.onNext});

  final String label;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    Widget arrow(IconData icon, VoidCallback onTap, {required bool leading}) => SizedBox(
          width: 24,
          height: 40,
          child: OverflowBox(
            minWidth: 40,
            maxWidth: 40,
            alignment: leading ? Alignment.centerRight : Alignment.centerLeft,
            child: InkResponse(
              onTap: onTap,
              radius: 20,
              child: SizedBox(width: 40, height: 40, child: Icon(icon, size: 22, color: c.text)),
            ),
          ),
        );
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          arrow(InOneIcons.back, onPrev, leading: true),
          Text(label, style: InOneText.style(15, FontWeight.w700, c.text)),
          arrow(InOneIcons.chevronRight, onNext, leading: false),
        ],
      ),
    );
  }
}

/// Нижняя панель календаря: переключатель Месяц/Неделя/День и кнопка «+ событие».
class InOneCalendarDock extends StatelessWidget {
  const InOneCalendarDock({
    super.key,
    required this.labels,
    required this.selected,
    required this.onSelect,
    required this.onAdd,
  });

  final InOneCalendarLabels labels;
  final InOneCalendarView selected;
  final ValueChanged<InOneCalendarView> onSelect;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final items = <(InOneCalendarView, String)>[
      (InOneCalendarView.month, labels.viewMonth),
      (InOneCalendarView.week, labels.viewWeek),
      (InOneCalendarView.day, labels.viewDay),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
      child: Row(
        children: [
          Expanded(
            child: Container(
              height: 44,
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(color: c.fill, borderRadius: BorderRadius.circular(InOneRadius.pill)),
              child: Row(
                children: [
                  for (final (view, label) in items)
                    Expanded(
                      child: Semantics(
                        button: true,
                        selected: view == selected,
                        label: label,
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: () => onSelect(view),
                          child: Container(
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: view == selected ? c.chipOnBg : Colors.transparent,
                              borderRadius: BorderRadius.circular(InOneRadius.pill),
                            ),
                            child: Text(
                              label,
                              style: InOneText.style(
                                12.5,
                                FontWeight.w600,
                                view == selected ? c.chipOnFg : c.textSoft,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 10),
          Semantics(
            button: true,
            label: labels.addEvent,
            child: GestureDetector(
              onTap: onAdd,
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: c.accent, borderRadius: BorderRadius.circular(14)),
                child: Icon(InOneIcons.plus, size: 24, color: c.onAccent),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Строка события в списке дня.
class InOneEventRow extends StatelessWidget {
  const InOneEventRow({super.key, required this.event, required this.onTap});

  final InOneCalendarEvent event;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final style = inOneKindStyle(c, event.kind);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 11),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: 46,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(inOneHm(event.start), style: InOneText.style(11.5, FontWeight.w700, c.text, height: 1.35)),
                    Text(
                      event.end == null ? '—' : inOneHm(event.end!),
                      style: InOneText.style(11.5, FontWeight.w400, c.muted, height: 1.35),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Container(
                width: 4,
                decoration: BoxDecoration(color: style.bar, borderRadius: BorderRadius.circular(2)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(event.title, style: InOneText.style(13.5, FontWeight.w700, c.text)),
                    if (event.subtitle.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(event.subtitle, style: InOneText.style(11.5, FontWeight.w400, c.muted)),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Блок события на временной сетке: цветная левая кромка + текст.
class InOneEventBlock extends StatelessWidget {
  const InOneEventBlock({
    super.key,
    required this.event,
    required this.compact,
    this.showSubtitle = false,
    this.onTap,
  });

  final InOneCalendarEvent event;

  /// Узкий блок недели: меньший шрифт и отступы.
  final bool compact;
  final bool showSubtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final style = inOneKindStyle(c, event.kind);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(color: style.background, borderRadius: BorderRadius.circular(10)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: compact ? 2 : 3, color: style.foreground),
            Expanded(
              child: Padding(
                padding: compact
                    ? const EdgeInsets.fromLTRB(3, 4, 4, 4)
                    : EdgeInsets.fromLTRB(9, showSubtitle ? 6 : 5, 9, 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      event.title,
                      maxLines: compact ? 2 : 1,
                      overflow: TextOverflow.ellipsis,
                      style: InOneText.style(compact ? 10 : 11.5, FontWeight.w700, c.text, height: 1.25),
                    ),
                    if (showSubtitle && event.subtitle.isNotEmpty) ...[
                      const SizedBox(height: 1),
                      Text(
                        event.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: InOneText.style(10.5, FontWeight.w400, c.sub),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Строка «иконка + заголовок + подпись» (карточка события).
class InOneInfoRow extends StatelessWidget {
  const InOneInfoRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.last = false,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool last;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 13),
        decoration: BoxDecoration(border: last ? null : Border(bottom: BorderSide(color: c.rowLine))),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InOneIconTile(icon: icon, background: c.fill, foreground: c.textSoft, size: 36, radius: 11, iconSize: 19),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: InOneText.style(13.5, FontWeight.w700, c.text)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: InOneText.style(12, FontWeight.w400, c.muted)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Мелкая подпись-заголовок секции (13 w700).
class InOneSectionTitle extends StatelessWidget {
  const InOneSectionTitle(this.text, {super.key, this.top = 16});
  final String text;
  final double top;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, top, 20, 8),
      child: Text(text, style: InOneText.style(13, FontWeight.w700, c.text)),
    );
  }
}

/// Круглая «пилюля»-вариант (напоминания, временные слоты).
class InOneChoicePill extends StatelessWidget {
  const InOneChoicePill({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          decoration: BoxDecoration(
            color: selected ? c.chipOnBg : c.fill,
            borderRadius: BorderRadius.circular(InOneRadius.pill),
          ),
          child: Text(
            label,
            style: InOneText.style(13, FontWeight.w600, selected ? c.chipOnFg : c.textSoft),
          ),
        ),
      ),
    );
  }
}

/// Цвета аватара по палитре типов событий.
(Color, Color) inOneAvatarColors(InOneColors c, InOneEventKind tone) {
  final s = inOneKindStyle(c, tone);
  return (s.background, s.foreground);
}
