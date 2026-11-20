import 'package:flutter/material.dart';

import '../../models/inone_calendar_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_calendar_labels.dart';
import '../../widgets/inone_calendar_widgets.dart';
import '../../widgets/inone_ds_widgets.dart';

/// Screen 60 / D60 · Calendar · Month: сетка месяца с метками событий и список выбранного дня.
class InOneCalendarMonthScreen extends StatelessWidget {
  const InOneCalendarMonthScreen({
    super.key,
    required this.month,
    required this.selectedDay,
    required this.today,
    required this.events,
    required this.onSelectDay,
    required this.onPrev,
    required this.onNext,
    required this.onToday,
    required this.onSearch,
    required this.onView,
    required this.onAddEvent,
    required this.onOpenEvent,
    required this.onTab,
    required this.onAdd,
    this.labels = InOneCalendarLabels.hy,
  });

  /// Любая дата отображаемого месяца.
  final DateTime month;
  final DateTime selectedDay;
  final DateTime today;
  final List<InOneCalendarEvent> events;
  final ValueChanged<DateTime> onSelectDay;
  final VoidCallback onPrev;
  final VoidCallback onNext;
  final VoidCallback onToday;
  final VoidCallback onSearch;
  final ValueChanged<InOneCalendarView> onView;
  final VoidCallback onAddEvent;
  final ValueChanged<InOneCalendarEvent> onOpenEvent;
  final ValueChanged<InOneTab> onTab;

  /// «+» в нижней навигации — добавить публикацию.
  final VoidCallback onAdd;
  final InOneCalendarLabels labels;

  List<InOneEventKind> _kinds(DateTime day) {
    final kinds = <InOneEventKind>[];
    for (final e in events) {
      if (inOneSameDay(e.start, day) && !kinds.contains(e.kind)) kinds.add(e.kind);
      if (kinds.length == 3) break;
    }
    return kinds;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final first = DateTime(month.year, month.month, 1);
    final gridStart = inOneMondayOf(first);
    final dayEvents = events.where((e) => inOneSameDay(e.start, selectedDay)).toList()
      ..sort((a, b) => a.start.compareTo(b.start));
    return InOneShell(
      nav: InOneBottomNav(selected: null, onSelected: onTab, onAdd: onAdd),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  InOneCalendarHeader(labels: labels, onToday: onToday, onSearch: onSearch),
                  InOneCalendarNav(label: labels.monthYear(first), onPrev: onPrev, onNext: onNext),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
                    child: Row(
                      children: [
                        for (final d in labels.weekdaysShort)
                          Expanded(
                            child: Text(
                              d,
                              textAlign: TextAlign.center,
                              style: InOneText.style(10.5, FontWeight.w600, c.muted),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Column(
                      children: [
                        for (var row = 0; row < 6; row++) ...[
                          if (row > 0) const SizedBox(height: 2),
                          Row(
                            children: [
                              for (var col = 0; col < 7; col++)
                                _cell(context, gridStart.add(Duration(days: row * 7 + col)), first),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 4),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          labels.dayMonthWeekday(selectedDay),
                          style: InOneText.style(14, FontWeight.w700, c.text),
                        ),
                        Text(
                          labels.eventsCount(dayEvents.length),
                          style: InOneText.style(11.5, FontWeight.w400, c.muted),
                        ),
                      ],
                    ),
                  ),
                  for (final e in dayEvents) InOneEventRow(event: e, onTap: () => onOpenEvent(e)),
                  const SizedBox(height: 8),
                ],
              ),
            ),
          ),
          InOneCalendarDock(
            labels: labels,
            selected: InOneCalendarView.month,
            onSelect: onView,
            onAdd: onAddEvent,
          ),
        ],
      ),
    );
  }

  Widget _cell(BuildContext context, DateTime d, DateTime firstOfMonth) {
    final c = context.inone;
    final inMonth = d.month == firstOfMonth.month;
    final selected = inOneSameDay(d, selectedDay);
    final isToday = inOneSameDay(d, today);
    final kinds = inMonth ? _kinds(d) : const <InOneEventKind>[];
    final Color numberColor;
    if (selected) {
      numberColor = c.onAccent;
    } else if (!inMonth) {
      numberColor = c.hint;
    } else if (isToday) {
      numberColor = c.link;
    } else {
      numberColor = c.text;
    }
    return Expanded(
      child: Semantics(
        button: true,
        selected: selected,
        label: labels.dayMonth(d),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => onSelectDay(d),
          child: SizedBox(
            height: 42,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 30,
                  height: 30,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: selected ? c.accent : Colors.transparent,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '${d.day}',
                    style: InOneText.style(
                      13,
                      (selected || isToday) ? FontWeight.w800 : FontWeight.w600,
                      numberColor,
                    ),
                  ),
                ),
                const SizedBox(height: 3),
                SizedBox(
                  height: 4,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (var i = 0; i < kinds.length; i++) ...[
                        if (i > 0) const SizedBox(width: 3),
                        Container(
                          width: 4,
                          height: 4,
                          decoration: BoxDecoration(
                            color: inOneKindStyle(c, kinds[i]).bar,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
