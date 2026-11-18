import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-06 · Հաշվի ստեղծում (после Google/Apple): ввод никнейма.
/// «Назад» ведёт на SC-01 (отдельного SC-05 больше нет).
class InOneProviderNicknameScreen extends StatefulWidget {
  const InOneProviderNicknameScreen({
    super.key,
    required this.onSubmit,
    required this.onBack,
    this.onDone,
  });

  /// POST /register/provider. `null` — успех.
  final Future<InOneFailure?> Function(String nickname) onSubmit;
  final VoidCallback onBack;
  final VoidCallback? onDone;

  @override
  State<InOneProviderNicknameScreen> createState() => _InOneProviderNicknameScreenState();
}

class _InOneProviderNicknameScreenState extends State<InOneProviderNicknameScreen>
    with InOneActionState<InOneProviderNicknameScreen> {
  final InOneFormController _form = InOneFormController(required: const ['nickname']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run('submit', () => widget.onSubmit(_form.value('nickname').trim()), onSuccess: widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.auth(
      title: 'Հաշվի ստեղծում',
      onBack: widget.onBack,
      banner: bannerText,
      dock: [
        InOneField(
          form: _form,
          name: 'nickname',
          label: 'Մականուն',
          autofillHints: const [AutofillHints.nickname],
          textInputAction: TextInputAction.done,
          onSubmitted: _submit,
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Ստեղծել հաշիվ',
          loading: isBusy('submit'),
          onPressed: blocked ? null : _submit,
        ),
      ],
    );
  }
}
