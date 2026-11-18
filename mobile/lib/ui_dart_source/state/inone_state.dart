import 'package:flutter/widgets.dart';

/// Состояния экрана (из согласованных экранов: loading, waiting, offline, …).
enum InOneScreenState {
  idle,
  loading,
  waiting,
  offline,
  maintenance,
  unavailable,
  rateLimited,
  error,
}

extension InOneScreenStateX on InOneScreenState {
  /// В этих состояниях кнопки и переключатели заблокированы.
  bool get blocksActions => this != InOneScreenState.idle && this != InOneScreenState.error;
  bool get isBusy => this == InOneScreenState.loading || this == InOneScreenState.waiting;
}

/// Тексты баннеров. Тексты ошибок по кодам backend берутся из каталога ERROR_TEXT
/// и передаются через [InOneFailure.message].
abstract final class InOneMessages {
  static const offline = 'Սերվերի հետ կապ չկա';
  static const maintenance = 'Ծառայությունը տեխնիկական սպասարկման մեջ է';
  static const unavailable = 'Ծառայությունը ժամանակավորապես անհասանելի է';
  static const rateLimited = 'Չափազանց շատ հարցումներ։ Սպասեք և նորից փորձեք';

  /// ЗАГЛУШКА дизайна: настоящий текст ошибки приходит из каталога ERROR_TEXT.
  static const errorPlaceholder = 'Սխալի տեքստը՝ ըստ կոդի (ERROR_TEXT կատալոգ)';

  static String? forState(InOneScreenState state, {String? message}) {
    switch (state) {
      case InOneScreenState.idle:
      case InOneScreenState.loading:
      case InOneScreenState.waiting:
        return null;
      case InOneScreenState.offline:
        return message ?? offline;
      case InOneScreenState.maintenance:
        return message ?? maintenance;
      case InOneScreenState.unavailable:
        return message ?? unavailable;
      case InOneScreenState.rateLimited:
        return message ?? rateLimited;
      case InOneScreenState.error:
        return message ?? errorPlaceholder;
    }
  }
}

/// Результат неуспешной операции. `null` вместо [InOneFailure] означает успех.
@immutable
class InOneFailure {
  const InOneFailure(this.state, {this.message});
  final InOneScreenState state;
  final String? message;
}

enum InOneAuthProvider { google, apple }

/// Глобальное состояние (например, нет сети / техработы), общее для всех экранов.
class InOneStatusScope extends InheritedWidget {
  const InOneStatusScope({
    super.key,
    required this.state,
    this.message,
    required super.child,
  });

  final InOneScreenState state;
  final String? message;

  static InOneStatusScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<InOneStatusScope>();

  @override
  bool updateShouldNotify(InOneStatusScope oldWidget) =>
      state != oldWidget.state || message != oldWidget.message;
}

/// Общая логика действий экрана: loading/waiting, баннер, блокировка кнопок.
/// Исключения не логируются и не показываются «как есть» (в тексте могут быть секреты).
mixin InOneActionState<T extends StatefulWidget> on State<T> {
  InOneScreenState _local = InOneScreenState.idle;
  String? _localMessage;
  Object? _busyKey;

  InOneScreenState get status {
    if (_local != InOneScreenState.idle) return _local;
    return InOneStatusScope.maybeOf(context)?.state ?? InOneScreenState.idle;
  }

  String? get bannerText {
    if (_local != InOneScreenState.idle) {
      return InOneMessages.forState(_local, message: _localMessage);
    }
    final scope = InOneStatusScope.maybeOf(context);
    if (scope == null) return null;
    return InOneMessages.forState(scope.state, message: scope.message);
  }

  bool get blocked => status.blocksActions;
  bool isBusy(Object key) => status.isBusy && _busyKey == key;

  Future<void> run(
    Object key,
    Future<InOneFailure?> Function() call, {
    VoidCallback? onSuccess,
    InOneScreenState busy = InOneScreenState.loading,
  }) async {
    if (blocked) return;
    setState(() {
      _local = busy;
      _localMessage = null;
      _busyKey = key;
    });
    InOneFailure? failure;
    try {
      failure = await call();
    } catch (_) {
      failure = const InOneFailure(InOneScreenState.error);
    }
    if (!mounted) return;
    setState(() {
      _busyKey = null;
      _local = failure?.state ?? InOneScreenState.idle;
      _localMessage = failure?.message;
    });
    if (failure == null) onSuccess?.call();
  }

  /// Сбросить локальное состояние (например, при смене ввода).
  void resetState() {
    if (_local == InOneScreenState.idle) return;
    setState(() {
      _local = InOneScreenState.idle;
      _localMessage = null;
    });
  }
}
