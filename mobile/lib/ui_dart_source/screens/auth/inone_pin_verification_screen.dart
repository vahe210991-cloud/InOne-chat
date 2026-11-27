import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';
import 'inone_pin_copy.dart';

class InOnePinVerificationScreen extends StatefulWidget {
  const InOnePinVerificationScreen({
    super.key,
    required this.onSubmit,
    required this.onForgotPin,
    required this.onLogout,
    required this.onDone,
    this.legacyPin = false,
  });

  final Future<InOneFailure?> Function(String pin) onSubmit;
  final VoidCallback onForgotPin;
  final VoidCallback onLogout;
  final VoidCallback onDone;
  final bool legacyPin;

  @override
  State<InOnePinVerificationScreen> createState() => _InOnePinVerificationScreenState();
}

class _InOnePinVerificationScreenState extends State<InOnePinVerificationScreen>
    with InOneActionState<InOnePinVerificationScreen> {
  final InOneFormController _form = InOneFormController(required: const ['pin']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run('verify', () => widget.onSubmit(_form.value('pin')), onSuccess: widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: inOnePinCopy(context, 'verifyTitle'),
      banner: bannerText ?? inOnePinCopy(context, 'verifyBanner'),
      dock: [
        InOneField(
          form: _form,
          name: 'pin',
          label: inOnePinCopy(context, widget.legacyPin ? 'legacyPinLabel' : 'pinLabel'),
          obscure: true,
          keyboardType: TextInputType.number,
          maxLength: widget.legacyPin ? 12 : 8,
          textInputAction: TextInputAction.done,
          onSubmitted: _submit,
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: inOnePinCopy(context, 'confirm'),
          loading: isBusy('verify'),
          onPressed: blocked ? null : _submit,
        ),
        TextButton(
          onPressed: blocked ? null : widget.onForgotPin,
          child: Text(inOnePinCopy(context, 'forgot')),
        ),
        TextButton(
          onPressed: blocked ? null : widget.onLogout,
          child: Text(inOnePinCopy(context, 'logout')),
        ),
      ],
    );
  }
}
