import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// SC-09 · Նոր գաղտնաբառ: հաստատված email կոդ, վերականգնման PIN, նոր գաղտնաբառ.
///
/// Блок-предупреждение о сбросе ключей шифрования — ЗАГЛУШКА дизайна:
/// текст ждёт утверждения владельца (D8). Показ обязателен: после
/// восстановления ключи сбрасываются (keyResetAt). Передайте утверждённый
/// текст в [keyResetWarning]; пока он `null`, показывается заметка-заглушка.
class InOneNewPasswordScreen extends StatefulWidget {
  const InOneNewPasswordScreen({
    super.key,
    required this.onSubmit,
    this.keyResetWarning,
    this.onDone,
  });

  /// POST /recovery/complete. `pin` — пустая строка, если не задан. `null` — успех.
  final Future<InOneFailure?> Function(String code, String newPassword, String pin) onSubmit;

  /// Утверждённый текст предупреждения о сбросе ключей.
  final String? keyResetWarning;

  /// Пароль сохранён → экран SC-01.
  final VoidCallback? onDone;

  @override
  State<InOneNewPasswordScreen> createState() => _InOneNewPasswordScreenState();
}

class _InOneNewPasswordScreenState extends State<InOneNewPasswordScreen>
    with InOneActionState<InOneNewPasswordScreen> {
  final InOneFormController _form = InOneFormController(required: const ['code', 'pin', 'newPassword']);

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run(
      'submit',
      () => widget.onSubmit(
        _form.value('code').trim(),
        _form.value('newPassword'),
        _form.value('pin'),
      ),
      onSuccess: widget.onDone,
    );
  }

  @override
  Widget build(BuildContext context) {
    final warning = widget.keyResetWarning;
    return InOneScreen.auth(
      title: 'Նոր գաղտնաբառ',
      banner: bannerText,
      top: [
        if (warning == null)
          const InOneTodoNote(
            title: 'Գաղտնագրման բանալիների վերակայման զգուշացում',
            text: 'Տեքստը սպասում է սեփականատիրոջ հաստատմանը (D8)։ Ցուցադրումը պարտադիր է. '
                'վերականգնումից հետո բանալիները վերակայվում են (keyResetAt)։',
          )
        else
          InOneBanner.info(warning),
      ],
      dock: [
        AutofillGroup(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InOneField(
                form: _form,
                name: 'code',
                label: 'Կոդը հաստատված էլ. փոստից',
                keyboardType: TextInputType.number,
                maxLength: 6,
                autofillHints: const [AutofillHints.oneTimeCode],
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'pin',
                label: 'PIN-код восстановления · 8 цифр',
                maxLength: 8,
                obscure: true,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.next,
              ),
              InOneField(
                form: _form,
                name: 'newPassword',
                label: 'Նոր գաղտնաբառ',
                obscure: true,
                maxLength: 128,
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.done,
                onSubmitted: _submit,
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Պահպանել',
          loading: isBusy('submit'),
          onPressed: blocked ? null : _submit,
        ),
      ],
    );
  }
}
