import 'package:flutter/material.dart';

/// Цветовые токены InOne. Источник — согласованные экраны (light/dark).
/// Первая группа — токены экранов входа/заявок/настроек (design-tokens.v2.css),
/// вторая — токены экранов дизайн-системы (Screen 02…52, D02…D50).
@immutable
class InOneColors extends ThemeExtension<InOneColors> {
  const InOneColors({
    required this.bg,
    required this.surface,
    required this.line,
    required this.text,
    required this.text2,
    required this.accent,
    required this.onAccent,
    required this.green,
    required this.soft,
    required this.softLine,
    required this.danger,
    required this.dangerSoft,
    required this.ring,
    required this.muted,
    required this.hint,
    required this.textSoft,
    required this.textMid,
    required this.sub,
    required this.fill,
    required this.stripeA,
    required this.stripeB,
    required this.border,
    required this.tint,
    required this.rowLine,
    required this.link,
    required this.brand,
    required this.blueTint,
    required this.blue,
    required this.dangerTint,
    required this.dangerText,
    required this.warnTint,
    required this.warn,
    required this.purpleTint,
    required this.purple,
    required this.errTitle,
    required this.errBody,
    required this.warnTitle,
    required this.warnBody,
    required this.chipOnBg,
    required this.chipOnFg,
    required this.heroBg,
    required this.heroFg,
    required this.heroMuted,
    required this.heroMuted2,
    required this.heroPillBg,
    required this.heroPillFg,
    required this.heroDivider,
    required this.navShadow,
    required this.coverPill,
    required this.avatarShadow,
    required this.dot1,
    required this.dot2,
    required this.dot3,
    required this.spinnerTrack,
  });

  // --- v2 (вход, заявки, настройки)
  final Color bg;
  final Color surface;
  final Color line;
  final Color text;
  final Color text2;
  final Color accent;
  final Color onAccent;
  final Color green;
  final Color soft;
  final Color softLine;
  final Color danger;
  final Color dangerSoft;
  final Color ring;

  // --- дизайн-система (основные экраны)
  final Color muted;
  final Color hint;
  final Color textSoft;
  final Color textMid;
  final Color sub;
  final Color fill;
  final Color stripeA;
  final Color stripeB;
  final Color border;
  final Color tint;
  final Color rowLine;
  final Color link;
  final Color brand;
  final Color blueTint;
  final Color blue;
  final Color dangerTint;
  final Color dangerText;
  final Color warnTint;
  final Color warn;
  final Color purpleTint;
  final Color purple;
  final Color errTitle;
  final Color errBody;
  final Color warnTitle;
  final Color warnBody;
  final Color chipOnBg;
  final Color chipOnFg;
  final Color heroBg;
  final Color heroFg;
  final Color heroMuted;
  final Color heroMuted2;
  final Color heroPillBg;
  final Color heroPillFg;
  final Color heroDivider;
  final Color navShadow;
  final Color coverPill;
  final Color avatarShadow;
  final Color dot1;
  final Color dot2;
  final Color dot3;
  final Color spinnerTrack;

  static const InOneColors light = InOneColors(
    bg: Color(0xFFFFFFFF),
    surface: Color(0xFFFFFFFF),
    line: Color(0xFFE4E7E0),
    text: Color(0xFF171A14),
    text2: Color(0xFF6B7268),
    accent: Color(0xFFC9F53F),
    onAccent: Color(0xFF1B1F17),
    green: Color(0xFF4F8517),
    soft: Color(0xFFF1F8E3),
    softLine: Color(0xFFD8E9B8),
    danger: Color(0xFFC63A24),
    dangerSoft: Color(0x1FC63A24),
    ring: Color(0x2E4F8517),
    muted: Color(0xFF8C9487),
    hint: Color(0xFFA6ADA1),
    textSoft: Color(0xFF4A5147),
    textMid: Color(0xFF3C4338),
    sub: Color(0xFF6B7268),
    fill: Color(0xFFF6F7F4),
    stripeA: Color(0xFFF2F4EF),
    stripeB: Color(0xFFE9ECE4),
    border: Color(0xFFEDEFEA),
    tint: Color(0xFFF8FBF1),
    rowLine: Color(0xFFF2F4EF),
    link: Color(0xFF4F8517),
    brand: Color(0xFF77B72C),
    blueTint: Color(0xFFEDF3FB),
    blue: Color(0xFF2E6EA8),
    dangerTint: Color(0xFFFDECE9),
    dangerText: Color(0xFFC63A24),
    warnTint: Color(0xFFFEF4E3),
    warn: Color(0xFFA9761A),
    purpleTint: Color(0xFFF3EFFB),
    purple: Color(0xFF7059B0),
    errTitle: Color(0xFF8E2A18),
    errBody: Color(0xFFA2412C),
    warnTitle: Color(0xFF7A560F),
    warnBody: Color(0xFF8E6415),
    chipOnBg: Color(0xFF171A14),
    chipOnFg: Color(0xFFFFFFFF),
    heroBg: Color(0xFF1B1F17),
    heroFg: Color(0xFFFFFFFF),
    heroMuted: Color(0x8CFFFFFF),
    heroMuted2: Color(0x80FFFFFF),
    heroPillBg: Color(0x2EC9F53F),
    heroPillFg: Color(0xFFC9F53F),
    heroDivider: Color(0x24FFFFFF),
    navShadow: Color(0x0A171A14),
    coverPill: Color(0xF0FFFFFF),
    avatarShadow: Color(0x24171A14),
    dot1: Color(0xFFA6ADA1),
    dot2: Color(0xFFC6CCC0),
    dot3: Color(0xFFDDE2D7),
    spinnerTrack: Color(0xFFDDEBC2),
  );

  static const InOneColors dark = InOneColors(
    bg: Color(0xFF181C15),
    surface: Color(0xFF1D211A),
    line: Color(0xFF262B22),
    text: Color(0xFFF3F5F0),
    text2: Color(0xFF8C9487),
    accent: Color(0xFFC9F53F),
    onAccent: Color(0xFF1B1F17),
    green: Color(0xFF77B72C),
    soft: Color(0xFF20261A),
    softLine: Color(0xFF2B3324),
    danger: Color(0xFFE8452E),
    dangerSoft: Color(0x29E8452E),
    ring: Color(0x4077B72C),
    muted: Color(0xFF79806F),
    hint: Color(0xFF79806F),
    textSoft: Color(0xFFB9C0AF),
    textMid: Color(0xFFC6CCBD),
    sub: Color(0xFF98A08D),
    fill: Color(0xFF1D211A),
    stripeA: Color(0xFF20261A),
    stripeB: Color(0xFF1D221A),
    border: Color(0xFF262B22),
    tint: Color(0xFF1D211A),
    rowLine: Color(0xFF20261A),
    link: Color(0xFFC9F53F),
    brand: Color(0xFF77B72C),
    blueTint: Color(0xFF171F2A),
    blue: Color(0xFF2E6EA8),
    dangerTint: Color(0xFF2A1A17),
    dangerText: Color(0xFFF08C74),
    warnTint: Color(0xFF2A2418),
    warn: Color(0xFFE9B44C),
    purpleTint: Color(0xFF221D2C),
    purple: Color(0xFF7059B0),
    errTitle: Color(0xFFF08C74),
    errBody: Color(0xFFA2412C),
    warnTitle: Color(0xFF7A560F),
    warnBody: Color(0xFF8E6415),
    chipOnBg: Color(0xFFC9F53F),
    chipOnFg: Color(0xFF1B1F17),
    heroBg: Color(0xFFC9F53F),
    heroFg: Color(0xFF1B1F17),
    heroMuted: Color(0xA81B1F17),
    heroMuted2: Color(0x9E1B1F17),
    heroPillBg: Color(0x241B1F17),
    heroPillFg: Color(0xFF1B1F17),
    heroDivider: Color(0x2E1B1F17),
    navShadow: Color(0x66000000),
    coverPill: Color(0xF01D211A),
    avatarShadow: Color(0x8C000000),
    dot1: Color(0xFF79806F),
    dot2: Color(0xFFC6CCC0),
    dot3: Color(0xFF2A3025),
    spinnerTrack: Color(0xFF2F3A24),
  );

  /// Токены неизменяемы и переключаются целиком (light/dark).
  @override
  InOneColors copyWith() => this;

  @override
  InOneColors lerp(ThemeExtension<InOneColors>? other, double t) {
    if (other is! InOneColors) return this;
    return t < 0.5 ? this : other;
  }
}
