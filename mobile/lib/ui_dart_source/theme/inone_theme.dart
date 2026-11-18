import 'package:flutter/material.dart';

import 'inone_colors.dart';

/// Радиусы согласованного дизайна. Фон экрана — прямоугольный (без скруглений),
/// скругляются только внутренние элементы.
abstract final class InOneRadius {
  static const double field = 14;
  static const double button = 14;
  static const double card = 16;
  static const double dialog = 20;
  static const double pill = 999;
}

abstract final class InOneText {
  static TextStyle style(
    double size,
    FontWeight weight,
    Color color, {
    double? height,
    double? letterSpacing,
  }) =>
      TextStyle(
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height,
        letterSpacing: letterSpacing,
      );
}

abstract final class InOneTheme {
  static ThemeData light() => _build(Brightness.light, InOneColors.light);
  static ThemeData dark() => _build(Brightness.dark, InOneColors.dark);

  static ThemeData _build(Brightness brightness, InOneColors c) {
    final scheme = ColorScheme.fromSeed(
      seedColor: c.green,
      brightness: brightness,
    ).copyWith(
      primary: c.green,
      onPrimary: c.surface,
      surface: c.surface,
      onSurface: c.text,
      error: c.danger,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.bg,
      canvasColor: c.bg,
      dividerColor: c.line,
      // Шрифты: см. README (assets/fonts). Армянский — через fallback.
      fontFamily: 'NotoSans',
      fontFamilyFallback: const ['NotoSansArmenian'],
      splashFactory: InkRipple.splashFactory,
      extensions: <ThemeExtension<dynamic>>[c],
    );
  }
}

extension InOneThemeX on BuildContext {
  InOneColors get inone => Theme.of(this).extension<InOneColors>()!;
}
