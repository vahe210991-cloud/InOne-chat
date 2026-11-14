import 'package:flutter/material.dart';

import '../../state/inone_state.dart';
import '../../widgets/inone_widgets.dart';

/// RQ-01 · Նոր հայտ: подача заявки на организацию (название 2…120 символов).
class InOneNewRequestScreen extends StatefulWidget {
  const InOneNewRequestScreen({
    super.key,
    required this.onSubmit,
    required this.onBack,
    required this.onMenu,
    this.onDone,
  });

  /// POST /org-requests. `null` — успех.
  final Future<InOneFailure?> Function(String name) onSubmit;
  final VoidCallback onBack;
  final VoidCallback onMenu;

  /// Заявка подана → экран RQ-02 (документы).
  final VoidCallback? onDone;

  @override
  State<InOneNewRequestScreen> createState() => _InOneNewRequestScreenState();
}

class _InOneNewRequestScreenState extends State<InOneNewRequestScreen>
    with InOneActionState<InOneNewRequestScreen> {
  final InOneFormController _form =
      InOneFormController(required: const ['name'], minLength: const {'name': 2});

  @override
  void dispose() {
    _form.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.validate()) return;
    run('submit', () => widget.onSubmit(_form.value('name').trim()), onSuccess: widget.onDone);
  }

  @override
  Widget build(BuildContext context) {
    return InOneScreen.bar(
      title: 'Նոր հայտ',
      onBack: widget.onBack,
      onMenu: widget.onMenu,
      banner: bannerText,
      dock: [
        InOneField(
          form: _form,
          name: 'name',
          label: 'Կազմակերպության անվանումը',
          maxLength: 120,
          textInputAction: TextInputAction.done,
          onSubmitted: _submit,
        ),
        const SizedBox(height: 10),
        InOneButton(
          label: 'Ներկայացնել հայտ',
          loading: isBusy('submit'),
          onPressed: blocked ? null : _submit,
        ),
      ],
    );
  }
}
