import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/inone_theme.dart';
import 'inone_icons.dart';

abstract final class InOneStrings {
  static const back = 'Հետ';
  static const menu = 'Մենյու';
  static const cancel = 'Չեղարկել';
}

// ---------------------------------------------------------------------------
// Раскладка экрана
// ---------------------------------------------------------------------------

/// Экран входа/заявок/настроек: прямоугольный фон на весь экран,
/// контент сверху, кнопки и формы — внизу («dock»).
class InOneScreen extends StatelessWidget {
  /// Заголовок h1 под строкой навигации (экраны SC-xx).
  const InOneScreen.auth({
    super.key,
    required String title,
    this.onBack,
    this.top = const <Widget>[],
    this.dock = const <Widget>[],
    this.banner,
  })  : _title = title,
        _bar = false,
        onMenu = null;

  /// Шапка h2 с кнопкой «Назад» и меню (экраны RQ/PS/ST).
  const InOneScreen.bar({
    super.key,
    required String title,
    this.onBack,
    this.onMenu,
    this.top = const <Widget>[],
    this.dock = const <Widget>[],
    this.banner,
  })  : _title = title,
        _bar = true;

  final String _title;
  final bool _bar;
  final VoidCallback? onBack;
  final VoidCallback? onMenu;
  final List<Widget> top;
  final List<Widget> dock;

  /// Текст баннера ошибки/состояния над формой (или null).
  final String? banner;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final bottomSafe = MediaQuery.of(context).padding.bottom;
    return Scaffold(
      backgroundColor: c.bg,
      body: SafeArea(
        bottom: false,
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: CustomScrollView(
              slivers: [
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_bar) _buildBar(context) else _buildNav(context),
                        if (!_bar) _buildTitle(context),
                        ...top,
                        const Spacer(),
                        Container(
                          color: c.bg,
                          padding: EdgeInsets.only(top: 12, bottom: bottomSafe + 24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (banner != null) InOneBanner.error(banner!),
                              ...dock,
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNav(BuildContext context) {
    return SizedBox(
      height: 48,
      child: Row(
        children: [
          if (onBack != null)
            _EdgeButton(
              icon: InOneIcons.back,
              semanticLabel: InOneStrings.back,
              onTap: onBack!,
              extendsRight: false,
            ),
        ],
      ),
    );
  }

  Widget _buildTitle(BuildContext context) {
    final c = context.inone;
    final size = (MediaQuery.of(context).size.width * 0.086).clamp(28.0, 34.0).toDouble();
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 24),
      child: Semantics(
        header: true,
        child: Text(
          _title,
          style: InOneText.style(size, FontWeight.w700, c.text, height: 1.1, letterSpacing: -0.02 * size),
        ),
      ),
    );
  }

  Widget _buildBar(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: SizedBox(
        height: 56,
        child: Row(
          children: [
            if (onBack != null)
              _EdgeButton(
                icon: InOneIcons.back,
                semanticLabel: InOneStrings.back,
                onTap: onBack!,
                extendsRight: false,
              ),
            if (onBack != null) const SizedBox(width: 4),
            Expanded(
              child: Semantics(
                header: true,
                child: Text(
                  _title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: InOneText.style(20, FontWeight.w700, c.text, letterSpacing: -0.2),
                ),
              ),
            ),
            if (onMenu != null) const SizedBox(width: 4),
            if (onMenu != null)
              _EdgeButton(
                icon: InOneIcons.menu,
                semanticLabel: InOneStrings.menu,
                onTap: onMenu!,
                extendsRight: true,
              ),
          ],
        ),
      ),
    );
  }
}

/// Кнопка 48×48 с выносом за край на 14 px (как margin -14 в дизайне).
class _EdgeButton extends StatelessWidget {
  const _EdgeButton({
    required this.icon,
    required this.semanticLabel,
    required this.onTap,
    required this.extendsRight,
  });

  final IconData icon;
  final String semanticLabel;
  final VoidCallback onTap;
  final bool extendsRight;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return SizedBox(
      width: 34,
      height: 48,
      child: OverflowBox(
        minWidth: 48,
        maxWidth: 48,
        minHeight: 48,
        maxHeight: 48,
        alignment: extendsRight ? Alignment.centerLeft : Alignment.centerRight,
        child: Semantics(
          button: true,
          label: semanticLabel,
          child: InkResponse(
            onTap: onTap,
            radius: 24,
            child: SizedBox(
              width: 48,
              height: 48,
              child: Icon(icon, size: 28, color: c.text),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Формы
// ---------------------------------------------------------------------------

/// Контроллеры полей формы + проверка обязательных полей.
class InOneFormController extends ChangeNotifier {
  InOneFormController({
    Iterable<String> required = const <String>[],
    Map<String, int> minLength = const <String, int>{},
  })  : _required = Set<String>.of(required),
        _minLength = Map<String, int>.of(minLength);

  final Set<String> _required;
  final Map<String, int> _minLength;
  final Map<String, TextEditingController> _controllers = <String, TextEditingController>{};
  final Set<String> _bad = <String>{};

  TextEditingController controller(String name) =>
      _controllers.putIfAbsent(name, () => TextEditingController());

  String value(String name) => _controllers[name]?.text ?? '';

  bool isBad(String name) => _bad.contains(name);

  /// Проверяет обязательные поля. Секреты не обрезаются, пробелы учитываются только при проверке пустоты.
  bool validate() {
    _bad.clear();
    for (final name in _required) {
      final length = value(name).trim().length;
      final min = _minLength[name] ?? 1;
      if (length < min) _bad.add(name);
    }
    notifyListeners();
    return _bad.isEmpty;
  }

  void clearBad(String name) {
    if (_bad.remove(name)) notifyListeners();
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }
}

class InOneLabel extends StatelessWidget {
  const InOneLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.only(left: 2, bottom: 6),
      child: Text(text, style: InOneText.style(13, FontWeight.w600, c.text2)),
    );
  }
}

class InOneField extends StatefulWidget {
  const InOneField({
    super.key,
    required this.form,
    required this.name,
    required this.label,
    this.keyboardType,
    this.obscure = false,
    this.autofillHints,
    this.textInputAction,
    this.onSubmitted,
    this.maxLength,
    this.enabled = true,
  });

  final InOneFormController form;
  final String name;
  final String label;
  final TextInputType? keyboardType;
  final bool obscure;
  final Iterable<String>? autofillHints;
  final TextInputAction? textInputAction;
  final VoidCallback? onSubmitted;
  final int? maxLength;
  final bool enabled;

  @override
  State<InOneField> createState() => _InOneFieldState();
}

class _InOneFieldState extends State<InOneField> {
  final FocusNode _focus = FocusNode();
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (mounted) setState(() => _focused = _focus.hasFocus);
    });
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  OutlineInputBorder _border(Color color) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(InOneRadius.field),
        borderSide: BorderSide(color: color),
      );

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return ListenableBuilder(
      listenable: widget.form,
      builder: (context, _) {
        final bad = widget.form.isBad(widget.name);
        return Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InOneLabel(widget.label),
              DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(InOneRadius.field),
                  boxShadow: (_focused && !bad)
                      ? [BoxShadow(color: c.ring, spreadRadius: 3)]
                      : const <BoxShadow>[],
                ),
                child: SizedBox(
                  height: 52,
                  child: TextField(
                    controller: widget.form.controller(widget.name),
                    focusNode: _focus,
                    enabled: widget.enabled,
                    keyboardType: widget.keyboardType,
                    obscureText: widget.obscure,
                    autofillHints: widget.autofillHints,
                    textInputAction: widget.textInputAction,
                    onSubmitted: widget.onSubmitted == null ? null : (_) => widget.onSubmitted!(),
                    autocorrect: false,
                    enableSuggestions: !widget.obscure,
                    textCapitalization: TextCapitalization.none,
                    textAlignVertical: TextAlignVertical.center,
                    cursorColor: c.green,
                    inputFormatters: widget.maxLength == null
                        ? null
                        : <TextInputFormatter>[LengthLimitingTextInputFormatter(widget.maxLength)],
                    style: InOneText.style(16, FontWeight.w500, c.text),
                    onChanged: (_) => widget.form.clearBad(widget.name),
                    decoration: InputDecoration(
                      isDense: true,
                      filled: true,
                      fillColor: c.surface,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                      border: _border(c.line),
                      enabledBorder: _border(bad ? c.danger : c.line),
                      focusedBorder: _border(bad ? c.danger : c.green),
                      disabledBorder: _border(c.line),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

enum InOneButtonKind { primary, outline }

class InOneButton extends StatelessWidget {
  const InOneButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.kind = InOneButtonKind.primary,
    this.loading = false,
    this.loadingLabel,
    this.small = false,
    this.leading,
  });

  final String label;

  /// `null` — кнопка заблокирована (opacity .5).
  final VoidCallback? onPressed;
  final InOneButtonKind kind;
  final bool loading;
  final String? loadingLabel;
  final bool small;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final primary = kind == InOneButtonKind.primary;
    final fg = primary ? c.onAccent : c.text;
    final text = (loading && loadingLabel != null) ? loadingLabel! : label;
    return Opacity(
      opacity: onPressed == null ? 0.5 : 1,
      child: Material(
        color: primary ? c.accent : c.surface,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(InOneRadius.button),
          side: BorderSide(color: primary ? Colors.transparent : c.line),
        ),
        child: InkWell(
          onTap: onPressed,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: small ? 44 : 52),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: small ? 0 : 10),
              child: Row(
                mainAxisSize: small ? MainAxisSize.min : MainAxisSize.max,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (loading) ...[
                    SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: fg),
                    ),
                    const SizedBox(width: 8),
                  ] else if (leading != null) ...[
                    leading!,
                    const SizedBox(width: 8),
                  ],
                  Flexible(
                    child: Text(
                      text,
                      textAlign: TextAlign.center,
                      style: InOneText.style(small ? 14 : 15, FontWeight.w700, fg, height: 1.25),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class InOneLink extends StatelessWidget {
  const InOneLink({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        foregroundColor: c.green,
        textStyle: InOneText.style(14, FontWeight.w600, c.green),
        shape: const RoundedRectangleBorder(),
      ),
      child: Text(label),
    );
  }
}

/// Ряд ссылок: по краям (`InOneLinks.row`) или по центру (`InOneLinks.column`).
class InOneLinks extends StatelessWidget {
  const InOneLinks.row({super.key, required this.children}) : _row = true;
  const InOneLinks.column({super.key, required this.children}) : _row = false;
  final List<Widget> children;
  final bool _row;

  @override
  Widget build(BuildContext context) {
    if (_row) {
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(
          alignment: WrapAlignment.spaceBetween,
          spacing: 8,
          runSpacing: 0,
          children: children,
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(children: children),
    );
  }
}

// ---------------------------------------------------------------------------
// Баннеры и заметки
// ---------------------------------------------------------------------------

enum InOneBannerKind { error, info }

class InOneBanner extends StatelessWidget {
  const InOneBanner.error(this.text, {super.key, this.bottom = 14}) : kind = InOneBannerKind.error;
  const InOneBanner.info(this.text, {super.key, this.bottom = 14}) : kind = InOneBannerKind.info;

  final String text;
  final InOneBannerKind kind;
  final double bottom;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final error = kind == InOneBannerKind.error;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        margin: EdgeInsets.only(bottom: bottom),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: error ? c.dangerSoft : c.soft,
          border: error ? null : Border.all(color: c.softLine),
          borderRadius: BorderRadius.circular(InOneRadius.field),
        ),
        child: Text(
          text,
          style: InOneText.style(14, FontWeight.w600, error ? c.danger : c.green, height: 1.4),
        ),
      ),
    );
  }
}

/// Пунктирная рамка (placeholder-блоки и выбор файла).
class InOneDashedBox extends StatelessWidget {
  const InOneDashedBox({
    super.key,
    required this.child,
    required this.color,
    this.radius = 14,
    this.strokeWidth = 1.5,
    this.padding = EdgeInsets.zero,
  });

  final Widget child;
  final Color color;
  final double radius;
  final double strokeWidth;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedPainter(color: color, radius: radius, strokeWidth: strokeWidth),
      child: Padding(padding: padding, child: child),
    );
  }
}

class _DashedPainter extends CustomPainter {
  _DashedPainter({required this.color, required this.radius, required this.strokeWidth});
  final Color color;
  final double radius;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final inset = strokeWidth / 2;
    final rrect = RRect.fromRectAndRadius(
      Rect.fromLTWH(inset, inset, size.width - strokeWidth, size.height - strokeWidth),
      Radius.circular(radius),
    );
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    const dash = 6.0;
    const gap = 4.0;
    for (final metric in (Path()..addRRect(rrect)).computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        canvas.drawPath(metric.extractPath(distance, distance + dash), paint);
        distance += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedPainter old) =>
      old.color != color || old.radius != radius || old.strokeWidth != strokeWidth;
}

/// Заметка-заглушка «ждёт решения владельца» (например, SC-09, D8).
/// Это временный блок: он должен быть заменён утверждённым текстом.
class InOneTodoNote extends StatelessWidget {
  const InOneTodoNote({super.key, required this.title, required this.text});
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: InOneDashedBox(
        color: c.line,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: SizedBox(
          width: double.infinity,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: InOneText.style(13, FontWeight.w700, c.text, height: 1.4)),
              const SizedBox(height: 2),
              Text(text, style: InOneText.style(13, FontWeight.w400, c.text2, height: 1.4)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Нейтральный текст по центру (`.note`).
class InOneNote extends StatelessWidget {
  const InOneNote(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: InOneText.style(14, FontWeight.w400, c.text2),
      ),
    );
  }
}

/// Вводный абзац (`.lead`): допускает жирные вставки.
class InOneLeadParagraph extends StatelessWidget {
  const InOneLeadParagraph({super.key, required this.spans});
  final List<InOneLeadSpan> spans;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Text.rich(
        TextSpan(
          children: [
            for (final s in spans)
              TextSpan(
                text: s.text,
                style: s.bold ? const TextStyle(fontWeight: FontWeight.w700) : null,
              ),
          ],
        ),
        style: InOneText.style(16, FontWeight.w400, c.text2, height: 1.5),
      ),
    );
  }
}

class InOneLeadSpan {
  const InOneLeadSpan(this.text, {this.bold = false});
  final String text;
  final bool bold;
}

// ---------------------------------------------------------------------------
// Чипы
// ---------------------------------------------------------------------------

class InOneChipOption<T> {
  const InOneChipOption(this.value, this.label);
  final T value;
  final String label;
}

class InOneChips<T> extends StatelessWidget {
  const InOneChips({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
    this.wrap = false,
    this.bottom = 12,
  });

  final List<InOneChipOption<T>> options;
  final T selected;
  final ValueChanged<T>? onChanged;
  final bool wrap;
  final double bottom;

  @override
  Widget build(BuildContext context) {
    final chips = <Widget>[
      for (final o in options)
        _InOneChip(
          label: o.label,
          selected: o.value == selected,
          onTap: onChanged == null ? null : () => onChanged!(o.value),
        ),
    ];
    final Widget body;
    if (wrap) {
      body = Wrap(spacing: 8, runSpacing: 8, children: chips);
    } else {
      body = SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (var i = 0; i < chips.length; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              chips[i],
            ],
          ],
        ),
      );
    }
    return Padding(padding: EdgeInsets.only(bottom: bottom), child: body);
  }
}

class _InOneChip extends StatelessWidget {
  const _InOneChip({required this.label, required this.selected, required this.onTap});
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
      child: Material(
        color: selected ? c.accent : c.surface,
        shape: StadiumBorder(side: BorderSide(color: selected ? c.accent : c.line)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.center,
            child: Text(
              label,
              maxLines: 1,
              style: InOneText.style(14, FontWeight.w600, selected ? c.onAccent : c.text),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Списки, карточки
// ---------------------------------------------------------------------------

class InOneListItem extends StatelessWidget {
  const InOneListItem({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.chevron = false,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool chevron;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final row = Container(
      constraints: const BoxConstraints(minHeight: 64),
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.line))),
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: InOneText.style(15, FontWeight.w600, c.text)),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(subtitle!, style: InOneText.style(13, FontWeight.w400, c.text2)),
                  ),
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 12), trailing!],
          if (chevron) ...[
            const SizedBox(width: 12),
            Icon(InOneIcons.chevronRight, size: 22, color: c.text2),
          ],
        ],
      ),
    );
    if (onTap == null) return row;
    return InkWell(onTap: onTap, child: row);
  }
}

enum InOneStatusKind { pending, approved, rejected }

class InOneStatusPill extends StatelessWidget {
  const InOneStatusPill({super.key, required this.label, required this.kind});
  final String label;
  final InOneStatusKind kind;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final Color bg;
    final Color fg;
    switch (kind) {
      case InOneStatusKind.pending:
        bg = c.line;
        fg = c.text;
      case InOneStatusKind.approved:
        bg = c.soft;
        fg = c.green;
      case InOneStatusKind.rejected:
        bg = c.dangerSoft;
        fg = c.danger;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(InOneRadius.pill)),
      child: Text(label, maxLines: 1, style: InOneText.style(12, FontWeight.w700, fg)),
    );
  }
}

class InOneSectionLabel extends StatelessWidget {
  const InOneSectionLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 20, 2, 4),
      child: Text(text, style: InOneText.style(13, FontWeight.w600, c.text2)),
    );
  }
}

class InOneKvRow {
  const InOneKvRow(this.label, {this.text, this.widget});
  final String label;
  final String? text;
  final Widget? widget;
}

/// Карточка «ключ — значение» (`.cd` + `.kv`).
class InOneKeyValueCard extends StatelessWidget {
  const InOneKeyValueCard({super.key, required this.rows});
  final List<InOneKvRow> rows;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border.all(color: c.line),
        borderRadius: BorderRadius.circular(InOneRadius.card),
      ),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                border: i == rows.length - 1 ? null : Border(bottom: BorderSide(color: c.line)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(rows[i].label, style: InOneText.style(15, FontWeight.w400, c.text2)),
                  const SizedBox(width: 12),
                  Flexible(
                    child: Align(
                      alignment: Alignment.centerRight,
                      child: rows[i].widget ??
                          Text(
                            rows[i].text ?? '',
                            textAlign: TextAlign.right,
                            style: InOneText.style(15, FontWeight.w600, c.text),
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

/// Выбор файла (`.pick`): пунктирная рамка, имя файла и кнопка.
class InOnePickRow extends StatelessWidget {
  const InOnePickRow({
    super.key,
    required this.title,
    required this.hint,
    required this.buttonLabel,
    required this.onPick,
  });

  final String title;
  final String hint;
  final String buttonLabel;
  final VoidCallback? onPick;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: InOneDashedBox(
        color: c.line,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: InOneText.style(15, FontWeight.w600, c.text)),
                  Text(hint, style: InOneText.style(13, FontWeight.w400, c.text2)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            InOneButton(
              label: buttonLabel,
              kind: InOneButtonKind.outline,
              small: true,
              onPressed: onPick,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Переключатель
// ---------------------------------------------------------------------------

class InOneSwitch extends StatelessWidget {
  const InOneSwitch({super.key, required this.value, required this.onChanged, this.semanticLabel});
  final bool value;

  /// `null` — переключатель заблокирован.
  final ValueChanged<bool>? onChanged;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Semantics(
      toggled: value,
      enabled: onChanged != null,
      label: semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onChanged == null ? null : () => onChanged!(!value),
        child: Opacity(
          opacity: onChanged == null ? 0.5 : 1,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 52,
            height: 32,
            decoration: BoxDecoration(
              color: value ? c.green : c.line,
              borderRadius: BorderRadius.circular(InOneRadius.pill),
            ),
            child: AnimatedAlign(
              duration: const Duration(milliseconds: 150),
              alignment: value ? Alignment.centerRight : Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class InOneSwitchRow extends StatelessWidget {
  const InOneSwitchRow({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Container(
      constraints: const BoxConstraints(minHeight: 56),
      margin: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(child: Text(label, style: InOneText.style(17, FontWeight.w600, c.text))),
          InOneSwitch(value: value, onChanged: onChanged, semanticLabel: label),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Диалог подтверждения
// ---------------------------------------------------------------------------

abstract final class InOneConfirmDialog {
  static Future<bool> show(
    BuildContext context, {
    required String message,
    required String confirmLabel,
    String cancelLabel = InOneStrings.cancel,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      barrierColor: const Color(0x73000000),
      builder: (ctx) {
        final c = ctx.inone;
        return Dialog(
          backgroundColor: c.surface,
          insetPadding: const EdgeInsets.all(20),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(InOneRadius.dialog)),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 340),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(message, style: InOneText.style(17, FontWeight.w700, c.text)),
                  const SizedBox(height: 16),
                  InOneButton(label: confirmLabel, onPressed: () => Navigator.of(ctx).pop(true)),
                  const SizedBox(height: 10),
                  InOneButton(
                    label: cancelLabel,
                    kind: InOneButtonKind.outline,
                    onPressed: () => Navigator.of(ctx).pop(false),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
    return result ?? false;
  }
}
