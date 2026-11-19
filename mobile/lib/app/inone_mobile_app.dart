import 'dart:async';
import 'dart:io' show Directory, File, Platform;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../core/data/inone_profile.dart';
import '../core/data/inone_public_config.dart';
import '../core/data/inone_organization.dart';
import '../core/data/inone_encrypted_document_store.dart';
import '../core/data/inone_repositories.dart';
import '../core/mls/rust_mls_session_bridge.dart';
import '../core/network/api_environment.dart';
import '../core/network/api_exception.dart';
import '../core/session/inone_session.dart';
import '../core/session/recovery_deep_link.dart';
import '../ui_dart_source/inone.dart';

const _configuredApiBaseUrl = String.fromEnvironment('INONE_API_BASE_URL');
// Native MLS remains opt-in until the owner accepts the runtime, persistence,
// recovery, and security gates on an exact tested commit.
const _nativeMlsEnabled = bool.fromEnvironment(
  'INONE_MLS_NATIVE_ENABLED',
  defaultValue: false,
);

class InOneMobileApp extends StatefulWidget {
  const InOneMobileApp({super.key});

  @override
  State<InOneMobileApp> createState() => _InOneMobileAppState();
}

class _InOneMobileAppState extends State<InOneMobileApp> with WidgetsBindingObserver {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  late final InOneSession _session;
  late final InOneRepositories _repositories;
  late final InOneEncryptedDocumentStore _documentStore;

  String _screen = 'login';
  String _registrationEmail = '';
  String _recoveryEmail = '';
  String _recoveryUserId = '';
  String _pendingLoginEmail = '';
  String _pendingLoginPassword = '';
  String _waitingActivateAt = '';
  InOneProfile? _profile;
  List<InOneOrganization> _organizations = const [];
  InOneOrganization? _selectedOrganization;
  InOneSystemStatus? _systemStatus;
  InOneOrgRequest? _selectedAdminRequest;
  List<InOneOrgRequest> _adminRequests = const [];
  List<InOneDocument> _adminDocuments = const [];
  bool _darkMode = false;
  bool _initializing = true;
  final Completer<void> _initializationComplete = Completer<void>();
  bool _recoveryLinkInFlight = false;
  final Set<int> _handledRecoveryLinkFingerprints = <int>{};

  @override
  void initState() {
    super.initState();
    final baseUrl = resolveInOneApiBaseUrl(
      configured: _configuredApiBaseUrl,
      isAndroid: Platform.isAndroid,
    );
    _session = InOneSession(
      baseUrl: baseUrl,
      nativeMlsBridge: _nativeMlsEnabled &&
              (Platform.isAndroid || Platform.isIOS)
          ? RustMlsSessionBridge()
          : null,
    );
    _repositories = InOneRepositories(_session);
    _documentStore = InOneEncryptedDocumentStore();
    WidgetsBinding.instance.addObserver(this);
    final initialRoute = WidgetsBinding.instance.platformDispatcher.defaultRouteName;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_handleRecoveryRoute(initialRoute));
    });
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      // A previous native viewer may have been interrupted by process death.
      // Never retain its transient plaintext hand-off cache across app starts.
      try {
        await _clearDocumentPreviewCache();
      } catch (_) {
        // The encrypted document store remains authoritative; cache cleanup retries on logout.
      }
      try {
        await _session.initialize();
      } catch (_) {
        // The first authenticated operation will surface a safe UI error.
      }
      if (!mounted) return;
      setState(() => _initializing = false);
      if (_session.isAuthenticated) await _loadAuthenticatedData();
    } finally {
      if (!_initializationComplete.isCompleted) {
        _initializationComplete.complete();
      }
    }
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
    _recoveryUserId = '';
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
        userId: _recoveryUserId,
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
      _recoveryUserId = '';
      _screen = 'login';
    });
    _notice('Восстановление завершено. Теперь войдите с новым паролем.');
  }

  void _finishRecoveryCancellation() {
    setState(() {
      _recoveryEmail = '';
      _recoveryUserId = '';
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
      final organizationResponse = await _repositories.myOrganizations();
      final organizations = InOneOrganizationList.fromJson(organizationResponse).orgs;
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _organizations = organizations;
        _selectedOrganization = organizations.isEmpty ? null : organizations.first;
        _screen = 'messages';
      });
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) {
        final revokedUserId = _session.userId;
        if (revokedUserId != null) {
          try {
            await _documentStore.purgeAccount(revokedUserId);
          } catch (_) {
            // Continue clearing the session even if filesystem cleanup is interrupted.
          }
          try {
            await _clearDocumentPreviewCache();
          } catch (_) {
            // A later app start retries the temporary-cache cleanup.
          }
          try {
            await _session.logout();
          } catch (_) {
            // A server-revoked session may reject remote logout; local purge is mandatory.
          }
          if (mounted) {
            setState(() {
              _profile = null;
              _adminRequests = const [];
              _adminDocuments = const [];
              _selectedAdminRequest = null;
              _screen = 'login';
            });
            _notice('Сессия отозвана. Локальные документы и ключи удалены. Войдите снова.');
          }
          return;
        }
      }
      if (mounted) setState(() => _screen = 'loadError');
    }
  }

  String _formatAdminRequestDate(Object? value) {
    if (value is! int || value < 0) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    final date = DateTime.fromMillisecondsSinceEpoch(value).toLocal();
    return '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
  }

  InOneOrgRequest _parseAdminRequest(Map<String, dynamic> json) {
    final id = json['requestId'];
    final name = json['name'];
    final status = switch (json['status']) {
      'pending' => InOneRequestStatus.pending,
      'approved' => InOneRequestStatus.approved,
      'rejected' => InOneRequestStatus.rejected,
      _ => null,
    };
    if (id is! String || id.isEmpty || name is! String || name.isEmpty || status == null) {
      throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
    }
    return InOneOrgRequest(
      id: id,
      name: name,
      date: _formatAdminRequestDate(json['createdAt']),
      status: status,
    );
  }

  Future<void> _openAdminRequests() async {
    if (!(_profile?.canViewPlatformRequests ?? false)) {
      _notice('Недостаточно прав для просмотра заявок платформы.');
      return;
    }
    setState(() => _screen = 'adminRequestsLoading');
    try {
      final response = await _repositories.organizationRequests();
      final raw = response['requests'];
      if (raw is! List || raw.any((item) => item is! Map<String, dynamic>)) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      final requests = raw.cast<Map<String, dynamic>>().map(_parseAdminRequest).toList(growable: false);
      if (!mounted) return;
      setState(() {
        _adminRequests = requests;
        _screen = 'adminRequests';
      });
    } catch (error) {
      if (!mounted) return;
      final failure = _toFailure(error);
      setState(() => _screen = 'adminRequestsError');
      _notice(failure.message ?? 'Не удалось загрузить очередь заявок.');
    }
  }

  Future<void> _openAdminRequest(InOneOrgRequest request) async {
    if (!(_profile?.canViewPlatformRequests ?? false)) return;
    setState(() {
      _selectedAdminRequest = request;
      _screen = 'adminRequestLoading';
    });
    try {
      final response = await _repositories.organizationRequest(request.id);
      final rawRequest = response['request'];
      final rawDocuments = response['documents'];
      if (rawRequest is! Map<String, dynamic> || rawDocuments is! List ||
          rawDocuments.any((item) => item is! Map<String, dynamic>)) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      final parsedRequest = _parseAdminRequest(rawRequest);
      final documents = rawDocuments.cast<Map<String, dynamic>>().map((json) {
        final id = json['docId'];
        final kind = json['kind'];
        final size = json['size'];
        final filename = json['filename'];
        final mimeType = json['mimeType'];
        if (id is! String || id.isEmpty || kind is! String || size is! int || size < 0 ||
            filename is! String || filename.isEmpty ||
            mimeType is! String ||
            !const ['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream'].contains(mimeType)) {
          throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
        }
        final label = switch (kind) {
          'registration' => 'Регистрационный документ',
          'authority' => 'Подтверждение полномочий',
          'other' => 'Другой документ',
          _ => throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false),
        };
        return InOneDocument(
          id: id,
          name: filename,
          typeLabel: '$label · ${(size / 1024).ceil()} КБ',
          mimeType: mimeType,
        );
      }).toList(growable: false);
      if (!mounted) return;
      setState(() {
        _selectedAdminRequest = parsedRequest;
        _adminDocuments = documents;
        _screen = 'adminRequestDetails';
      });
    } catch (error) {
      if (!mounted) return;
      final failure = _toFailure(error);
      setState(() => _screen = 'adminRequestsError');
      _notice(failure.message ?? 'Не удалось загрузить заявку.');
    }
  }

  Future<InOneFailure?> _decideAdminRequest(InOneDecision decision) async {
    final request = _selectedAdminRequest;
    if (request == null || !(_profile?.canDecidePlatformRequests ?? false)) {
      return const InOneFailure(InOneScreenState.error, message: 'Решение доступно только владельцу платформы.');
    }
    try {
      final response = await _repositories.decideOrganizationRequest(
        request.id,
        decision: decision == InOneDecision.approve ? 'approve' : 'reject',
      );
      final expected = decision == InOneDecision.approve ? 'approved' : 'rejected';
      if (response['status'] != expected) {
        throw const ApiException(code: 'invalid_response', statusCode: 200, retryable: false);
      }
      return null;
    } catch (error) {
      return _toFailure(error);
    }
  }

  Future<Directory> _documentPreviewDirectory() async {
    final temporary = await getTemporaryDirectory();
    final directory = Directory(
      '${temporary.path}${Platform.pathSeparator}InOne'
      '${Platform.pathSeparator}organization-document-preview',
    );
    await directory.create(recursive: true);
    return directory;
  }

  Future<void> _clearDocumentPreviewCache() async {
    final temporary = await getTemporaryDirectory();
    final directory = Directory(
      '${temporary.path}${Platform.pathSeparator}InOne'
      '${Platform.pathSeparator}organization-document-preview',
    );
    if (await directory.exists()) await directory.delete(recursive: true);
  }

  Future<void> _openNativeDocument(String requestId, InOneDocument document, List<int> bytes) async {
    final directory = await _documentPreviewDirectory();
    final safeName = document.name.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final file = File(
      '${directory.path}${Platform.pathSeparator}${requestId}_'
      '${document.id}_$safeName',
    );
    await file.writeAsBytes(bytes, flush: true);
    final result = await OpenFilex.open(file.path, type: document.mimeType);
    if (result.type != ResultType.done) {
      throw StateError('Native document viewer failed: ${result.message}');
    }
  }

  Future<InOneFailure?> _downloadAdminDocument(InOneDocument document) async {
    final request = _selectedAdminRequest;
    final ownerUserId = _session.userId;
    if (request == null || ownerUserId == null || !(_profile?.canViewPlatformRequests ?? false)) {
      return const InOneFailure(
        InOneScreenState.error,
        message: 'Документ недоступен для этой учётной записи.',
      );
    }
    try {
      final response = await _repositories.downloadOrganizationRequestDocument(
        request.id,
        document.id,
      );
      final responseType = response.headers['content-type']?.split(';').first.trim().toLowerCase();
      if (document.mimeType != null && responseType != document.mimeType) {
        throw const ApiException(code: 'invalid_download_response', statusCode: 502, retryable: false);
      }
      await _documentStore.save(
        ownerUserId: ownerUserId,
        requestId: request.id,
        documentId: document.id,
        filename: document.name,
        bytes: response.bodyBytes,
      );
      // Preview is always rendered from authenticated, decrypted bytes read back
      // from the encrypted store; the network response is never sent to a viewer.
      final plaintext = await _documentStore.read(
        ownerUserId: ownerUserId,
        requestId: request.id,
        documentId: document.id,
        filename: document.name,
      );
      if (document.mimeType == 'image/jpeg' || document.mimeType == 'image/png') {
        if (!mounted) return null;
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => Dialog(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(document.name, style: Theme.of(dialogContext).textTheme.titleMedium),
                ),
                Flexible(
                  child: InteractiveViewer(
                    child: Image.memory(
                      Uint8List.fromList(plaintext),
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const Center(
                        child: Text('Не удалось отобразить изображение.'),
                      ),
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Закрыть'),
                ),
              ],
            ),
          ),
        );
      } else {
        await _openNativeDocument(request.id, document, plaintext);
      }
      if (mounted) _notice('Документ открыт из зашифрованного локального хранилища.');
      return null;
    } catch (error) {
      return _toFailure(error);
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
    final ownerUserId = _session.userId;
    InOneFailure? failure;
    try {
      await _session.logout();
    } catch (error) {
      failure = _toFailure(error);
    }

    // Attempt every local cleanup independently. A failed secure-storage delete
    // must not leave decrypted native-viewer hand-off files behind.
    if (ownerUserId != null) {
      try {
        await _documentStore.purgeAccount(ownerUserId);
      } catch (error) {
        failure ??= _toFailure(error);
      }
    }
    try {
      await _clearDocumentPreviewCache();
    } catch (error) {
      failure ??= _toFailure(error);
    }
    return failure;
  }

  void _finishLogout() {
    setState(() {
      _profile = null;
      _organizations = const [];
      _selectedOrganization = null;
      _systemStatus = null;
      _selectedAdminRequest = null;
      _adminRequests = const [];
      _adminDocuments = const [];
      _registrationEmail = '';
      _screen = 'login';
    });
  }

  void _notice(String message) {
    _messengerKey.currentState?.showSnackBar(SnackBar(content: Text(message)));
  }

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
            _registrationEmail = '';
            // registerAccount authenticates through the normal session flow.
            _afterLogin();
          },
        );
      case 'logout':
        return InOneLogoutScreen(
          onLogout: _logout,
          onCancel: () => setState(() => _screen = 'profile'),
          onDone: _finishLogout,
        );
      case 'adminRequestsLoading':
      case 'adminRequestLoading':
      case 'loading':
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case 'loadError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_loadAuthenticatedData()));
      case 'adminRequestsError':
        return InOneLoadingErrorScreen(onRetry: () => unawaited(_openAdminRequests()));
      case 'adminRequests':
        return InOneRequestsAdminScreen(
          requests: _adminRequests,
          onOpen: (request) => unawaited(_openAdminRequest(request)),
          onMenu: () => setState(() => _screen = 'profile'),
        );
      case 'adminRequestDetails':
        if (_selectedAdminRequest == null) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_openAdminRequests()));
        }
        return InOneRequestAdminDetailsScreen(
          request: _selectedAdminRequest!,
          documents: _adminDocuments,
          isOwner: _profile?.canDecidePlatformRequests ?? false,
          onDownload: _downloadAdminDocument,
          onDecide: () => setState(() => _screen = 'adminRequestDecision'),
          onBack: () => unawaited(_openAdminRequests()),
          onMenu: () => setState(() => _screen = 'profile'),
        );
      case 'adminRequestDecision':
        if (_selectedAdminRequest == null || !(_profile?.canDecidePlatformRequests ?? false)) {
          return InOneLoadingErrorScreen(onRetry: () => unawaited(_openAdminRequests()));
        }
        return InOneRequestDecisionScreen(
          request: _selectedAdminRequest!,
          onDecision: _decideAdminRequest,
          onBack: () => setState(() => _screen = 'adminRequestDetails'),
          onMenu: () => setState(() => _screen = 'profile'),
          onDone: () {
            _notice('Решение по заявке сохранено.');
            unawaited(_openAdminRequests());
          },
        );
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
          chats: const [],
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
            if (_profile?.canViewPlatformRequests == true)
              InOneProfileMenuItem(
                label: 'Заявки платформы',
                icon: Icons.admin_panel_settings_outlined,
                onTap: () => unawaited(_openAdminRequests()),
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
    await _initializationComplete.future;
    if (!mounted) return true;

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
      _recoveryEmail = '';
      _recoveryUserId = payload.userId;
      setState(() => _screen = 'recoveryPassword');
      final message = switch (payload.locale) {
        'ru' => 'Ссылка подтверждена. Введите код восстановления и новый пароль.',
        'en' => 'The link is confirmed. Enter your recovery code and new password.',
        _ => 'Հղումը հաստատված է։ Մուտքագրեք վերականգնման կոդը և նոր գաղտնաբառը։',
      };
      _notice(message);
    } on ApiException catch (error) {
      if (!mounted) return true;
      if (!error.retryable) _handledRecoveryLinkFingerprints.add(fingerprint);
      final message = switch (payload.locale) {
        'ru' => error.code == 'recovery expired'
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
