import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

class InOnePinResetScreen extends StatefulWidget {
  const InOnePinResetScreen({
    super.key,
    required this.onStart,
    required this.onComplete,
    required this.onBack,
    required this.onDone,
  });

  final Future<InOneFailure?> Function(String password, ValueChanged<String> onChallenge) onStart;
  final Future<InOneFailure?> Function(String challengeId, String code, String pin, String pinConfirmation) onComplete;
  final VoidCallback onBack;
  final VoidCallback onDone;

  @override
  State<InOnePinResetScreen> createState() => _InOnePinResetScreenState();
}

class _InOnePinResetScreenState extends State<InOnePinResetScreen>
    with InOneActionState<InOnePinResetScreen> {
  final InOneFormController _startForm = InOneFormController();
  final InOneFormController _completeForm =
      InOneFormController(required: const ['code', 'pin', 'pinConfirmation']);
  String? _challengeId;

  @override
  void dispose() {
    _startForm.dispose();
    _completeForm.dispose();
    super.dispose();
  }

  void _start() {
    run('start', () => widget.onStart(
      _startForm.value('password'),
      (challengeId) {
        if (!mounted) return;
        setState(() => _challengeId = challengeId);
      },
    ));
  }

  void _complete() {
    if (!_completeForm.validate() || _challengeId == null) return;
    run(
      'complete',
      () => widget.onComplete(
        _challengeId!,
        _completeForm.value('code').trim(),
        _completeForm.value('pin'),
        _completeForm.value('pinConfirmation'),
      ),
      onSuccess: widget.onDone,
    );
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Замена PIN-кода',
      onBack: widget.onBack,
      banner: bannerText ??
          'Для защиты аккаунта мы отправим одноразовый код на подтверждённую электронную почту. Новый PIN будет действовать сразу после подтверждения.',
      dock: [
        if (_challengeId == null) ...[
          InOneField(
            form: _startForm,
            name: 'password',
            label: 'Пароль аккаунта (если вход по паролю)',
            obscure: true,
            maxLength: 128,
            textInputAction: TextInputAction.done,
            onSubmitted: _start,
          ),
          InOneButton(
            label: 'Отправить код на почту',
            loading: isBusy('start'),
            onPressed: blocked ? null : _start,
          ),
        ] else ...[
          InOneField(
            form: _completeForm,
            name: 'code',
            label: 'Одноразовый код из письма',
            keyboardType: TextInputType.number,
            maxLength: 6,
            textInputAction: TextInputAction.next,
          ),
          InOneField(
            form: _completeForm,
            name: 'pin',
            label: 'Новый PIN · 8 цифр',
            obscure: true,
            keyboardType: TextInputType.number,
            maxLength: 8,
            textInputAction: TextInputAction.next,
          ),
          InOneField(
            form: _completeForm,
            name: 'pinConfirmation',
            label: 'Повторите новый PIN',
            obscure: true,
            keyboardType: TextInputType.number,
            maxLength: 8,
            textInputAction: TextInputAction.done,
            onSubmitted: _complete,
          ),
          InOneButton(
            label: 'Подтвердить и заменить PIN',
            loading: isBusy('complete'),
            onPressed: blocked ? null : _complete,
          ),
          TextButton(
            onPressed: blocked ? null : _start,
            child: const Text('Отправить код повторно'),
          ),
        ],
      ],
    );
  }
}
