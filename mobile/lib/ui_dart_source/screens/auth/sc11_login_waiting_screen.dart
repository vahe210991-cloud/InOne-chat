import 'dart:async';

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
    this.approvalCode,
    this.showNotMe = true,
    this.notMeLabel = 'Սա ես չեմ',
    this.autoPoll = false,
    this.onDone,
  });

  /// Время открытия входа для сценария 48-часового ожидания.
  final String activateAt;

  /// Код, который новое устройство показывает владельцу для подтверждения.
  final String? approvalCode;

  /// POST /login или POST /approvals/:id/claim. `null` — подтверждение завершено.
  final Future<InOneFailure?> Function() onRecheck;

  /// «Это не я» → SC-10. Для approval flow действие скрывается.
  final VoidCallback onNotMe;
  final bool showNotMe;
  final String notMeLabel;
  final bool autoPoll;
  final VoidCallback? onDone;

  @override
  State<InOneLoginWaitingScreen> createState() => _InOneLoginWaitingScreenState();
}

class _InOneLoginWaitingScreenState extends State<InOneLoginWaitingScreen>
    with InOneActionState<InOneLoginWaitingScreen> {
  Timer? _approvalPollTimer;
  int _approvalPollAttempts = 0;

  @override
  void initState() {
    super.initState();
    if (widget.autoPoll && widget.approvalCode != null) {
      _approvalPollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
        if (!mounted || _approvalPollAttempts >= 120) {
          _approvalPollTimer?.cancel();
          return;
        }
        if (blocked || isBusy('recheck')) return;
        _approvalPollAttempts++;
        unawaited(run('recheck', widget.onRecheck, onSuccess: widget.onDone));
      });
    }
  }

  @override
  void dispose() {
    _approvalPollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final approval = widget.approvalCode;
    return InOneScreen.auth(
      title: approval == null ? 'Մուտքի սպասում' : 'Մուտքի հաստատում',
      banner: bannerText,
      top: [
        if (approval != null)
          InOneLeadParagraph(
            spans: [
              const InOneLeadSpan('Մուտքի հաստատման կոդը՝ '),
              InOneLeadSpan(approval, bold: true),
              const InOneLeadSpan('. Մուտքը կհաստատվի վստահելի սարքում կոդը մուտքագրելուց հետո։'),
            ],
          )
        else
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
          label: approval == null ? 'Նորից ստուգել' : 'Ստուգել հաստատումը',
          loading: isBusy('recheck'),
          onPressed: blocked ? null : () => run('recheck', widget.onRecheck, onSuccess: widget.onDone),
        ),
        if (widget.showNotMe) ...[
          const SizedBox(height: 12),
          InOneButton(
            label: widget.notMeLabel,
            kind: InOneButtonKind.outline,
            onPressed: widget.onNotMe,
          ),
        ],
      ],
    );
  }
}
