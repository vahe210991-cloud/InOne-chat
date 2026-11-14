import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Упрощённый логотип Google «G» (4 цвета), без внешних ассетов.
/// При необходимости замените на официальный SVG из брендбука Google.
class InOneGoogleLogo extends StatelessWidget {
  const InOneGoogleLogo({super.key, this.size = 20});
  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: const CustomPaint(painter: _GooglePainter()),
    );
  }
}

class _GooglePainter extends CustomPainter {
  const _GooglePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.2;
    final rect = Rect.fromLTWH(stroke / 2, stroke / 2, size.width - stroke, size.height - stroke);
    Paint p(Color c) => Paint()
      ..color = c
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    double rad(double deg) => deg * math.pi / 180;
    canvas.drawArc(rect, rad(215), rad(105), false, p(const Color(0xFFEA4335)));
    canvas.drawArc(rect, rad(140), rad(75), false, p(const Color(0xFFFBBC05)));
    canvas.drawArc(rect, rad(55), rad(85), false, p(const Color(0xFF34A853)));
    canvas.drawArc(rect, rad(0), rad(55), false, p(const Color(0xFF4285F4)));
    final cy = size.height / 2;
    canvas.drawLine(
      Offset(size.width / 2, cy),
      Offset(size.width - stroke / 2, cy),
      p(const Color(0xFF4285F4)),
    );
  }

  @override
  bool shouldRepaint(_GooglePainter old) => false;
}
