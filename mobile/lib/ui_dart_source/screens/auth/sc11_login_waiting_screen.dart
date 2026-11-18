import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-11 · Մուտքի սպասում: вход откроется в указанное время.
class InOneLoginWaitingScreen extends StatefulWidget {
  const InOneLoginWaitingScreen({
    super.key,
    required this.activateAt,
    required this.onRecheck,
    required this.onNotMe,
    this.onDone,
  });

  /// Время открытия входа, уже отформатированное (например, «14:30»).
  final String activateAt;

  /// POST /login (повторная проверка). `null` — успех.
  final Future<InOneFailure?> Function() onRecheck;

  /// «Это не я» → SC-10.
  final VoidCallback onNotMe;
  final VoidCallback? onDone;

  @override
  State<InOneLoginWaitingScreen> createState() => _InOneLoginWaitingScreenState();
}

class _InOneLoginWaitingScreenState extends State<InOneLoginWaitingScreen>
    with InOneActionState<InOneLoginWaitingScreen> {
  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Մուտքի սպասում',
      banner: bannerText,
      top: [
        InOneLeadParagraph(
          spans: [
            const InOneLeadSpan('Մուտքը կբացվի ժամը '),
            InOneLeadSpan(widget.activateAt, bold: true),
            const InOneLeadSpan('-ին'),
          ],
        ),
      ],
      dock: [
        InOneButton(
          label: 'Նորից ստուգել',
          loading: isBusy('recheck'),
          onPressed: blocked ? null : () => run('recheck', widget.onRecheck, onSuccess: widget.onDone),
        ),
        const SizedBox(height: 12),
        InOneButton(
          label: 'Սա ես չեմ',
          kind: InOneButtonKind.outline,
          onPressed: widget.onNotMe,
        ),
      ],
    );
  }
}
