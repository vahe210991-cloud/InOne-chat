import 'package:flutter/material.dart';

import '../../models/inone_calendar_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_calendar_labels.dart';
import '../../widgets/inone_calendar_layout.dart';
import '../../widgets/inone_calendar_widgets.dart';
import '../../widgets/inone_ds_widgets.dart';

/// Screen 62 / D62 · Calendar · Day: лента недели и таймлайн выбранного дня.
class InOneCalendarDayScreen extends StatelessWidget {
  const InOneCalendarDayScreen({
    super.key,
    required this.day,
    required this.now,
    required this.events,
    required this.onSelectDay,
    required this.onToday,
    required this.onSearch,
    required this.onView,
    required this.onAddEvent,
    required this.onOpenEvent,
    required this.onTab,
    required this.onAdd,
    this.labels = InOneCalendarLabels.hy,
    this.startHour = 8,
    this.endHour = 18,
  });

  final DateTime day;

  /// Текущее время для линии «сейчас».
  final DateTime now;
  final List<InOneCalendarEvent> events;
  final ValueChanged<DateTime> onSelectDay;
  final VoidCallback onToday;
  final VoidCallback onSearch;
  final ValueChanged<InOneCalendarView> onView;
  final VoidCallback onAddEvent;
  final ValueChanged<InOneCalendarEvent> onOpenEvent;
  final ValueChanged<InOneTab> onTab;
  final VoidCallback onAdd;
  final InOneCalendarLabels labels;
  final int startHour;
  final int endHour;

  static const double _hourHeight = 56;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final monday = inOneMondayOf(day);
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
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                    child: Text(labels.dayMonthWeekday(day), style: InOneText.style(13, FontWeight.w700, c.text)),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: Row(children: [for (final d in days) Expanded(child: _stripDay(context, d))]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(0, 14, 20, 14),
                    child: _timeline(context),
                  ),
                ],
              ),
            ),
          ),
          InOneCalendarDock(
            labels: labels,
            selected: InOneCalendarView.day,
            onSelect: onView,
            onAdd: onAddEvent,
          ),
        ],
      ),
    );
  }

  Widget _stripDay(BuildContext context, DateTime d) {
    final c = context.inone;
    final selected = inOneSameDay(d, day);
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
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: selected ? c.accent : Colors.transparent, shape: BoxShape.circle),
              child: Text(
                '${d.day}',
                style: InOneText.style(
                  14,
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

  Widget _timeline(BuildContext context) {
    final c = context.inone;
    final hours = endHour - startHour;
    final height = hours * _hourHeight;
    final dayEvents = events.where((e) => inOneSameDay(e.start, day)).toList();
    return SizedBox(
      height: height,
      child: LayoutBuilder(
        builder: (context, box) {
          final children = <Widget>[];
          for (var h = 0; h < hours; h++) {
            final top = h * _hourHeight;
            children.add(Positioned(left: 0, right: 0, top: top, child: Container(height: 1, color: c.rowLine)));
            children.add(
              Positioned(
                left: 0,
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
          final area = box.maxWidth - 56;
          for (final item in inOneLaneLayout(dayEvents)) {
            final e = item.event;
            final double a = inOneHourOf(e.start).clamp(startHour.toDouble(), endHour.toDouble()).toDouble();
            final bRaw = e.end == null ? inOneHourOf(e.start) + 1 : inOneHourOf(e.end!);
            final double b = bRaw.clamp(startHour.toDouble(), endHour.toDouble()).toDouble();
            if (b <= a) continue;
            final blockHeight = (b - a) * _hourHeight - 2;
            final laneWidth = area / item.lanes;
            children.add(
              Positioned(
                left: 56 + item.lane * laneWidth,
                width: laneWidth - (item.lanes > 1 ? 2 : 0),
                top: (a - startHour) * _hourHeight + 1,
                height: blockHeight,
                child: InOneEventBlock(
                  event: e,
                  compact: false,
                  showSubtitle: blockHeight >= 44,
                  onTap: () => onOpenEvent(e),
                ),
              ),
            );
          }
          final nowTop = (inOneHourOf(now) - startHour) * _hourHeight;
          if (inOneSameDay(day, now) && nowTop >= 0 && nowTop <= height) {
            children.add(Positioned(left: 48, right: 0, top: nowTop, child: Container(height: 1.5, color: c.dangerText)));
            children.add(
              Positioned(
                left: 44,
                top: nowTop - 3.25,
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(color: c.dangerText, shape: BoxShape.circle),
                ),
              ),
            );
          }
          return Stack(clipBehavior: Clip.none, children: children);
        },
      ),
    );
  }
}
