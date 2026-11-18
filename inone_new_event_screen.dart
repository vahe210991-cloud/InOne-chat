import 'package:flutter/material.dart';

import '../../models/inone_calendar_models.dart';
import '../../state/inone_state.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_calendar_labels.dart';
import '../../widgets/inone_calendar_widgets.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';
import '../../widgets/inone_widgets.dart';

/// Screen 64 / D64 · New event: форма нового события (поля внизу экрана).
class InOneNewEventScreen extends StatefulWidget {
  const InOneNewEventScreen({
    super.key,
    required this.initialStart,
    required this.onSave,
    required this.onClose,
    required this.onEditParticipants,
    required this.onPickRepeat,
    this.initialParticipants = const <InOneParticipant>[],
    this.initialRepeatLabel = '',
    this.labels = InOneCalendarLabels.hy,
  });

  /// Начало нового события (по умолчанию конец — через час).
  final DateTime initialStart;

  /// Сохранение. `null` — успех (экран закрывает вызывающий код).
  final Future<InOneFailure?> Function(InOneEventDraft draft) onSave;
  final VoidCallback onClose;

  /// Выбор участников; возвращает новый список или `null`, если выбор отменён.
  final Future<List<InOneParticipant>?> Function(List<InOneParticipant> current) onEditParticipants;

  /// Выбор повторения; возвращает подпись или `null`, если выбор отменён.
  final Future<String?> Function(String current) onPickRepeat;
  final List<InOneParticipant> initialParticipants;

  /// Подпись «не повторяется» на нужном языке.
  final String initialRepeatLabel;
  final InOneCalendarLabels labels;

  @override
  State<InOneNewEventScreen> createState() => _InOneNewEventScreenState();
}

class _InOneNewEventScreenState extends State<InOneNewEventScreen> with InOneActionState<InOneNewEventScreen> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _location = TextEditingController();
  late DateTime _start = widget.initialStart;
  late DateTime _end = widget.initialStart.add(const Duration(hours: 1));
  late List<InOneParticipant> _participants = widget.initialParticipants;
  late String _repeat = widget.initialRepeatLabel;
  bool _allDay = false;
  bool _titleBad = false;
  InOneReminder _reminder = InOneReminder.min15;

  @override
  void dispose() {
    _title.dispose();
    _location.dispose();
    super.dispose();
  }

  Future<DateTime?> _pick(DateTime initial) async {
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(initial.year - 1),
      lastDate: DateTime(initial.year + 5),
    );
    if (date == null || !mounted) return null;
    if (_allDay) return DateTime(date.year, date.month, date.day, initial.hour, initial.minute);
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
    if (time == null) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _pickStart() async {
    final picked = await _pick(_start);
    if (picked == null || !mounted) return;
    setState(() {
      final length = _end.difference(_start);
      _start = picked;
      _end = picked.add(length.isNegative ? const Duration(hours: 1) : length);
    });
  }

  Future<void> _pickEnd() async {
    final picked = await _pick(_end);
    if (picked == null || !mounted) return;
    setState(() => _end = picked.isBefore(_start) ? _start.add(const Duration(hours: 1)) : picked);
  }

  Future<void> _editParticipants() async {
    final result = await widget.onEditParticipants(_participants);
    if (result == null || !mounted) return;
    setState(() => _participants = result);
  }

  Future<void> _editRepeat() async {
    final result = await widget.onPickRepeat(_repeat);
    if (result == null || !mounted) return;
    setState(() => _repeat = result);
  }

  void _save() {
    if (_title.text.trim().isEmpty) {
      setState(() => _titleBad = true);
      return;
    }
    final draft = InOneEventDraft(
      title: _title.text.trim(),
      start: _start,
      end: _end,
      allDay: _allDay,
      reminder: _reminder,
      repeatLabel: _repeat,
      participantCount: _participants.length,
      location: _location.text.trim(),
    );
    run('save', () => widget.onSave(draft));
  }

  String _startLabel() {
    final l = widget.labels;
    return _allDay ? l.dayMonthShort(_start) : '${l.dayMonthShort(_start)} · ${inOneHm(_start)}';
  }

  String _endLabel() {
    final l = widget.labels;
    if (_allDay) return l.dayMonthShort(_end);
    return inOneSameDay(_start, _end) ? inOneHm(_end) : '${l.dayMonthShort(_end)} · ${inOneHm(_end)}';
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final l = widget.labels;
    final banner = bannerText;
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
                    icon: InOneIcons.close,
                    semanticLabel: l.close,
                    onTap: widget.onClose,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    l.newEventTitle,
                    style: InOneText.style(18, FontWeight.w700, c.text, letterSpacing: -0.18),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: LayoutBuilder(
              builder: (context, box) => SingleChildScrollView(
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: box.maxHeight),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _group(l.fieldTitle, _textBox(_title, hint: null, bad: _titleBad, onChanged: (_) {
                          if (_titleBad) setState(() => _titleBad = false);
                        })),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              flex: 14,
                              child: _group(l.fieldStart, _tapBox(child: _valueText(_startLabel(), 14), onTap: _pickStart)),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              flex: 10,
                              child: _group(l.fieldEnd, _tapBox(child: _valueText(_endLabel(), 14), onTap: _pickEnd)),
                            ),
                          ],
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 40),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(l.allDay, style: InOneText.style(15, FontWeight.w600, c.text)),
                                InOneSwitch(
                                  value: _allDay,
                                  semanticLabel: l.allDay,
                                  onChanged: (v) => setState(() => _allDay = v),
                                ),
                              ],
                            ),
                          ),
                        ),
                        _group(l.fieldParticipants, _tapBox(onTap: _editParticipants, child: _participantsRow(context))),
                        _group(
                          l.fieldLocation,
                          _textBox(
                            _location,
                            hint: l.addLocation,
                            leading: Icon(InOneIcons.pin, size: 19, color: c.muted),
                          ),
                        ),
                        _group(
                          l.fieldReminder,
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              for (final r in InOneReminder.values)
                                InOneChoicePill(
                                  label: l.reminderOptions[r.index],
                                  selected: r == _reminder,
                                  onTap: () => setState(() => _reminder = r),
                                ),
                            ],
                          ),
                        ),
                        _group(
                          l.fieldRepeat,
                          _tapBox(
                            onTap: _editRepeat,
                            child: Row(
                              children: [
                                Icon(InOneIcons.repeat, size: 19, color: c.muted),
                                const SizedBox(width: 12),
                                Expanded(child: _valueText(_repeat, 15)),
                                Icon(InOneIcons.chevronRight, size: 20, color: c.muted),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (banner != null) InOneBanner.error(banner),
                InOneButton(label: l.save, loading: isBusy('save'), onPressed: blocked ? null : _save),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _group(String label, Widget child) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 2, bottom: 6),
            child: Text(label, style: InOneText.style(13, FontWeight.w600, c.sub)),
          ),
          child,
        ],
      ),
    );
  }

  Widget _valueText(String text, double size) {
    final c = context.inone;
    return Text(
      text,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: InOneText.style(size, FontWeight.w500, c.text),
    );
  }

  Widget _box({required Widget child, bool bad = false}) {
    final c = context.inone;
    return Container(
      height: 52,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        border: Border.all(color: bad ? c.dangerText : c.line),
        borderRadius: BorderRadius.circular(InOneRadius.field),
      ),
      child: child,
    );
  }

  Widget _tapBox({required Widget child, required VoidCallback onTap}) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: _box(child: Align(alignment: Alignment.centerLeft, child: child)),
      );

  Widget _textBox(
    TextEditingController controller, {
    required String? hint,
    bool bad = false,
    Widget? leading,
    ValueChanged<String>? onChanged,
  }) {
    final c = context.inone;
    return _box(
      bad: bad,
      child: Row(
        children: [
          if (leading != null) ...[leading, const SizedBox(width: 12)],
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              cursorColor: c.link,
              style: InOneText.style(15, FontWeight.w500, c.text),
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: hint,
                hintStyle: InOneText.style(15, FontWeight.w500, c.hint),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _participantsRow(BuildContext context) {
    final c = context.inone;
    final l = widget.labels;
    final shown = _participants.take(3).toList();
    return Row(
      children: [
        for (var i = 0; i < shown.length; i++)
          Transform.translate(
            offset: Offset(-8.0 * i, 0),
            child: Container(
              decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: c.bg, width: 2)),
              child: Builder(
                builder: (context) {
                  final (bg, fg) = inOneAvatarColors(c, shown[i].tone);
                  return InOneAvatar(initials: shown[i].initials, background: bg, foreground: fg, size: 28, fontSize: 10);
                },
              ),
            ),
          ),
        SizedBox(width: shown.isEmpty ? 0 : 2),
        Expanded(
          child: Text(
            l.participantsCount(_participants.length),
            style: InOneText.style(14, FontWeight.w400, c.sub),
          ),
        ),
        Icon(InOneIcons.plus, size: 20, color: c.link),
      ],
    );
  }
}
