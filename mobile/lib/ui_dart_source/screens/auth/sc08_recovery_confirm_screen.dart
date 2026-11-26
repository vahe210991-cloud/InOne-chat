import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-08 · Հաստատում: подтверждение восстановления (переход по ссылке).
class InOneRecoveryConfirmScreen extends StatefulWidget {
  const InOneRecoveryConfirmScreen({
    super.key,
    required this.onConfirm,
    this.onBack,
    this.onDone,
  });

  /// POST /recovery/confirm. `null` — успех.
  final Future<InOneFailure?> Function() onConfirm;
  final VoidCallback? onBack;

  /// Подтверждено → экран SC-09.
  final VoidCallback? onDone;

  @override
  State<InOneRecoveryConfirmScreen> createState() => _InOneRecoveryConfirmScreenState();
}

class _InOneRecoveryConfirmScreenState extends State<InOneRecoveryConfirmScreen>
    with InOneActionState<InOneRecoveryConfirmScreen> {
  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Հաստատում',
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        InOneButton(
          label: 'Շարունակել',
          loading: isBusy('confirm'),
          onPressed: blocked ? null : () => run('confirm', widget.onConfirm, onSuccess: widget.onDone),
        ),
      ],
    );
  }
}
