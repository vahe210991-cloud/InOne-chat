import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import '../core/data/inone_profile.dart';
import '../core/data/inone_organization.dart';
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
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  late final InOneSession _session;
  late final InOneRepositories _repositories;

  String _screen = 'login';
  String _registrationEmail = '';
  String _registrationToken = '';
  InOneProfile? _profile;
  List<InOneRoom> _rooms = const [];
  List<InOneOrganization> _organizations = const [];
  InOneOrganization? _selectedOrganization;
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
    } catch (_) {
      // The first authenticated operation will surface a safe UI error.
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
    try {
      final response = await _session.login(email: email, password: password);
      if (_session.isAuthenticated) return null;

      final status = response['status'];
      if (status == 'waiting_period' && response['activateAt'] is String) {
        final raw = response['activateAt'] as String;
        final parsed = DateTime.tryParse(raw)?.toLocal();
        final display = parsed == null
            ? raw
            : '${parsed.day.toString().padLeft(2, '0')}.${parsed.month.toString().padLeft(2, '0')}.${parsed.year} ${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
        return InOneFailure(
          InOneScreenState.error,
          message: 'Вход с нового устройства станет доступен $display. После этого повторите вход.',
        );
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
    if (_session.isAuthenticated) unawaited(_loadAuthenticatedData());
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
      final organizations = await _repositories.myOrganizations();
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
      _registrationEmail = '';
      _registrationToken = '';
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
          onProvider: (provider) async => const InOneFailure(
            InOneScreenState.error,
            message: 'Вход через Google и Apple пока заблокирован: нативная проверка провайдера не подключена.',
          ),
          onRegister: () => setState(() => _screen = 'registerEmail'),
          onForgotPassword: () => _notice(
            'Восстановление временно отключено до подключения deep link подтверждения и утверждения предупреждения о сбросе ключей.',
          ),
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
            InOneModuleTile(label: 'Notifications', icon: Icons.notifications_outlined, onTap: () => _notice('Лента уведомлений пока не подключена к серверному контракту.')),
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
      case 'messages':
        return InOneMessagesScreen(
          chats: _chatPreviews,
          unreadCountsAvailable: false,
          onOpenChat: (chat) => _notice(
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
