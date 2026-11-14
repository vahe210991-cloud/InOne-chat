import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import '../core/data/inone_profile.dart';
import '../core/data/inone_repositories.dart';
import '../core/data/inone_room.dart';
import '../core/network/api_environment.dart';
import '../core/network/api_exception.dart';
import '../core/session/inone_session.dart';
import '../ui_dart_source/inone.dart';

const _configuredApiBaseUrl = String.fromEnvironment('INONE_API_BASE_URL');

class InOneMobileApp extends StatefulWidget {
  const InOneMobileApp({super.key});

  @override
  State<InOneMobileApp> createState() => _InOneMobileAppState();
}

class _InOneMobileAppState extends State<InOneMobileApp> {
  late final InOneSession _session;
  late final InOneRepositories _repositories;

  String _screen = 'login';
  String _registrationEmail = '';
  String _registrationToken = '';
  String _recoveryEmail = '';
  String _cancelMode = 'recovery';
  String _loginEmail = '';
  String _loginPassword = '';
  String? _waitingUntil;
  Map<String, dynamic>? _loginResponse;
  InOneProfile? _profile;
  List<InOneRoom> _rooms = const [];
  InOneFailure? _loadFailure;
  bool _darkMode = false;
  bool _initializing = true;

  @override
  void initState() {
    super.initState();
    final baseUrl = resolveInOneApiBaseUrl(
      configured: _configuredApiBaseUrl,
      isAndroid: Platform.isAndroid,
    );
    _session = InOneSession(baseUrl: baseUrl);
    _repositories = InOneRepositories(_session);
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      await _session.initialize();
    } catch (error) {
      _loadFailure = _toFailure(error);
    }
    if (mounted) setState(() => _initializing = false);
  }

  @override
  void dispose() {
    _session.dispose();
    super.dispose();
  }

  InOneFailure _toFailure(Object error) {
    if (error is ApiException) {
      if (error.code == 'network_unavailable' || error.code == 'request_timeout') {
        return const InOneFailure(
          InOneScreenState.offline,
          message: 'Нет соединения с сервером. Проверьте подключение и повторите попытку.',
        );
      }
      if (error.statusCode == 429) {
        return const InOneFailure(
          InOneScreenState.rateLimited,
          message: 'Слишком много запросов. Подождите и попробуйте снова.',
        );
      }
      if (error.statusCode == 503) {
        return const InOneFailure(
          InOneScreenState.maintenance,
          message: 'Сервис временно недоступен. Попробуйте позже.',
        );
      }
      final message = switch (error.statusCode) {
        400 => 'Проверьте введённые данные.',
        401 => 'Неверные данные для входа или сессия завершена.',
        403 => 'Операция не разрешена для этой учётной записи.',
        404 => 'Запрошенные данные не найдены.',
        409 => 'Операция конфликтует с текущим состоянием учётной записи.',
        _ => 'Не удалось выполнить запрос. Попробуйте позже.',
      };
      return InOneFailure(InOneScreenState.error, message: message);
    }
    return const InOneFailure(
      InOneScreenState.error,
      message: 'Не удалось выполнить операцию. Попробуйте позже.',
    );
  }

  Future<InOneFailure?> _runApi(Future<Object?> Function() operation) async {
    try {
      await operation();
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _login(String email, String password) async {
    _loginEmail = email;
    _loginPassword = password;
    try {
      _loginResponse = await _session.login(email: email, password: password);
      if (_session.isAuthenticated) return null;

      final status = _loginResponse?['status'];
      if (status == 'waiting_period' && _loginResponse?['activateAt'] is String) {
        _waitingUntil = _loginResponse!['activateAt'] as String;
        _cancelMode = 'admission';
        return null;
      }
      if (status == 'approval_required') {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Вход ожидает подтверждения на другом устройстве. Сценарий подтверждения устройства ещё не подключён.',
        );
      }
      if (status == 'identity_check_required') {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Для входа требуется дополнительная проверка личности. Этот сценарий ещё не подключён.',
        );
      }
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Сервер не выдал активную сессию. Вход не выполнен.',
      );
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _afterLogin() {
    if (_session.isAuthenticated) {
      unawaited(_loadAuthenticatedData());
    } else if (_waitingUntil != null) {
      setState(() => _screen = 'waiting');
    }
  }

  Future<void> _recheckWaitingLogin() async {
    try {
      _loginResponse = await _session.login(email: _loginEmail, password: _loginPassword);
      if (_session.isAuthenticated) {
        return;
      }
      final status = _loginResponse?['status'];
      if (status == 'waiting_period' && _loginResponse?['activateAt'] is String) {
        _waitingUntil = _loginResponse!['activateAt'] as String;
        return;
      }
      throw const ApiException(code: 'device_wait_state_changed', statusCode: 409, retryable: false);
    } catch (error) {
      if (error is ApiException && error.code == 'device_wait_state_changed') {
        _loadFailure = const InOneFailure(
          InOneScreenState.error,
          message: 'Состояние входа изменилось. Вернитесь ко входу и повторите попытку.',
        );
      } else {
        _loadFailure = _toFailure(error);
      }
    }
  }

  void _afterWaitingRecheck() {
    if (_session.isAuthenticated) {
      unawaited(_loadAuthenticatedData());
    } else if (_waitingUntil == null) {
      setState(() => _screen = 'login');
    } else {
      setState(() {});
    }
  }

  Future<void> _loadAuthenticatedData() async {
    if (!_session.isAuthenticated) {
      setState(() => _screen = 'login');
      return;
    }
    setState(() {
      _screen = 'loading';
      _loadFailure = null;
    });
    try {
      final profile = await _repositories.profile();
      final rooms = await _repositories.myRooms();
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _rooms = rooms;
        _screen = 'messages';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadFailure = _toFailure(error);
        _screen = 'loadError';
      });
    }
  }

  Future<InOneFailure?> _startEmailRegistration(String email) async {
    _registrationEmail = email.trim();
    return _runApi(() => _session.startEmailRegistration(_registrationEmail));
  }

  Future<InOneFailure?> _confirmEmailRegistration(String code) async {
    try {
      final response = await _session.confirmEmailRegistration(
        email: _registrationEmail,
        code: code,
      );
      final token = response['registrationToken'];
      if (token is! String || token.isEmpty) {
        return const InOneFailure(
          InOneScreenState.error,
          message: 'Сервер не вернул токен подтверждения регистрации.',
        );
      }
      _registrationToken = token;
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _createAccount(
    String nickname,
    String password,
    String phone,
  ) async {
    if (_registrationEmail.isEmpty || _registrationToken.isEmpty) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Сначала подтвердите адрес электронной почты.',
      );
    }
    return _runApi(() => _session.registerAccount(
          email: _registrationEmail,
          registrationToken: _registrationToken,
          password: password,
          nickname: nickname,
          phone: phone,
        ));
  }

  Future<InOneFailure?> _startRecovery(String email) async {
    _recoveryEmail = email.trim();
    return _runApi(() => _session.request(
          'POST',
          '/recovery/start',
          authenticated: false,
          body: {'email': _recoveryEmail},
        ));
  }

  Future<InOneFailure?> _completeRecovery(
    String code,
    String newPassword,
    String pin,
  ) async {
    if (_recoveryEmail.isEmpty) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Сначала запросите восстановление по электронной почте.',
      );
    }
    return _runApi(() => _session.request(
          'POST',
          '/recovery/complete',
          authenticated: false,
          body: {
            'email': _recoveryEmail,
            'code': code,
            'newPassword': newPassword,
            if (pin.isNotEmpty) 'pin': pin,
          },
        ));
  }

  Future<InOneFailure?> _cancelAttempt(String email, String code) async {
    final path = _cancelMode == 'admission'
        ? '/admission/cancel'
        : '/recovery/cancel-by-code';
    return _runApi(() => _session.request(
          'POST',
          path,
          authenticated: false,
          body: {'email': email.trim(), 'code': code.trim()},
        ));
  }

  Future<InOneFailure?> _logout() async {
    try {
      await _session.logout();
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _finishLogout() {
    setState(() {
      _profile = null;
      _rooms = const [];
      _registrationEmail = '';
      _registrationToken = '';
      _recoveryEmail = '';
      _waitingUntil = null;
      _loginPassword = '';
      _screen = 'login';
    });
  }

  void _notice(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  List<InOneChatPreview> get _chatPreviews => _rooms.map((room) {
        final isDirect = room.kind == 'direct';
        return InOneChatPreview(
          id: room.roomId,
          name: room.name?.trim().isNotEmpty == true ? room.name!.trim() : 'Чат',
          lastMessage: null,
          time: '',
          kind: isDirect ? InOneChatKind.person : InOneChatKind.group,
        );
      }).toList(growable: false);

  InOneUserProfile get _userProfile {
    final profile = _profile!;
    return InOneUserProfile(
      name: profile.nickname?.isNotEmpty == true
          ? profile.nickname!
          : (profile.email ?? 'Пользователь'),
      handle: profile.email ?? profile.userId,
      myTasks: '—',
      activity: '—',
      projects: '—',
      verified: profile.verificationLevel > 0,
    );
  }

  void _selectTab(InOneTab tab) {
    switch (tab) {
      case InOneTab.messages:
        setState(() => _screen = 'messages');
      case InOneTab.profile:
        setState(() => _screen = 'profile');
      case InOneTab.feed:
      case InOneTab.calls:
        _notice('Этот раздел пока не входит в подключённый объём Beta 1.0.');
    }
  }

  Widget _buildScreen() {
    if (_initializing) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    switch (_screen) {
      case 'login':
        return InOneLoginScreen(
          onSubmit: _login,
          onProvider: (provider) async => const InOneFailure(
            InOneScreenState.error,
            message: 'Вход через Google и Apple пока заблокирован: нативная проверка провайдера не подключена.',
          ),
          onRegister: () => setState(() => _screen = 'registerEmail'),
          onForgotPassword: () => setState(() => _screen = 'recoveryStart'),
          onSuccess: _afterLogin,
        );
      case 'registerEmail':
        return InOneRegisterEmailScreen(
          onSubmit: _startEmailRegistration,
          onBack: () => setState(() => _screen = 'login'),
          onHaveAccount: () => setState(() => _screen = 'login'),
          onDone: () => setState(() => _screen = 'emailCode'),
        );
      case 'emailCode':
        return InOneEmailCodeScreen(
          onConfirm: _confirmEmailRegistration,
          onResend: () => _startEmailRegistration(_registrationEmail),
          onBack: () => setState(() => _screen = 'registerEmail'),
          onDone: () => setState(() => _screen = 'createAccount'),
        );
      case 'createAccount':
        return InOneCreateAccountScreen(
          onSubmit: _createAccount,
          onBack: () => setState(() => _screen = 'emailCode'),
          onDone: () {
            setState(() {
              _registrationToken = '';
              _screen = 'login';
            });
            _notice('Регистрация завершена. Теперь войдите в аккаунт.');
          },
        );
      case 'recoveryStart':
        return InOneRecoveryStartScreen(
          onSubmit: _startRecovery,
          onBack: () => setState(() => _screen = 'login'),
          onEnterCode: () => setState(() => _screen = 'newPassword'),
        );
      case 'newPassword':
        return InOneNewPasswordScreen(
          onSubmit: _completeRecovery,
          keyResetWarning: null,
          onDone: () {
            setState(() => _screen = 'login');
            _notice('Пароль изменён. Войдите с новым паролем.');
          },
        );
      case 'notYou':
        return InOneNotYouScreen(
          onSubmit: _cancelAttempt,
          onBack: () => setState(() => _screen = 'login'),
          onDone: () {
            setState(() => _screen = 'login');
            _notice('Запрос отменён.');
          },
        );
      case 'waiting':
        return InOneLoginWaitingScreen(
          activateAt: _waitingUntil ?? '—',
          onRecheck: _recheckWaitingLogin,
          onNotMe: () {
            _cancelMode = 'admission';
            setState(() => _screen = 'notYou');
          },
          onDone: _afterWaitingRecheck,
        );
      case 'logout':
        return InOneLogoutScreen(
          onLogout: _logout,
          onCancel: () => setState(() => _screen = 'profile'),
          onDone: _finishLogout,
        );
      case 'loading':
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case 'loadError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
      case 'messages':
        return InOneMessagesScreen(
          chats: _chatPreviews,
          onOpenChat: (chat) => _notice(
            'История и отправка сообщений пока заблокированы до подключения нативного MLS-клиента и зашифрованного локального хранилища. Сообщение не отправлено.',
          ),
          onSearch: () => _notice('Поиск по содержимому сообщений пока не реализован.'),
          onFilter: () => _notice('Дополнительные фильтры пока недоступны.'),
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      case 'profile':
        if (_profile == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
        }
        return InOneProfileScreen(
          profile: _userProfile,
          menu: [
            InOneProfileMenuItem(
              label: 'Выйти из аккаунта',
              icon: Icons.logout,
              destructive: true,
              onTap: () => setState(() => _screen = 'logout'),
            ),
          ],
          onToggleTheme: () => setState(() => _darkMode = !_darkMode),
          onEditAvatar: () => _notice(
            'Изменение аватара недоступно: серверный endpoint обновления профиля не подтверждён.',
          ),
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      default:
        return InOneLoginScreen(
          onSubmit: _login,
          onProvider: (provider) async => const InOneFailure(InOneScreenState.error),
          onRegister: () => setState(() => _screen = 'registerEmail'),
          onForgotPassword: () => setState(() => _screen = 'recoveryStart'),
          onSuccess: _afterLogin,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'InOne',
      debugShowCheckedModeBanner: false,
      theme: InOneTheme.light(),
      darkTheme: InOneTheme.dark(),
      themeMode: _darkMode ? ThemeMode.dark : ThemeMode.light,
      home: Scaffold(
        body: SafeArea(
          child: InOneStatusScope(
            state: InOneScreenState.idle,
            child: _buildScreen(),
          ),
        ),
      ),
    );
  }
}
