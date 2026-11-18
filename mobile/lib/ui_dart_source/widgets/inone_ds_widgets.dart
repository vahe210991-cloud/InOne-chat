import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/inone_theme.dart';
import 'inone_bottom_nav.dart';
import 'inone_icons.dart';

/// Каркас основных экранов: прямоугольный фон, системная строка состояния
/// и системный индикатор жестов остаются за ОС (в макете они нарисованы).
class InOneShell extends StatelessWidget {
  const InOneShell({super.key, required this.body, this.nav});

  final Widget body;
  final InOneBottomNav? nav;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Scaffold(
      backgroundColor: c.bg,
      body: SafeArea(
        bottom: nav == null,
        child: Column(
          children: [
            Expanded(child: body),
            if (nav != null) nav!,
          ],
        ),
      ),
    );
  }
}

/// Диагональная штриховка — заглушка под фото/обложку.
class InOneStripeBox extends StatelessWidget {
  const InOneStripeBox({
    super.key,
    this.width,
    this.height,
    this.circle = false,
    this.radius = 0,
    this.stripe = 5,
    this.borderColor,
    this.borderWidth = 1,
    this.child,
  });

  final double? width;
  final double? height;
  final bool circle;
  final double radius;
  final double stripe;
  final Color? borderColor;
  final double borderWidth;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final shape = circle
        ? const BoxDecoration(shape: BoxShape.circle)
        : BoxDecoration(borderRadius: BorderRadius.circular(radius));
    return Container(
      width: width,
      height: height,
      foregroundDecoration: borderColor == null
          ? null
          : (circle
              ? BoxDecoration(shape: BoxShape.circle, border: Border.all(color: borderColor!, width: borderWidth))
              : BoxDecoration(
                  borderRadius: BorderRadius.circular(radius),
                  border: Border.all(color: borderColor!, width: borderWidth),
                )),
      decoration: shape,
      clipBehavior: Clip.antiAlias,
      child: CustomPaint(
        painter: _StripePainter(a: c.stripeA, b: c.stripeB, stripe: stripe),
        child: child,
      ),
    );
  }
}

class _StripePainter extends CustomPainter {
  _StripePainter({required this.a, required this.b, required this.stripe});
  final Color a;
  final Color b;
  final double stripe;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = a);
    final reach = math.sqrt(size.width * size.width + size.height * size.height);
    canvas.save();
    canvas.clipRect(Offset.zero & size);
    canvas.translate(size.width / 2, size.height / 2);
    canvas.rotate(math.pi / 4);
    final paint = Paint()..color = b;
    for (double x = -reach; x < reach; x += stripe * 2) {
      canvas.drawRect(Rect.fromLTWH(x + stripe, -reach, stripe, reach * 2), paint);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_StripePainter old) => old.a != a || old.b != b || old.stripe != stripe;
}

/// Аватар с инициалами (круг).
class InOneAvatar extends StatelessWidget {
  const InOneAvatar({
    super.key,
    required this.initials,
    required this.background,
    required this.foreground,
    this.size = 44,
    this.fontSize = 15,
    this.weight = FontWeight.w700,
  });

  final String initials;
  final Color background;
  final Color foreground;
  final double size;
  final double fontSize;
  final FontWeight weight;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      child: Text(initials, style: InOneText.style(fontSize, weight, foreground)),
    );
  }
}

/// Плитка с иконкой (скруглённый квадрат или круг).
class InOneIconTile extends StatelessWidget {
  const InOneIconTile({
    super.key,
    required this.icon,
    required this.background,
    required this.foreground,
    this.size = 38,
    this.radius = 11,
    this.circle = false,
    this.iconSize = 20,
  });

  final IconData icon;
  final Color background;
  final Color foreground;
  final double size;
  final double radius;
  final bool circle;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: background,
        shape: circle ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: circle ? null : BorderRadius.circular(radius),
      ),
      child: Icon(icon, size: iconSize, color: foreground),
    );
  }
}

/// Иконка-действие без фона (в шапках экранов).
class InOneIconAction extends StatelessWidget {
  const InOneIconAction({
    super.key,
    required this.icon,
    required this.onTap,
    required this.semanticLabel,
    this.size = 24,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final String semanticLabel;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Semantics(
      button: true,
      label: semanticLabel,
      child: InkResponse(
        onTap: onTap,
        radius: 24,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(icon, size: size, color: c.text),
        ),
      ),
    );
  }
}

/// Фильтр-«таблетки» дизайн-системы (All / Unread / Groups …).
class InOneFilterChips extends StatelessWidget {
  const InOneFilterChips({
    super.key,
    required this.labels,
    required this.selectedIndex,
    required this.onChanged,
    this.horizontalPadding = 15,
    this.fontSize = 12.5,
  });

  final List<String> labels;
  final int selectedIndex;
  final ValueChanged<int>? onChanged;
  final double horizontalPadding;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Semantics(
              button: true,
              selected: i == selectedIndex,
              label: labels[i],
              child: GestureDetector(
                onTap: onChanged == null ? null : () => onChanged!(i),
                child: Container(
                  padding: EdgeInsets.symmetric(horizontal: horizontalPadding, vertical: 7),
                  decoration: BoxDecoration(
                    color: i == selectedIndex ? c.chipOnBg : c.fill,
                    borderRadius: BorderRadius.circular(InOneRadius.pill),
                  ),
                  child: Text(
                    labels[i],
                    style: InOneText.style(
                      fontSize,
                      FontWeight.w600,
                      i == selectedIndex ? c.chipOnFg : c.textSoft,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Счётчик непрочитанных.
class InOneCountBadge extends StatelessWidget {
  const InOneCountBadge(this.count, {super.key});
  final int count;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Container(
      constraints: const BoxConstraints(minWidth: 19, minHeight: 19),
      padding: const EdgeInsets.symmetric(horizontal: 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(color: c.brand, borderRadius: BorderRadius.circular(InOneRadius.pill)),
      child: Text('$count', style: InOneText.style(10.5, FontWeight.w700, Colors.white)),
    );
  }
}

/// Поле поиска-«кнопка» (открывает экран поиска).
class InOneSearchBar extends StatelessWidget {
  const InOneSearchBar({super.key, required this.hint, required this.onTap});
  final String hint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Semantics(
      button: true,
      label: hint,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: c.fill, borderRadius: BorderRadius.circular(12)),
          child: Row(
            children: [
              Icon(InOneIcons.search, size: 20, color: c.hint),
              const SizedBox(width: 10),
              Expanded(
                child: Text(hint, style: InOneText.style(13.5, FontWeight.w400, c.hint)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Плитка-показатель (подпись + значение).
class InOneStatTile extends StatelessWidget {
  const InOneStatTile({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
    this.valueSize = 19,
    this.center = false,
    this.valueWeight = FontWeight.w800,
  });

  final String label;
  final String value;
  final Color? valueColor;
  final double valueSize;
  final bool center;
  final FontWeight valueWeight;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.tint, borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: center ? CrossAxisAlignment.center : CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: InOneText.style(10.5, FontWeight.w400, c.sub)),
          const SizedBox(height: 3),
          Text(value, style: InOneText.style(valueSize, valueWeight, valueColor ?? c.text)),
        ],
      ),
    );
  }
}

/// Пустое состояние: иконка в круге, заголовок, пояснение, действия.
class InOneEmptyState extends StatelessWidget {
  const InOneEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.text,
    this.actions = const <Widget>[],
    this.accentIcon = false,
    this.circleSize = 76,
    this.titleSize = 15.5,
    this.textMaxWidth = 240,
    this.padding = const EdgeInsets.symmetric(horizontal: 20, vertical: 26),
  });

  final IconData icon;
  final String title;
  final String? text;
  final List<Widget> actions;

  /// true — иконка на зелёной подложке (есть призыв к действию).
  final bool accentIcon;
  final double circleSize;
  final double titleSize;
  final double textMaxWidth;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        border: Border.all(color: c.border),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: [
          Container(
            width: circleSize,
            height: circleSize,
            decoration: BoxDecoration(color: accentIcon ? c.soft : c.fill, shape: BoxShape.circle),
            child: Icon(icon, size: 30, color: accentIcon ? c.link : c.muted),
          ),
          const SizedBox(height: 12),
          Text(title, textAlign: TextAlign.center, style: InOneText.style(titleSize, FontWeight.w700, c.text)),
          if (text != null) ...[
            const SizedBox(height: 12),
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: textMaxWidth),
              child: Text(
                text!,
                textAlign: TextAlign.center,
                style: InOneText.style(12.5, FontWeight.w400, c.sub, height: 1.5),
              ),
            ),
          ],
          if (actions.isNotEmpty) ...[
            const SizedBox(height: 16),
            Wrap(spacing: 10, runSpacing: 10, alignment: WrapAlignment.center, children: actions),
          ],
        ],
      ),
    );
  }
}

/// Кнопка-действие для пустых состояний и ошибок (радиус 12).
class InOneSmallAction extends StatelessWidget {
  const InOneSmallAction({
    super.key,
    required this.label,
    required this.onTap,
    this.style = InOneSmallActionStyle.primary,
  });

  final String label;
  final VoidCallback? onTap;
  final InOneSmallActionStyle style;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final Color bg;
    final Color fg;
    BorderSide side = BorderSide.none;
    switch (style) {
      case InOneSmallActionStyle.primary:
        bg = c.accent;
        fg = c.onAccent;
      case InOneSmallActionStyle.outline:
        bg = c.bg;
        fg = c.text;
        side = BorderSide(color: c.line);
      case InOneSmallActionStyle.soft:
        bg = c.soft;
        fg = c.link;
    }
    final big = style == InOneSmallActionStyle.primary;
    return Material(
      color: bg,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: side),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: big ? 22 : 18, vertical: big ? 12 : 11),
          child: Text(label, style: InOneText.style(big ? 13.5 : 13, FontWeight.w700, fg)),
        ),
      ),
    );
  }
}

enum InOneSmallActionStyle { primary, outline, soft }

enum InOneAlertKind { error, warning }

/// Встроенное уведомление (ошибка / предупреждение).
class InOneInlineAlert extends StatelessWidget {
  const InOneInlineAlert({super.key, required this.kind, required this.title, required this.text});
  final InOneAlertKind kind;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final error = kind == InOneAlertKind.error;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: error ? c.dangerTint : c.warnTint,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              error ? InOneIcons.error : InOneIcons.warning,
              size: 22,
              color: error ? c.danger : c.warn,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: InOneText.style(13, FontWeight.w700, error ? c.errTitle : c.warnTitle),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    text,
                    style: InOneText.style(11.5, FontWeight.w400, error ? c.errBody : c.warnBody, height: 1.45),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Блок-скелетон для состояния загрузки.
class InOneSkeletonBox extends StatelessWidget {
  const InOneSkeletonBox({super.key, this.width, this.height = 10, this.radius = 5, this.strong = false});
  final double? width;
  final double height;
  final double radius;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: strong ? c.stripeB : c.stripeA,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

/// Подпись секции в верхнем регистре (EMPTY STATES, ERRORS …).
class InOneCaps extends StatelessWidget {
  const InOneCaps(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return Text(text, style: InOneText.style(12, FontWeight.w700, c.muted, letterSpacing: 0.48));
  }
}
