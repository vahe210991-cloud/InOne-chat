import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/data/inone_profile.dart';
import '../../theme/inone_colors.dart';
import '../../theme/inone_theme.dart';

/// Own-profile card backed by the authenticated GET /profile DTO.
/// Internal userId is never displayed. QR/link/NFC/BLE/Wallet are gated because
/// no contact-share token or pass API exists in the current Beta 1.0 contract.
class InOneContactCardScreen extends StatelessWidget {
  const InOneContactCardScreen({super.key, required this.profile, required this.onBack});
  final InOneProfile profile;
  final VoidCallback onBack;

  String get _name {
    final n = profile.nickname?.trim();
    return n == null || n.isEmpty ? 'Пользователь InOne' : n;
  }

  String get _initials {
    final parts = _name.split(RegExp(r'\s+')).where((v) => v.isNotEmpty).take(2);
    return parts.map((v) => String.fromCharCode(v.runes.first)).join().toUpperCase();
  }

  String _escape(String v) => v.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n');

  Future<void> _copyVCard(BuildContext context) async {
    final lines = <String>['BEGIN:VCARD', 'VERSION:4.0', 'FN:' + _escape(_name)];
    final email = profile.email?.trim();
    if (email != null && email.isNotEmpty) lines.add('EMAIL:' + _escape(email));
    lines.addAll(['ORG:InOne', 'END:VCARD']);
    await Clipboard.setData(ClipboardData(text: lines.join('\r\n')));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('vCard скопирована')));
    }
  }

  void _unavailable(BuildContext context, String method) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(method + ' станет доступно после подключения серверного обмена визитками.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    final email = profile.email?.trim();
    final hasEmail = email != null && email.isNotEmpty;
    return Scaffold(
      backgroundColor: c.bg,
      body: SafeArea(
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 10),
            child: Row(children: [
              _RoundAction(icon: Icons.chevron_left_rounded, label: 'Назад', onTap: onBack),
              const Spacer(), const _Brand(), const Spacer(),
              _RoundAction(icon: Icons.more_horiz_rounded, label: 'Дополнительно',
                onTap: () => _unavailable(context, 'Дополнительные действия')),
            ]),
          ),
          Expanded(child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _Card(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  _Avatar(initials: _initials),
                  const SizedBox(width: 16),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(_name, style: InOneText.style(22, FontWeight.w800, c.text, height: 1.16, letterSpacing: -.7)),
                    const SizedBox(height: 5),
                    Text('Личный профиль · InOne', style: InOneText.style(13, FontWeight.w500, c.sub)),
                    if (profile.verificationLevel > 0) ...[
                      const SizedBox(height: 9),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                        decoration: BoxDecoration(color: c.fill, borderRadius: BorderRadius.circular(999)),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Icon(Icons.verified_rounded, size: 15, color: c.link),
                          const SizedBox(width: 5),
                          Text('Подтверждённый аккаунт', style: InOneText.style(10, FontWeight.w800, c.text)),
                        ]),
                      ),
                    ],
                  ])),
                ]),
                const SizedBox(height: 20), Container(height: 1, color: c.line),
                const SizedBox(height: 17),
                Text('ВАША ЦИФРОВАЯ ВИЗИТКА', style: InOneText.style(9.5, FontWeight.w800, c.muted, letterSpacing: 1.3)),
                const SizedBox(height: 12),
                if (hasEmail)
                  _ContactRow(icon: Icons.mail_outline_rounded, label: 'Email', value: email,
                    onCopy: () async {
                      await Clipboard.setData(ClipboardData(text: email));
                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Email скопирован')));
                    })
                else
                  Text('Email не указан в профиле', style: InOneText.style(12, FontWeight.w500, c.muted)),
                const SizedBox(height: 5),
                _ContactRow(icon: Icons.apartment_outlined, label: 'Сервис', value: 'InOne'),
                const SizedBox(height: 17), Container(height: 1, color: c.line),
                const SizedBox(height: 15),
                Row(children: [
                  Expanded(child: _QrUnavailable(colors: c)),
                  const SizedBox(width: 13),
                  Expanded(child: Column(children: [
                    SizedBox(width: double.infinity, child: FilledButton.icon(
                      onPressed: () => _unavailable(context, 'Публичная ссылка профиля'),
                      icon: const Icon(Icons.share_outlined, size: 18),
                      label: const Text('Поделиться'),
                      style: FilledButton.styleFrom(
                        backgroundColor: c.accent, foregroundColor: c.onAccent, elevation: 0,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 15),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                        textStyle: InOneText.style(12, FontWeight.w800, c.onAccent),
                      ),
                    )),
                    const SizedBox(height: 8),
                    Text('QR появится после выпуска защищённой ссылки визитки',
                      textAlign: TextAlign.center, style: InOneText.style(9.5, FontWeight.w500, c.sub, height: 1.4)),
                  ])),
                ]),
              ])),
              const SizedBox(height: 24),
              Text('ПОДЕЛИТЬСЯ КОНТАКТОМ', style: InOneText.style(10, FontWeight.w800, c.muted, letterSpacing: 1.25)),
              const SizedBox(height: 12),
              GridView.count(
                crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 9, mainAxisSpacing: 9, childAspectRatio: 1.12,
                children: [
                  _ShareTile(icon: Icons.nfc_rounded, label: 'NFC', onTap: () => _unavailable(context, 'NFC')),
                  _ShareTile(icon: Icons.qr_code_2_rounded, label: 'QR Code', onTap: () => _unavailable(context, 'QR')),
                  _ShareTile(icon: Icons.link_rounded, label: 'Ссылка', onTap: () => _unavailable(context, 'Ссылка')),
                  _ShareTile(icon: Icons.bluetooth_rounded, label: 'Bluetooth', onTap: () => _unavailable(context, 'Bluetooth')),
                  _ShareTile(icon: Icons.contact_page_outlined, label: 'vCard', enabled: true, onTap: () => _copyVCard(context)),
                  _ShareTile(icon: Icons.wallet_outlined, label: 'Wallet', highlighted: true, onTap: () => _unavailable(context, 'Wallet')),
                ],
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: c.surface, border: Border.all(color: c.border), borderRadius: BorderRadius.circular(20)),
                child: Row(children: [
                  Container(width: 43, height: 43, decoration: BoxDecoration(color: c.soft, shape: BoxShape.circle),
                    child: Icon(Icons.lock_outline_rounded, color: c.link, size: 21)),
                  const SizedBox(width: 12),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Ваши данные под контролем', style: InOneText.style(12.5, FontWeight.w800, c.text)),
                    const SizedBox(height: 3),
                    Text('Показываются только данные вашего аккаунта. Внутренний ID не публикуется.',
                      style: InOneText.style(10.5, FontWeight.w500, c.sub, height: 1.4)),
                  ])),
                  Icon(Icons.chevron_right_rounded, color: c.sub),
                ]),
              ),
            ]),
          )),
        ]),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;
  @override Widget build(BuildContext context) {
    final c = context.inone;
    return Container(
      padding: const EdgeInsets.all(19),
      decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: c.border),
        boxShadow: [BoxShadow(color: c.avatarShadow.withValues(alpha: .12), blurRadius: 28, offset: const Offset(0, 9))]),
      child: Stack(children: [
        Positioned(right: -42, top: -44, child: IgnorePointer(child: Container(width: 150, height: 150,
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: c.soft, width: 24))))),
        child,
      ]),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.initials});
  final String initials;
  @override Widget build(BuildContext context) {
    final c = context.inone;
    return Stack(children: [
      Container(width: 104, height: 104, alignment: Alignment.center,
        decoration: BoxDecoration(shape: BoxShape.circle,
          gradient: LinearGradient(colors: [c.stripeA, c.stripeB], begin: Alignment.topLeft, end: Alignment.bottomRight),
          border: Border.all(color: c.border)),
        child: Text(initials, style: InOneText.style(27, FontWeight.w800, c.textSoft, letterSpacing: -1))),
      Positioned(right: 1, bottom: 5, child: Container(width: 18, height: 18,
        decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle, border: Border.all(color: c.bg, width: 3)))),
    ]);
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({required this.icon, required this.label, required this.value, this.onCopy});
  final IconData icon; final String label; final String value; final VoidCallback? onCopy;
  @override Widget build(BuildContext context) {
    final c = context.inone;
    return Row(children: [
      Container(width: 42, height: 42, decoration: BoxDecoration(color: c.fill, shape: BoxShape.circle),
        child: Icon(icon, color: c.textSoft, size: 20)),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: InOneText.style(9.5, FontWeight.w500, c.muted)),
        const SizedBox(height: 2),
        Text(value, style: InOneText.style(13.5, FontWeight.w600, c.text), overflow: TextOverflow.ellipsis),
      ])),
      if (onCopy != null) IconButton(visualDensity: VisualDensity.compact, tooltip: 'Скопировать', onPressed: onCopy,
        icon: Icon(Icons.copy_rounded, size: 18, color: c.sub)),
    ]);
  }
}

class _QrUnavailable extends StatelessWidget {
  const _QrUnavailable({required this.colors});
  final InOneColors colors;
  @override Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 116), padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: colors.fill, borderRadius: BorderRadius.circular(16), border: Border.all(color: colors.border)),
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Icon(Icons.qr_code_2_rounded, size: 42, color: colors.muted), const SizedBox(height: 6),
      Text('QR пока недоступен', textAlign: TextAlign.center, style: InOneText.style(10, FontWeight.w700, colors.sub)),
    ]),
  );
}

class _ShareTile extends StatelessWidget {
  const _ShareTile({required this.icon, required this.label, required this.onTap, this.enabled = false, this.highlighted = false});
  final IconData icon; final String label; final VoidCallback onTap; final bool enabled; final bool highlighted;
  @override Widget build(BuildContext context) {
    final c = context.inone;
    return Material(
      color: highlighted ? c.soft : c.surface, borderRadius: BorderRadius.circular(20),
      child: InkWell(onTap: onTap, borderRadius: BorderRadius.circular(20), child: Container(
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(20), border: Border.all(color: highlighted ? c.softLine : c.border)),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, size: 25, color: enabled ? c.text : c.muted), const SizedBox(height: 8),
          Text(label, style: InOneText.style(11.5, FontWeight.w700, enabled ? c.text : c.sub)),
          if (!enabled) Padding(padding: const EdgeInsets.only(top: 3), child: Text('Скоро', style: InOneText.style(8.5, FontWeight.w600, c.muted))),
        ]),
      )),
    );
  }
}

class _RoundAction extends StatelessWidget {
  const _RoundAction({required this.icon, required this.label, required this.onTap});
  final IconData icon; final String label; final VoidCallback onTap;
  @override Widget build(BuildContext context) {
    final c = context.inone;
    return IconButton(tooltip: label, onPressed: onTap,
      style: IconButton.styleFrom(backgroundColor: c.surface, side: BorderSide(color: c.border), fixedSize: const Size(44, 44)),
      icon: Icon(icon, color: c.text, size: 22));
  }
}

class _Brand extends StatelessWidget {
  const _Brand();
  @override Widget build(BuildContext context) {
    final c = context.inone;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      SizedBox(width: 31, height: 31, child: Stack(children: [
        Positioned(left: 2, top: 1, child: Transform.rotate(angle: -.45, child: Container(width: 12, height: 26,
          decoration: BoxDecoration(color: c.accent, borderRadius: BorderRadius.circular(4))))),
        Positioned(right: 2, bottom: 1, child: Transform.rotate(angle: -.45, child: Container(width: 12, height: 26,
          decoration: BoxDecoration(color: c.accent, borderRadius: BorderRadius.circular(4))))),
      ])),
      const SizedBox(width: 7),
      Text('InOne', style: InOneText.style(24, FontWeight.w800, c.text, letterSpacing: -1.2)),
    ]);
  }
}
