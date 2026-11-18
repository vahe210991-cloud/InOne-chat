import 'package:flutter/material.dart';

import '../../models/inone_calendar_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_calendar_labels.dart';
import '../../widgets/inone_calendar_widgets.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';
import '../../widgets/inone_widgets.dart';

/// Screen 65 / D65 · Participant availability: занятость участников по часам
/// и выбор общего свободного времени.
class InOneAvailabilityScreen extends StatefulWidget {
  const InOneAvailabilityScreen({
    super.key,
    required this.subtitle,
    required this.rows,
    required this.slots,
    required this.onBack,
    required this.onConfirm,
    this.initialSlot = 0,
    this.startHour = 9,
    this.endHour = 15,
    this.labels = InOneCalendarLabels.hy,
  });

  /// Строка под заголовком («14 նոյեմբերի · Նախագծի քննարկում»).
  final String subtitle;
  final List<InOneAvailabilityRow> rows;

  /// Предложенные слоты (свободны у всех участников).
  final List<InOneTimeSlot> slots;
  final VoidCallback onBack;
  final ValueChanged<InOneTimeSlot> onConfirm;
  final int initialSlot;

  /// Видимый диапазон часов [startHour, endHour).
  final int startHour;
  final int endHour;
  final InOneCalendarLabels labels;

  @override
  State<InOneAvailabilityScreen> createState() => _InOneAvailabilityScreenState();
}

class _InOneAvailabilityScreenState extends State<InOneAvailabilityScreen> {
  late int _selected = widget.slots.isEmpty ? -1 : widget.initialSlot.clamp(0, widget.slots.length - 1).toInt();

  static const double _nameWidth = 104;
  static const double _rowHeight = 52;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final l = widget.labels;
    return InOneShell(
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
            child: Row(
              children: [
                Transform.translate(
                  offset: const Offset(-10, 0),
                  child: InOneIconAction(
                    icon: InOneIcons.back,
                    semanticLabel: l.back,
                    onTap: widget.onBack,
                    size: 28,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    l.availabilityTitle,
                    style: InOneText.style(18, FontWeight.w700, c.text, letterSpacing: -0.18),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
                    child: Text(widget.subtitle, style: InOneText.style(12.5, FontWeight.w400, c.muted)),
                  ),
                  _legend(context),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
                    child: _grid(context),
                  ),
                  InOneSectionTitle(l.suggestedTimes, top: 20),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (var i = 0; i < widget.slots.length; i++)
                          InOneChoicePill(
                            label: widget.slots[i].label,
                            selected: i == _selected,
                            onTap: () => setState(() => _selected = i),
                          ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
                    child: Text(l.allFree, style: InOneText.style(11.5, FontWeight.w400, c.muted)),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
            child: InOneButton(
              label: l.pickTime,
              onPressed: _selected < 0 ? null : () => widget.onConfirm(widget.slots[_selected]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _legend(BuildContext context) {
    final c = context.inone;
    final l = widget.labels;
    Widget swatch(Color? fill, Color border) => Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: fill,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: border),
          ),
        );
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
      child: Row(
        children: [
          swatch(null, c.line),
          const SizedBox(width: 6),
          Text(l.free, style: InOneText.style(11.5, FontWeight.w400, c.sub)),
          const SizedBox(width: 16),
          swatch(c.warnTint, c.warn),
          const SizedBox(width: 6),
          Text(l.busy, style: InOneText.style(11.5, FontWeight.w400, c.sub)),
        ],
      ),
    );
  }

  Widget _grid(BuildContext context) {
    final c = context.inone;
    final hours = widget.endHour - widget.startHour;
    return LayoutBuilder(
      builder: (context, box) {
        final hourWidth = (box.maxWidth - _nameWidth) / hours;
        final trackWidth = hourWidth * hours;
        final header = Padding(
          padding: const EdgeInsets.only(left: _nameWidth),
          child: SizedBox(
            height: 22,
            child: Row(
              children: [
                for (var h = 0; h < hours; h++)
                  SizedBox(
                    width: hourWidth,
                    child: Padding(
                      padding: const EdgeInsets.only(left: 2),
                      child: Text(
                        '${(widget.startHour + h).toString().padLeft(2, '0')}:00',
                        maxLines: 1,
                        overflow: TextOverflow.clip,
                        style: InOneText.style(10, FontWeight.w400, c.muted),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
        final rows = <Widget>[
          for (final r in widget.rows) _row(context, r, hourWidth, trackWidth),
        ];
        Widget? band;
        if (_selected >= 0) {
          final range = widget.slots[_selected].range;
          band = Positioned(
            left: _nameWidth + (range.startHour - widget.startHour) * hourWidth,
            width: (range.endHour - range.startHour) * hourWidth,
            top: 0,
            bottom: 0,
            child: IgnorePointer(
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0x1A77B72C),
                  border: Border.all(color: c.brand, width: 2),
                ),
              ),
            ),
          );
        }
        return Stack(
          children: [
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [header, ...rows]),
            if (band != null) band,
          ],
        );
      },
    );
  }

  Widget _row(BuildContext context, InOneAvailabilityRow r, double hourWidth, double trackWidth) {
    final c = context.inone;
    final (bg, fg) = inOneAvatarColors(c, r.tone);
    return Container(
      height: _rowHeight,
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.rowLine))),
      child: Row(
        children: [
          SizedBox(
            width: _nameWidth,
            child: Row(
              children: [
                InOneAvatar(initials: r.initials, background: bg, foreground: fg, size: 28, fontSize: 10),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    r.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: InOneText.style(12.5, FontWeight.w700, c.text),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(
            width: trackWidth,
            height: _rowHeight,
            child: Stack(
              children: [
                Positioned.fill(
                  child: CustomPaint(painter: _HourLinesPainter(color: c.rowLine, step: hourWidth)),
                ),
                for (final b in r.busy)
                  Positioned(
                    left: (b.startHour - widget.startHour) * hourWidth,
                    width: (b.endHour - b.startHour) * hourWidth - 2,
                    top: 6,
                    bottom: 6,
                    child: Container(
                      decoration: BoxDecoration(
                        color: c.warnTint,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: c.warn),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HourLinesPainter extends CustomPainter {
  _HourLinesPainter({required this.color, required this.step});
  final Color color;
  final double step;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
  }

  @override
  bool shouldRepaint(_HourLinesPainter old) => old.color != color || old.step != step;
}
