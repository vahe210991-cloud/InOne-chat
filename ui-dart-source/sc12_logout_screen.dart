import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-12 · Ելք: выход из аккаунта на этом устройстве.
class InOneLogoutScreen extends StatefulWidget {
  const InOneLogoutScreen({
    super.key,
    required this.onLogout,
    required this.onCancel,
    this.onDone,
  });

  /// POST /logout. `null` — успех (токены и данные устройства очищает вызывающий код).
  final Future<InOneFailure?> Function() onLogout;
  final VoidCallback onCancel;

  /// Вышли → экран SC-01.
  final VoidCallback? onDone;

  @override
  State<InOneLogoutScreen> createState() => _InOneLogoutScreenState();
}

class _InOneLogoutScreenState extends State<InOneLogoutScreen> with InOneActionState<InOneLogoutScreen> {
  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Ելք',
      banner: bannerText,
      top: const [InOneLeadParagraph(spans: [InOneLeadSpan('Դուրս գալ հաշվից այս սարքում')])],
      dock: [
        InOneButton(
          label: 'Դուրս գալ',
          loading: isBusy('logout'),
          onPressed: blocked ? null : () => run('logout', widget.onLogout, onSuccess: widget.onDone),
        ),
        const SizedBox(height: 12),
        InOneButton(
          label: 'Չեղարկել',
          kind: InOneButtonKind.outline,
          onPressed: widget.onCancel,
        ),
      ],
    );
  }
}
