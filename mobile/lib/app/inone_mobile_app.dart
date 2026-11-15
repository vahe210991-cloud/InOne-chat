import 'dart:async';
import 'dart:io' show Platform;

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../core/data/inone_profile.dart';
import '../core/data/inone_organization.dart';
import '../core/data/inone_repositories.dart';
import '../core/data/inone_room.dart';
import '../core/network/api_environment.dart';
import '../core/network/api_exception.dart';
import '../core/session/inone_session.dart';
import '../core/mls/rust_mls_session_bridge.dart';
import '../ui_dart_source/inone.dart';

const _configuredApiBaseUrl = String.fromEnvironment('INONE_API_BASE_URL');
const _nativeMlsEnabled = bool.fromEnvironment('INONE_MLS_NATIVE_ENABLED', defaultValue: false);
const _recoveryLinkHost = String.fromEnvironment('INONE_RECOVERY_LINK_HOST');

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
  String _recoveryEmail = '';
  String _recoveryUserId = '';
  String _recoveryLinkToken = '';
  String? _lastRecoveryLink;
  late final AppLinks _appLinks;
  StreamSubscription<Uri>? _appLinkSubscription;
  String _pendingLoginEmail = '';
  String _pendingLoginPassword = '';
  String _waitingActivateAt = '';
  InOneProfile? _profile;
  List<InOneRoom> _rooms = const [];
  InOneChatPreview? _selectedChat;
  List<InOneThreadItem> _threadItems = const [];
  bool _chatLoading = false;
  List<InOneOrganization> _organizations = const [];
  InOneOrganization? _selectedOrganization;
  InOneSystemStatus? _systemStatus;
  bool _darkMode = false;
  bool _initializing = true;

  @override
  void initState() {
    super.initState();
    _appLinks = AppLinks();
    _appLinkSubscription = _appLinks.uriLinkStream.listen(
      _handleIncomingLink,
      onError: (_) {},
    );
    unawaited(_readInitialRecoveryLink());
    final baseUrl = resolveInOneApiBaseUrl(
      configured: _configuredApiBaseUrl,
      isAndroid: Platform.isAndroid,
    );
    _session = InOneSession(
      baseUrl: baseUrl,
      nativeMlsBridge: _nativeMlsEnabled ? RustMlsSessionBridge() : null,
    );
    _repositories = InOneRepositories(_session);
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

  Future<void> _readInitialRecoveryLink() async {
    try {
      final initial = await _appLinks.getInitialLink();
      if (initial != null) _handleIncomingLink(initial);
    } catch (_) {
      // A missing or malformed launch URI must not prevent normal app startup.
    }
  }

  void _handleIncomingLink(Uri uri) {
    final customScheme = uri.scheme == 'inone' &&
        uri.host == 'recovery' &&
        uri.path == '/confirm';
    final verifiedHttps = _recoveryLinkHost.isNotEmpty &&
        uri.scheme == 'https' &&
        uri.host.toLowerCase() == _recoveryLinkHost.toLowerCase() &&
        uri.path == '/recovery/confirm';
    if (!customScheme && !verifiedHttps) return;

    final canonical = uri.toString();
    if (_lastRecoveryLink == canonical) return;
    _lastRecoveryLink = canonical;

    final userId = (uri.queryParameters['user'] ?? uri.queryParameters['userId'] ?? '').trim();
    final token = (uri.queryParameters['token'] ?? '').trim();
    if (userId.isEmpty || userId.length > 256 ||
        token.isEmpty || token.length > 128 ||
        userId.contains(RegExp(r'[\\r\\n]')) ||
        token.contains(RegExp(r'[\\r\\n]'))) {
      _notice('Ссылка восстановления повреждена. Запросите восстановление заново.');
      return;
    }
    if (!mounted) return;
    setState(() {
      _recoveryUserId = userId;
      _recoveryLinkToken = token;
      _recoveryEmail = '';
      _screen = 'recoveryConfirm';
    });
  }

  @override
  void dispose() {
    final subscription = _appLinkSubscription;
    if (subscription != null) unawaited(subscription.cancel());
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
        _pendingLoginEmail = email.trim();
        _pendingLoginPassword = password;
        if (mounted) setState(() => _screen = 'identityCode');
        return null;
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

  Future<InOneFailure?> _confirmIdentityCode(String code) async {
    try {
      final result = await _session.login(
        email: _pendingLoginEmail,
        password: _pendingLoginPassword,
        identityCode: code,
      );
      if (_session.isAuthenticated) return null;
      if (result['status'] == 'identity_check_required') {
        return const InOneFailure(InOneScreenState.error, message: 'Запрошен новый код подтверждения.');
      }
      return const InOneFailure(InOneScreenState.error, message: 'Сервер не выдал активную сессию.');
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _resendIdentityCode() async {
    try {
      final result = await _session.login(email: _pendingLoginEmail, password: _pendingLoginPassword);
      if (_session.isAuthenticated || result['status'] == 'identity_check_required') return null;
      return const InOneFailure(InOneScreenState.error, message: 'Не удалось повторно отправить код.');
    } catch (error) {
      return _toFailure(error);
    }
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
    _recoveryUserId = '';
    _recoveryLinkToken = '';
    try {
      await _session.startRecovery(_recoveryEmail);
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _confirmRecoveryLink() async {
    if (_recoveryUserId.isEmpty || _recoveryLinkToken.isEmpty) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Ссылка восстановления отсутствует. Откройте ссылку из письма ещё раз.',
      );
    }
    try {
      await _session.confirmRecoveryLink(
        userId: _recoveryUserId,
        token: _recoveryLinkToken,
      );
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<InOneFailure?> _completeRecovery(String code, String newPassword, String pin) async {
    try {
      final response = await _session.completeRecovery(
        email: _recoveryEmail.isNotEmpty ? _recoveryEmail : null,
        userId: _recoveryUserId.isNotEmpty ? _recoveryUserId : null,
        code: code,
        newPassword: newPassword,
        pin: pin,
      );
      final keyResetAt = response['keyResetAt'];
      if (keyResetAt is String) {
        _waitingActivateAt = _formatActivationTime(keyResetAt);
      }
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
    final activation = _waitingActivateAt;
    setState(() {
      _recoveryEmail = '';
      _recoveryUserId = '';
      _recoveryLinkToken = '';
      _screen = 'login';
    });
    _notice(
      activation.isEmpty
          ? 'Пароль изменён. Вход с новых устройств откроется через 48 часов.'
          : 'Пароль изменён. Вход с новых устройств будет доступен после $activation.',
    );
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
      _systemStatus = null;
      _registrationEmail = '';
      _registrationToken = '';
      _screen = 'login';
    });
  }

  void _notice(String message) {
    _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openChat(InOneChatPreview chat) async {
    if (!_session.hasNativeMlsSession) {
      _notice('Нативный MLS-клиент не активен. Сообщение не отправлено; открытие чата без шифрования запрещено.');
      return;
    }
    setState(() {
      _selectedChat = chat;
      _threadItems = const [];
      _chatLoading = true;
      _screen = 'chatThread';
    });
    await _refreshChat(chat.id);
  }

  Future<void> _refreshChat(String roomId) async {
    try {
      await _session.syncMlsMessages();
      final pending = await _session.pendingMlsMessages();
      final messages = await _session.mlsMessagesForRoom(roomId);
      if (!mounted) return;
      setState(() {
        _threadItems = messages.map((message) {
          if (message.isAttachment) {
            final size = message.size ?? 0;
            final sizeLabel = size >= 1024 * 1024
                ? '${(size / (1024 * 1024)).toStringAsFixed(1)} МБ'
                : '${(size / 1024).ceil()} КБ';
            return InOneThreadItem(
              kind: InOneThreadItemKind.file,
              fileLabel: '${message.name ?? 'Файл'} · $sizeLabel',
            );
          }
          return InOneThreadItem(
            kind: InOneThreadItemKind.text,
            text: message.text ?? 'Не удалось расшифровать сообщение',
          );
        }).toList(growable: false);
        _chatLoading = false;
      });
      final acceptedIds = pending
          .where((message) => message.roomId == roomId)
          .map((message) => message.eventId)
          .toList(growable: false);
      if (acceptedIds.isNotEmpty) {
        await _session.acknowledgeMlsMessages(acceptedIds);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _chatLoading = false);
      _notice('Не удалось синхронизировать зашифрованную переписку.');
    }
  }

  Future<void> _sendChatMessage(String text) async {
    final chat = _selectedChat;
    if (chat == null || !_session.hasNativeMlsSession) {
      _notice('MLS-сессия недоступна. Сообщение не отправлено.');
      return;
    }
    try {
      await _session.sendMlsText(chat.id, text);
      await _refreshChat(chat.id);
    } catch (_) {
      _notice('Не удалось отправить зашифрованное сообщение. Повторите попытку.');
    }
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
      final config = await _repositories.publicConfig();
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
      case 'identityCode':
        return InOneEmailCodeScreen(
          onConfirm: _confirmIdentityCode,
          onResend: _resendIdentityCode,
          onBack: () => setState(() => _screen = 'login'),
          onDone: _afterLogin,
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
      case 'recoveryStart':
        return InOneRecoveryStartScreen(
          onSubmit: _startRecovery,
          onBack: () => setState(() => _screen = 'login'),
          onEnterCode: () => setState(() => _screen = 'recoveryCode'),
        );
      case 'recoveryConfirm':
        return InOneRecoveryConfirmScreen(
          onConfirm: _confirmRecoveryLink,
          onDone: () => setState(() {
            _recoveryLinkToken = '';
            _screen = 'recoveryCode';
          }),
        );
      case 'recoveryCode':
        return InOneNewPasswordScreen(
          onSubmit: _completeRecovery,
          onDone: _finishRecovery,
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
          onOpenChat: (chat) => unawaited(_openChat(chat)),
          onSearch: () => _notice('Поиск по содержимому сообщений пока не реализован.'),
          onFilter: () => _notice('Дополнительные фильтры пока недоступны.'),
          onTab: _selectTab,
          onAdd: () => _notice('Создание публикаций не входит в Beta 1.0.'),
        );
      case 'chatThread':
        final chat = _selectedChat;
        if (chat == null) {
          return InOneLoadingErrorScreen(onRetry: () => setState(() => _screen = 'messages'));
        }
        return Stack(
          children: [
            InOneChatThreadScreen(
              header: InOneThreadHeader(
                name: chat.name,
                statusLabel: !_session.hasNativeMlsSession
                    ? 'MLS недоступен'
                    : _session.mlsError == null
                        ? 'MLS · зашифровано'
                        : 'MLS · требуется синхронизация',
                online: false,
              ),
              items: _threadItems,
              onSend: (text) => unawaited(_sendChatMessage(text)),
              onBack: () => setState(() => _screen = 'messages'),
              onAttach: () => _notice('Выбор файла пока не подключён. Нативный MLS API шифрования и передачи готов в коде, но ещё не прошёл тесты на устройстве.'),
            ),
            if (_chatLoading)
              const Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: LinearProgressIndicator(minHeight: 2),
              ),
          ],
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
          onForgotPassword: () => setState(() => _screen = 'recoveryStart'),
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
