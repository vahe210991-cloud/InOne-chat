import 'package:flutter/material.dart';

import '../../models/inone_calendar_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_calendar_labels.dart';
import '../../widgets/inone_calendar_layout.dart';
import '../../widgets/inone_calendar_widgets.dart';
import '../../widgets/inone_ds_widgets.dart';

/// Screen 61 / D61 · Calendar · Week: сетка недели по часам.
class InOneCalendarWeekScreen extends StatelessWidget {
  const InOneCalendarWeekScreen({
    super.key,
    required this.weekOf,
    required this.selectedDay,
    required this.today,
    required this.now,
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
    this.startHour = 9,
    this.endHour = 17,
  });

  /// Любая дата отображаемой недели.
  final DateTime weekOf;
  final DateTime selectedDay;
  final DateTime today;

  /// Текущее время для линии «сейчас».
  final DateTime now;
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
  final VoidCallback onAdd;
  final InOneCalendarLabels labels;

  /// Видимый диапазон часов [startHour, endHour).
  final int startHour;
  final int endHour;

  static const double _hourHeight = 50;

  @override
  Widget build(BuildContext context) {
    final monday = inOneMondayOf(weekOf);
    final days = [for (var i = 0; i < 7; i++) monday.add(Duration(days: i))];
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
                  InOneCalendarNav(label: labels.weekRange(monday), onPrev: onPrev, onNext: onNext),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(44, 10, 12, 0),
                    child: Row(children: [for (final d in days) Expanded(child: _dayHead(context, d))]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(44, 10, 12, 14),
                    child: _timeline(context, days),
                  ),
                ],
              ),
            ),
          ),
          InOneCalendarDock(
            labels: labels,
            selected: InOneCalendarView.week,
            onSelect: onView,
            onAdd: onAddEvent,
          ),
        ],
      ),
    );
  }

  Widget _dayHead(BuildContext context, DateTime d) {
    final c = context.inone;
    final selected = inOneSameDay(d, selectedDay);
    return Semantics(
      button: true,
      selected: selected,
      label: labels.dayMonthWeekday(d),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => onSelectDay(d),
        child: Column(
          children: [
            Text(labels.weekdaysShort[d.weekday - 1], style: InOneText.style(10.5, FontWeight.w600, c.muted)),
            const SizedBox(height: 4),
            Container(
              width: 30,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: selected ? c.accent : Colors.transparent, shape: BoxShape.circle),
              child: Text(
                '${d.day}',
                style: InOneText.style(
                  13,
                  selected ? FontWeight.w800 : FontWeight.w600,
                  selected ? c.onAccent : c.text,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _timeline(BuildContext context, List<DateTime> days) {
    final c = context.inone;
    final hours = endHour - startHour;
    final height = hours * _hourHeight;
    return SizedBox(
      height: height,
      child: LayoutBuilder(
        builder: (context, box) {
          final colWidth = box.maxWidth / 7;
          final children = <Widget>[];
          for (var h = 0; h < hours; h++) {
            final top = h * _hourHeight;
            children.add(Positioned(left: 0, right: 0, top: top, child: Container(height: 1, color: c.rowLine)));
            children.add(
              Positioned(
                left: -44,
                width: 48,
                top: top - 7,
                child: Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Text(
                    '${(startHour + h).toString().padLeft(2, '0')}:00',
                    textAlign: TextAlign.right,
                    style: InOneText.style(10.5, FontWeight.w400, c.muted),
                  ),
                ),
              ),
            );
          }
          for (var i = 0; i < days.length; i++) {
            final dayEvents = events.where((e) => inOneSameDay(e.start, days[i])).toList();
            for (final item in inOneLaneLayout(dayEvents)) {
              final e = item.event;
              final double a = inOneHourOf(e.start).clamp(startHour.toDouble(), endHour.toDouble()).toDouble();
              final bRaw = e.end == null ? inOneHourOf(e.start) + 1 : inOneHourOf(e.end!);
              final double b = bRaw.clamp(startHour.toDouble(), endHour.toDouble()).toDouble();
              if (b <= a) continue;
              final laneWidth = (colWidth - 3) / item.lanes;
              children.add(
                Positioned(
                  left: i * colWidth + 1 + item.lane * laneWidth,
                  width: laneWidth - (item.lanes > 1 ? 1 : 0),
                  top: (a - startHour) * _hourHeight + 1,
                  height: (b - a) * _hourHeight - 2,
                  child: InOneEventBlock(event: e, compact: true, onTap: () => onOpenEvent(e)),
                ),
              );
            }
          }
          final nowTop = (inOneHourOf(now) - startHour) * _hourHeight;
          final nowVisible = days.any((d) => inOneSameDay(d, now)) && nowTop >= 0 && nowTop <= height;
          if (nowVisible) {
            children.add(
              Positioned(left: 0, right: 0, top: nowTop, child: Container(height: 1.5, color: c.dangerText)),
            );
          }
          return Stack(clipBehavior: Clip.none, children: children);
        },
      ),
    );
  }
}
