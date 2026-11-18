import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import '../core/data/inone_profile.dart';
import '../core/data/inone_public_config.dart';
import '../core/data/inone_organization.dart';
import '../core/data/inone_repositories.dart';
import '../core/data/inone_room.dart';
import '../core/network/api_environment.dart';
import '../core/network/api_exception.dart';
import '../core/session/inone_session.dart';
import '../core/session/recovery_deep_link.dart';
import '../ui_dart_source/inone.dart';

const _configuredApiBaseUrl = String.fromEnvironment('INONE_API_BASE_URL');

class InOneMobileApp extends StatefulWidget {
  const InOneMobileApp({super.key});

  @override
  State<InOneMobileApp> createState() => _InOneMobileAppState();
}

class _InOneMobileAppState extends State<InOneMobileApp> with WidgetsBindingObserver {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  late final InOneSession _session;
  late final InOneRepositories _repositories;

  String _screen = 'login';
  String _registrationEmail = '';
  String _recoveryEmail = '';
  String _pendingLoginEmail = '';
  String _pendingLoginPassword = '';
  String _waitingActivateAt = '';
  InOneProfile? _profile;
  List<InOneRoom> _rooms = const [];
  List<InOneOrganization> _organizations = const [];
  InOneOrganization? _selectedOrganization;
  InOneSystemStatus? _systemStatus;
  bool _darkMode = false;
  bool _initializing = true;
  bool _recoveryLinkInFlight = false;
  final Set<int> _handledRecoveryLinkFingerprints = <int>{};

  @override
  void initState() {
    super.initState();
    final baseUrl = resolveInOneApiBaseUrl(
      configured: _configuredApiBaseUrl,
      isAndroid: Platform.isAndroid,
    );
    _session = InOneSession(baseUrl: baseUrl);
    _repositories = InOneRepositories(_session);
    WidgetsBinding.instance.addObserver(this);
    final initialRoute = WidgetsBinding.instance.platformDispatcher.defaultRouteName;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_handleRecoveryRoute(initialRoute));
    });
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      await _session.initialize();
    } catch (_) {
      // The first authenticated operation will surface a safe UI error.
    }
    if (!mounted) return;
    setState(() => _initializing = false);
    if (_session.isAuthenticated) await _loadAuthenticatedData();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
    try {
      final response = await _session.login(email: email, password: password);
      if (_session.isAuthenticated) return null;

      final status = response['status'];
      if (status == 'waiting_period' && response['activateAt'] is String) {
        _pendingLoginEmail = email.trim();
        _pendingLoginPassword = password;
        _waitingActivateAt = _formatActivationTime(response['activateAt'] as String);
        if (mounted) setState(() => _screen = 'loginWaiting');
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
          message: 'Для этого входа требуется дополнительное подтверждение. Текущий мобильный контракт его не поддерживает; вход не выполнен.',
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
    if (_session.isAuthenticated) unawaited(_loadAuthenticatedData());
  }
  String _formatActivationTime(String raw) {
    final parsed = DateTime.tryParse(raw)?.toLocal();
    if (parsed == null) return raw;
    return '${parsed.day.toString().padLeft(2, '0')}.${parsed.month.toString().padLeft(2, '0')}.${parsed.year} ${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
  }

  Future<InOneFailure?> _recheckWaitingLogin() async {
    try {
      final result = await _session.login(email: _pendingLoginEmail, password: _pendingLoginPassword);
      if (_session.isAuthenticated) return null;
      if (result['status'] == 'waiting_period' && result['activateAt'] is String) {
        _waitingActivateAt = _formatActivationTime(result['activateAt'] as String);
        if (mounted) setState(() {});
        return null;
      }
      return const InOneFailure(InOneScreenState.error, message: 'Вход пока не подтверждён.');
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _startRecovery(String email) async {
    _recoveryEmail = email.trim();
    try {
      await _session.startRecovery(email: _recoveryEmail);
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _completeRecovery(String code, String newPassword, String pin) async {
    try {
      await _session.completeRecovery(
        email: _recoveryEmail,
        code: code,
        newPassword: newPassword,
        pin: pin,
      );
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _cancelRecoveryByCode(String email, String code) async {
    try {
      await _session.cancelRecoveryByCode(email: email, code: code);
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  void _finishRecovery() {
    setState(() {
      _recoveryEmail = '';
      _screen = 'login';
    });
    _notice('Восстановление завершено. Теперь войдите с новым паролем.');
  }

  void _finishRecoveryCancellation() {
    setState(() {
      _recoveryEmail = '';
      _screen = 'login';
    });
    _notice('Восстановление отменено. Прежний пароль восстановлен.');
  }


  Future<void> _loadAuthenticatedData() async {
    if (!_session.isAuthenticated) {
      setState(() => _screen = 'login');
      return;
    }
    setState(() => _screen = 'loading');
    try {
      final profile = await _repositories.profile();
      final rooms = await _repositories.myRooms();
      final organizationResponse = await _repositories.myOrganizations();
      final organizations = InOneOrganizationList.fromJson(organizationResponse).orgs;
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _rooms = rooms;
        _organizations = organizations;
        _selectedOrganization = organizations.isEmpty ? null : organizations.first;
        _screen = 'messages';
      });
    } catch (_) {
      if (mounted) setState(() => _screen = 'loadError');
    }
  }

  Future<InOneFailure?> _startEmailRegistration(String email) async {
    _registrationEmail = email.trim();
    return _runApi(() => _session.startEmailRegistration(_registrationEmail));
  }

  Future<InOneFailure?> _confirmEmailRegistration(String code) async {
    try {
      await _session.confirmEmailRegistration(
        email: _registrationEmail,
        code: code,
      );
      // The one-time registration ticket remains inside InOneSession.
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
    if (_registrationEmail.isEmpty) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Сначала подтвердите адрес электронной почты.',
      );
    }
    return _runApi(() => _session.registerAccount(
          email: _registrationEmail,
          password: password,
          nickname: nickname,
          phone: phone,
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
      _organizations = const [];
      _selectedOrganization = null;
      _systemStatus = null;
      _registrationEmail = '';
      _screen = 'login';
    });
  }

  void _notice(String message) {
    _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(message)));
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
      handle: profile.email ?? 'Аккаунт InOne',
      myTasks: '—',
      activity: '—',
      projects: '—',
      verified: profile.verificationLevel > 0,
    );
  }

  InOneWorkspaceSummary get _workspaceSummary => InOneWorkspaceSummary(
        name: _selectedOrganization?.name ?? 'Личное пространство',
        activeProjects: null,
        tasksDue: null,
        teamMembers: null,
        activeGroups: null,
        projectsCaption: '',
      );

  InOneOrgProfile get _organizationProfile {
    final org = _selectedOrganization!;
    return InOneOrgProfile(
      name: org.name,
      subtitle: '${org.role} · ${org.status}',
      members: null,
      projects: null,
      teams: null,
      about: null,
      verified: false,
    );
  }

  Future<void> _loadSystemStatus() async {
    setState(() => _screen = 'systemStatusLoading');
    try {
      final config = InOnePublicConfig.fromJson(await _repositories.publicConfig());
      if (!mounted) return;
      setState(() {
        _systemStatus = InOneSystemStatus(
          version: config.minimumAppVersion,
          maintenance: config.maintenanceEnabled,
          flags: {'maintenance.enabled': config.maintenanceEnabled},
        );
        _screen = 'systemStatus';
      });
    } catch (_) {
      if (mounted) setState(() => _screen = 'systemStatusError');
    }
  }

  void _openOrganization() {
    if (_selectedOrganization == null) {
      _notice('У этой учётной записи пока нет подтверждённых организаций.');
      return;
    }
    setState(() => _screen = 'organization');
  }

  Future<void> _chooseOrganization() async {
    if (_organizations.isEmpty) {
      _notice('Нет доступных организаций для переключения.');
      return;
    }
    if (_organizations.length == 1) {
      _notice('Доступна одна организация. Переключение не требуется.');
      return;
    }
    final selected = await showDialog<InOneOrganization>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Выберите организацию'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final org in _organizations)
              ListTile(
                title: Text(org.name),
                subtitle: Text('${org.role} · ${org.status}'),
                onTap: () => Navigator.of(dialogContext).pop(org),
              ),
          ],
        ),
      ),
    );
    if (selected != null && mounted) {
      setState(() {
        _selectedOrganization = selected;
        _screen = 'workspace';
      });
    }
  }

  void _selectTab(InOneTab tab) {
    switch (tab) {
      case InOneTab.messages:
        setState(() => _screen = 'messages');
        return;
      case InOneTab.profile:
        setState(() => _screen = 'profile');
        return;
      case InOneTab.feed:
      case InOneTab.calls:
        _notice('Этот раздел пока не входит в подключённый объём Beta 1.0.');
        return;
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
          onProvider: (_) async => const InOneFailure(
            InOneScreenState.error,
            message: 'Вход через Google и Apple пока заблокирован: нативная проверка провайдера не подключена.',
          ),
          onRegister: () => setState(() => _screen = 'registerEmail'),
          onForgotPassword: () => setState(() => _screen = 'recoveryStart'),
          onSuccess: _afterLogin,
        );
      case 'loginWaiting':
        return InOneLoginWaitingScreen(
          activateAt: _waitingActivateAt,
          onRecheck: _recheckWaitingLogin,
          onNotMe: () => setState(() => _screen = 'notYou'),
          onDone: _afterLogin,
        );
      case 'recoveryStart':
        return InOneRecoveryStartScreen(
          onSubmit: _startRecovery,
          onBack: () => setState(() => _screen = 'login'),
          onEnterCode: () => setState(() => _screen = 'recoveryPassword'),
        );
      case 'recoveryPassword':
        return InOneNewPasswordScreen(
          onSubmit: _completeRecovery,
          onDone: _finishRecovery,
        );
      case 'notYou':
        return InOneNotYouScreen(
          onSubmit: _cancelRecoveryByCode,
          onBack: () => setState(() => _screen = 'login'),
          onDone: _finishRecoveryCancellation,
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
              _screen = 'login';
            });
            _notice('Регистрация завершена. Теперь войдите в аккаунт.');
          },
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
      case 'workspace':
        return InOneWorkspaceScreen(
          summary: _workspaceSummary,
          modules: [
            InOneModuleTile(label: 'Messages', icon: Icons.forum_outlined, onTap: () => setState(() => _screen = 'messages')),
            InOneModuleTile(label: 'Organization', icon: Icons.business_outlined, onTap: _openOrganization),
            InOneModuleTile(label: 'Profile', icon: Icons.person_outline, onTap: () => setState(() => _screen = 'profile')),
            InOneModuleTile(label: 'System status', icon: Icons.settings_outlined, onTap: () => unawaited(_loadSystemStatus())),
          ],
          activity: const [],
          onSwitchWorkspace: _chooseOrganization,
          onNotifications: () => _notice('Лента уведомлений пока не подключена к серверному контракту.'),
          onCustomize: () => _notice('Настройка модулей пока недоступна.'),
          onSeeAll: () => _notice('Лента активности пока не предоставляется backend.'),
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      case 'organization':
        if (_selectedOrganization == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
        }
        return InOneOrgProfileScreen(
          profile: _organizationProfile,
          onBack: () => setState(() => _screen = 'workspace'),
          onMore: _chooseOrganization,
          onEditCover: null,
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      case 'systemStatusLoading':
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case 'systemStatusError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadSystemStatus()));
      case 'systemStatus':
        if (_systemStatus == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadSystemStatus()));
        }
        return InOneSystemStatusScreen(
          status: _systemStatus!,
          onMenu: () => setState(() => _screen = 'workspace'),
        );
      case 'messages':
        return InOneMessagesScreen(
          chats: _chatPreviews,
          unreadCountsAvailable: false,
          onOpenChat: (_) => _notice(
            'История и отправка сообщений заблокированы до подключения нативного MLS-клиента и зашифрованного локального хранилища. Сообщение не отправлено.',
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
              label: 'Рабочее пространство',
              icon: Icons.workspaces_outline,
              onTap: () => setState(() => _screen = 'workspace'),
            ),
            InOneProfileMenuItem(
              label: 'Организация',
              icon: Icons.business_outlined,
              onTap: _openOrganization,
            ),
            InOneProfileMenuItem(
              label: 'Состояние системы',
              icon: Icons.settings_outlined,
              onTap: () => unawaited(_loadSystemStatus()),
            ),
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
          onForgotPassword: () => _notice('Восстановление пароля пока недоступно.'),
          onSuccess: _afterLogin,
        );
    }
  }


  @override
  Future<bool> didPushRoute(String route) => _handleRecoveryRoute(route);

  @override
  Future<bool> didPushRouteInformation(RouteInformation routeInformation) =>
      _handleRecoveryRoute(routeInformation.uri.toString());

  Future<bool> _handleRecoveryRoute(String rawRoute) async {
    final payload = RecoveryDeepLink.parse(rawRoute);
    if (payload == null) return false;

    final fingerprint = Object.hash(payload.userId, payload.token);
    if (_handledRecoveryLinkFingerprints.contains(fingerprint)) return true;
    if (_recoveryLinkInFlight) return true;

    _recoveryLinkInFlight = true;
    try {
      await _session.confirmRecoveryLink(
        userId: payload.userId,
        token: payload.token,
      );
      if (!mounted) return true;
      _handledRecoveryLinkFingerprints.add(fingerprint);
      final message = switch (payload.locale) {
        'ru' => 'Ссылка подтверждена. Вернитесь в приложение и введите код восстановления.',
        'en' => 'The link is confirmed. Return to the app and enter your recovery code.',
        _ => 'Հղումը հաստատված է։ Վերադարձեք հավելված և մուտքագրեք վերականգնման կոդը։',
      };
      _notice(message);
    } on ApiException catch (error) {
      if (!mounted) return true;
      if (!error.retryable) _handledRecoveryLinkFingerprints.add(fingerprint);
      final message = switch (payload.locale) {
        'ru' => error.code == 'recovery_expired'
            ? 'Ссылка восстановления истекла. Запросите новую.'
            : 'Не удалось подтвердить ссылку восстановления. Проверьте ссылку и повторите попытку.',
        'en' => error.code == 'recovery_expired'
            ? 'The recovery link expired. Request a new one.'
            : 'Could not confirm the recovery link. Check it and try again.',
        _ => error.code == 'recovery_expired'
            ? 'Վերականգնման հղումը ժամկետանց է։ Խնդրեք նորը։'
            : 'Չհաջողվեց հաստատել վերականգնման հղումը։ Ստուգեք այն և կրկին փորձեք։',
      };
      _notice(message);
    } catch (_) {
      if (mounted) {
        final message = switch (payload.locale) {
          'ru' => 'Нет соединения. Не удалось подтвердить восстановление.',
          'en' => 'Connection unavailable. Recovery could not be confirmed.',
          _ => 'Կապ չկա։ Չհաջողվեց հաստատել վերականգնումը։',
        };
        _notice(message);
      }
    } finally {
      _recoveryLinkInFlight = false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      scaffoldMessengerKey: _messengerKey,
      title: 'InOne',
      debugShowCheckedModeBanner: false,
      theme: InOneTheme.light(),
      darkTheme: InOneTheme.dark(),
      themeMode: _darkMode ? ThemeMode.dark : ThemeMode.light,
      home: InOneStatusScope(
        state: InOneScreenState.idle,
        child: _buildScreen(),
      ),
    );
  }
}
