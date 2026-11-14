import 'package:flutter/material.dart';

import '../../models/inone_models.dart';
import '../../state/inone_state.dart';
import '../../widgets/inone_request_widgets.dart';
import '../../widgets/inone_widgets.dart';

/// PS-03 · Որոշում: подтверждение или отклонение заявки (с диалогом подтверждения).
class InOneRequestDecisionScreen extends StatefulWidget {
  const InOneRequestDecisionScreen({
    super.key,
    required this.request,
    required this.onDecision,
    required this.onBack,
    required this.onMenu,
    this.onDone,
  });

  final InOneOrgRequest request;

  /// POST /org-requests/:id/decision. `null` — успех.
  final Future<InOneFailure?> Function(InOneDecision decision) onDecision;
  final VoidCallback onBack;
  final VoidCallback onMenu;
  final VoidCallback? onDone;

  @override
  State<InOneRequestDecisionScreen> createState() => _InOneRequestDecisionScreenState();
}

class _InOneRequestDecisionScreenState extends State<InOneRequestDecisionScreen>
    with InOneActionState<InOneRequestDecisionScreen> {
  Future<void> _decide(InOneDecision decision) async {
    final approve = decision == InOneDecision.approve;
    final confirmed = await InOneConfirmDialog.show(
      context,
      message: approve ? 'Հաստատե՞լ հայտը' : 'Մերժե՞լ հայտը',
      confirmLabel: approve ? 'Հաստատել' : 'Մերժել',
    );
    if (!confirmed || !mounted) return;
    await run(decision, () => widget.onDecision(decision), onSuccess: widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.bar(
      title: 'Որոշում',
      onBack: widget.onBack,
      onMenu: widget.onMenu,
      banner: bannerText,
      top: [InOneRequestSummaryCard(request: widget.request)],
      dock: [
        InOneButton(
          label: 'Հաստատել',
          loading: isBusy(InOneDecision.approve),
          onPressed: blocked ? null : () => _decide(InOneDecision.approve),
        ),
        const SizedBox(height: 12),
        InOneButton(
          label: 'Մերժել',
          kind: InOneButtonKind.outline,
          loading: isBusy(InOneDecision.reject),
          onPressed: blocked ? null : () => _decide(InOneDecision.reject),
        ),
      ],
    );
  }
}
