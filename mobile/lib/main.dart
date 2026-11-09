import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'approved_screens.dart';
import 'claude_ui_bridge.dart';
import 'core/data/inone_repositories.dart';
import 'core/data/inone_profile.dart';
import 'core/data/profile_load_status.dart';
import 'core/data/profile_ui_bridge.dart';
import 'core/network/api_environment.dart';
import 'core/session/inone_session.dart';
import 'core/test_api/screen_api_catalog.dart';
import 'test_screens.dart';
import 'test_gallery_loader.dart';

const _configuredApiBaseUrl = String.fromEnvironment('INONE_API_BASE_URL');

void main() => runApp(const InOneApp());

class InOneApp extends StatelessWidget {
  const InOneApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'InOne',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorSchemeSeed: const Color(0xFFC9F53F),
          scaffoldBackgroundColor: const Color(0xFFF6F7F4),
        ),
        home: const ApprovedScreensHost(),
      );
}

class ScreenChoice {
  const ScreenChoice({required this.keyValue, required this.title, required this.subtitle});
  final String keyValue;
  final String title;
  final String subtitle;
}

class ApprovedScreensHost extends StatefulWidget {
  const ApprovedScreensHost({super.key});
  @override
  State<ApprovedScreensHost> createState() => _ApprovedScreensHostState();
}

class _ApprovedScreensHostState extends State<ApprovedScreensHost> {
  late final WebViewController _controller;
  late final InOneSession _session;
  late final InOneRepositories _repositories;
  String _selectedKey = 'approved:messages-light';
  bool _loading = true;
  bool _pageReady = false;
  String? _error;
  String _currentSource = 'approved';
  String? _testGalleryHtml;
  ProfileLoadStatus? _profileLoadStatus;
  int _profileRequestId = 0;
  bool _lastProfileAuthentication = false;

  bool get _isApproved => _selectedKey.startsWith('approved:');
  bool get _isPersonalProfile =>
      _isApproved && _selectedId.startsWith('personal-profile-');
  String get _selectedId => _selectedKey.split(':').last;

  ApprovedScreen? get _selectedApprovedScreen {
    if (!_isApproved) return null;
    return approvedScreens.firstWhere((screen) => screen.id == _selectedId);
  }

  TestScreen? get _selectedTestScreen {
    if (_isApproved) return null;
    return testScreens.firstWhere((screen) => screen.id == _selectedId);
  }

  String get _selectedTitle {
    final approved = _selectedApprovedScreen;
    if (approved != null) return approved.label;
    final test = _selectedTestScreen!;
    return '${test.id} · ${test.title}';
  }

  List<ScreenChoice> get _screenChoices => [
        for (final screen in approvedScreens)
          ScreenChoice(
            keyValue: 'approved:${screen.id}',
            title: screen.label,
            subtitle: screen.isBeta2 ? 'Beta 2.0 · заглушка · ${screen.theme}' : 'Beta 1.0 · ${screen.theme}',
          ),
        for (final screen in testScreens)
          ScreenChoice(
            keyValue: 'test:${screen.id}',
            title: '${screen.id} · ${screen.title}',
            subtitle: '${screen.category} · ${_stageLabel(screen.stage)} · ${screen.status} · ${screenApiProbes.containsKey(screen.id) ? 'API: GET маршрут задан' : 'API не готов'}',
          ),
      ];

  @override
  void initState() {
    super.initState();
    final apiBaseUrl = resolveInOneApiBaseUrl(
      configured: _configuredApiBaseUrl,
      isAndroid: Platform.isAndroid,
    );
    _session = InOneSession(baseUrl: apiBaseUrl);
    _repositories = InOneRepositories(_session);
    _session.addListener(_onSessionChanged);
    unawaited(_session.initialize().catchError((Object _) {}));

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'InOneBridge',
        onMessageReceived: (message) =>
            unawaited(_handleClaudeBridgeMessage(message.message)),
      )
      ..setBackgroundColor(const Color(0xFFFAF9F5))
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) {
            setState(() {
              _loading = true;
              _pageReady = false;
              _error = null;
            });
          }
        },
        onPageFinished: (_) => _waitForCurrentScreens(),
        onWebResourceError: (error) {
          if (mounted) {
            setState(() {
              _loading = false;
              _error = error.description;
            });
          }
        },
        onNavigationRequest: (request) {
          final uri = Uri.tryParse(request.url);
          if (uri == null) return NavigationDecision.prevent;
          if (request.isMainFrame) {
            if (uri.scheme == 'file' &&
                ProfileUiBridge.isApprovedAssetUrl(request.url)) {
              return NavigationDecision.navigate;
            }
            if (uri.scheme == 'https' && uri.host == 'inone.local') {
              return NavigationDecision.navigate;
            }
            return NavigationDecision.prevent;
          }
          if (uri.scheme == 'about' || uri.scheme == 'data') {
            return NavigationDecision.navigate;
          }
          if (uri.scheme == 'https' &&
              (uri.host == 'unpkg.com' ||
                  uri.host == 'fonts.googleapis.com' ||
                  uri.host == 'fonts.gstatic.com')) {
            return NavigationDecision.navigate;
          }
          return NavigationDecision.prevent;
        },
      ))
      ..loadFlutterAsset(approvedScreensAssetPath);
  }

  Future<void> _waitForApprovedScreens() async {
    for (var attempt = 0; attempt < 40; attempt++) {
      if (!mounted) return;
      try {
        final count = await _controller.runJavaScriptReturningResult(
          "document.querySelectorAll('[data-screen-label]').length",
        );
        if (count.toString().replaceAll('"', '') == '22') {
          if (!mounted) return;
          setState(() {
            _pageReady = true;
            _loading = false;
          });
          await _showSelectedScreen();
          if (_isPersonalProfile) unawaited(_loadProfile());
          return;
        }
      } catch (_) {
        // Retry while the bundled design document is mounting its screen nodes.
      }
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    if (mounted) {
      setState(() {
        _loading = false;
        _error = 'Не удалось подготовить 22 утверждённых экрана';
      });
    }
  }

  Future<void> _showSelectedScreen() async {
    final selected = _selectedApprovedScreen;
    if (!_pageReady || selected == null) return;
    final label = jsonEncode(selected.label);
    await _controller.runJavaScript('''
      (() => {
        const nodes = document.querySelectorAll('[data-screen-label]');
        nodes.forEach((node) => {
          if (!node.dataset.inoneOriginalDisplay) {
            node.dataset.inoneOriginalDisplay = node.style.display || 'flex';
          }
          const visible = node.getAttribute('data-screen-label') === $label;
          node.style.display = visible ? node.dataset.inoneOriginalDisplay : 'none';
        });
      })();
    ''');
  }

  Future<void> _waitForCurrentScreens() async {
    if (_currentSource == 'approved') {
      await _waitForApprovedScreens();
    } else {
      await _waitForTestScreens();
    }
  }

  Future<void> _waitForTestScreens() async {
    for (var attempt = 0; attempt < 40; attempt++) {
      if (!mounted) return;
      try {
        final count = await _controller.runJavaScriptReturningResult(
          "document.querySelectorAll('.screen-card[data-title]').length",
        );
        if (count.toString().replaceAll('"', '') == '73') {
          if (!mounted) return;
          setState(() {
            _pageReady = true;
            _loading = false;
          });
          await _showSelectedTestScreen();
          return;
        }
      } catch (_) {
        // Retry while the bundled gallery document mounts its cards.
      }
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    if (mounted) {
      setState(() {
        _loading = false;
        _error = 'Не удалось подготовить 73 тестовых экрана';
      });
    }
  }

  Future<void> _loadTestGallery() async {
    setState(() {
      _loading = true;
      _pageReady = false;
      _error = null;
    });
    try {
      _testGalleryHtml ??= await loadTestGalleryHtml();
      if (!mounted) return;
      _currentSource = 'test';
      await _controller.loadHtmlString(
        _testGalleryHtml!,
        baseUrl: 'https://inone.local/',
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.toString();
        });
      }
    }
  }

  Future<void> _showSelectedTestScreen() async {
    final selected = _selectedTestScreen;
    if (!_pageReady || selected == null || _currentSource != 'test') return;
    final id = jsonEncode(selected.id);
    await _controller.runJavaScript('''
      (() => {
        const cards = Array.from(document.querySelectorAll('.screen-card[data-title]'));
        const selected = cards.find((card) =>
          (card.getAttribute('data-title') || '').includes($id));
        if (!selected) return;
        cards.forEach((card) => { card.style.display = card === selected ? '' : 'none'; });
        document.querySelectorAll('.category-section').forEach((section) => {
          section.style.display = section.contains(selected) ? 'block' : 'none';
        });
        document.querySelectorAll('.screen-grid').forEach((grid) => {
          grid.style.display = grid.contains(selected) ? 'grid' : 'none';
        });
        document.querySelectorAll('.topbar,.hero,.toolbar,.footer,.section-heading,.empty-filter')
          .forEach((node) => { node.style.display = 'none'; });
        selected.style.maxWidth = '440px';
        selected.style.margin = '0 auto';
        document.body.style.backgroundColor = '#F6F7F4';
      })();
    ''');
  }

  void _onSessionChanged() {
    final authenticated = _session.isAuthenticated;
    if (authenticated == _lastProfileAuthentication) return;
    _lastProfileAuthentication = authenticated;
    if (!mounted || !_isPersonalProfile) return;

    if (authenticated) {
      unawaited(_loadProfile());
      return;
    }

    ++_profileRequestId;
    setState(() {
      _profileLoadStatus = ProfileLoadStatus.unauthenticated;
    });
    unawaited(_clearProfileUi(_selectedId));
  }

  Future<void> _loadProfile() async {
    final requestId = ++_profileRequestId;
    if (!mounted || !_isPersonalProfile || !_pageReady) return;

    final authenticated = _session.isAuthenticated;
    setState(() {
      _profileLoadStatus = authenticated
          ? ProfileLoadStatus.loading
          : ProfileLoadStatus.unauthenticated;
    });
    try {
      final cleared = await _applyProfileToUi(
        screenId: _selectedId,
        profile: null,
      );
      if (requestId != _profileRequestId || !mounted) return;
      if (!cleared) {
        setState(() => _profileLoadStatus = ProfileLoadStatus.error);
        return;
      }
      if (!authenticated) return;

      final profile = await _repositories.profile();
      if (requestId != _profileRequestId || !mounted) return;
      final applied = await _applyProfileToUi(
        screenId: _selectedId,
        profile: profile,
      );
      if (requestId != _profileRequestId || !mounted) return;
      setState(() {
        _profileLoadStatus = !applied
            ? ProfileLoadStatus.error
            : profile.isEmpty
                ? ProfileLoadStatus.empty
                : null;
      });
    } catch (_) {
      if (requestId != _profileRequestId || !mounted) return;
      setState(() {
        _profileLoadStatus = ProfileLoadStatus.error;
      });
    }
  }

  Future<bool> _applyProfileToUi({
    required String screenId,
    required InOneProfile? profile,
  }) async {
    if (_currentSource != 'approved' || !_pageReady) return false;
    final screen = approvedScreens.where((item) => item.id == screenId);
    if (screen.isEmpty || !screenId.startsWith('personal-profile-')) {
      return false;
    }
    final currentUrl = await _controller.currentUrl();
    if (!ProfileUiBridge.isApprovedAssetUrl(currentUrl)) return false;
    final result = await _controller.runJavaScriptReturningResult(
      ProfileUiBridge.updateScript(
        screenLabel: screen.first.label,
        profile: profile,
      ),
    );
    return result == true || result.toString() == 'true';
  }

  Future<void> _clearProfileUi(String screenId) async {
    var cleared = false;
    try {
      cleared = await _applyProfileToUi(screenId: screenId, profile: null);
    } catch (_) {
      cleared = false;
    }
    if (!cleared && mounted && _isPersonalProfile && _selectedId == screenId) {
      setState(() => _profileLoadStatus = ProfileLoadStatus.error);
    }
  }

  void _selectScreen(String key) {
    final previousProfileId = _isPersonalProfile ? _selectedId : null;
    ++_profileRequestId;
    setState(() {
      _selectedKey = key;
      _profileLoadStatus = null;
    });
    if (previousProfileId != null && previousProfileId != key.split(':').last) {
      unawaited(_clearProfileUi(previousProfileId));
    }
    if (key.startsWith('approved:')) {
      if (_currentSource != 'approved') {
        _currentSource = 'approved';
        unawaited(_controller.loadFlutterAsset(approvedScreensAssetPath));
      } else if (_pageReady) {
        unawaited(_showSelectedScreen());
        if (_isPersonalProfile) unawaited(_loadProfile());
      }
    } else {
      if (_currentSource != 'test') {
        unawaited(_loadTestGallery());
      } else if (_pageReady) {
        unawaited(_showSelectedTestScreen());
      }
    }
  }

  Future<void> _openScreenPicker() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ScreenPickerSheet(choices: _screenChoices, selectedKey: _selectedKey),
    );
    if (selected != null) _selectScreen(selected);
  }

  Future<void> _openApiPanel() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ApiTestPanel(
        session: _session,
        screenId: _selectedId,
        screenTitle: _selectedTitle,
        screenStatus: _selectedTestScreen?.status,
      ),
    );
  }

  Future<void> _handleClaudeBridgeMessage(String raw) async {
    final message = ClaudeBridgeMessage.tryParse(raw);
    if (message == null || !mounted) return;

    if (message.type == ClaudeBridgeEventType.navigate) {
      final target = message.targetScreen;
      if (target == 'back') return;
      if (target != null && testScreens.any((screen) => screen.id == target)) {
        _selectScreen('test:$target');
      }
      return;
    }

    if (message.type == ClaudeBridgeEventType.pick) {
      // File picking is wired separately when the native document picker is added.
      await _setClaudeScreenState('unavailable', 'Выбор файла пока не подключён');
      return;
    }

    final call = message.call;
    final route = call == null ? null : claudeSupportedApiCalls[call];
    if (route == null) {
      await _setClaudeScreenState('unavailable', 'Этот API-маршрут пока не подключён');
      return;
    }

    try {
      await _setClaudeScreenState('loading');
      if (call == 'POST /login') {
        await _session.login(
          email: (message.body['email'] ?? '').toString(),
          password: (message.body['password'] ?? '').toString(),
        );
      } else if (call == 'POST /register/email') {
        await _session.startEmailRegistration(
          (message.body['email'] ?? '').toString(),
        );
      } else if (call == 'POST /register/email/confirm') {
        await _session.confirmEmailRegistration(
          email: (message.body['email'] ?? '').toString(),
          code: (message.body['code'] ?? '').toString(),
        );
      } else if (call == 'POST /register') {
        await _session.registerAccount(
          email: (message.body['email'] ?? '').toString(),
          registrationToken: (message.body['registrationToken'] ?? '').toString(),
          password: (message.body['password'] ?? '').toString(),
          nickname: (message.body['nickname'] ?? '').toString(),
          phone: message.body['phone']?.toString(),
        );
      } else if (call == 'POST /logout') {
        await _session.logout();
      } else {
        await _session.request(
          route.method,
          route.path,
          authenticated: route.authenticated,
          body: message.body.isEmpty ? null : message.body,
        );
      }
      await _setClaudeScreenState('default');
    } catch (_) {
      // Never forward raw exceptions or request bodies to WebView/UI logs.
      await _setClaudeScreenState('error', 'Не удалось выполнить запрос. Проверьте данные и соединение.');
    }
  }

  Future<void> _setClaudeScreenState(String state, [String? message]) async {
    if (!mounted || !_pageReady) return;
    final encodedState = jsonEncode(state);
    final encodedMessage = jsonEncode(message);
    try {
      await _controller.runJavaScript(
        'if (window.InOne) window.InOne.setState($encodedState, $encodedMessage);',
      );
    } catch (_) {
      // The screen may have been replaced while the API call was in flight.
    }
  }

  @override
  void dispose() {
    _session.removeListener(_onSessionChanged);
    _session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(_selectedTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
          actions: [
            if (_isPersonalProfile)
              IconButton(
                tooltip: 'Refresh profile',
                onPressed: _profileLoadStatus == ProfileLoadStatus.loading
                    ? null
                    : _loadProfile,
                icon: const Icon(Icons.refresh_rounded),
              ),
            IconButton(
              tooltip: 'Проверка API',
              onPressed: _openApiPanel,
              icon: const Icon(Icons.api_rounded),
            ),
            IconButton(
              tooltip: 'Все экраны',
              onPressed: _openScreenPicker,
              icon: const Icon(Icons.grid_view_rounded),
            ),
          ],
        ),
        body: SafeArea(
          child: Stack(
            children: [
              WebViewWidget(controller: _controller),
              if (_loading || !_pageReady)
                const Align(
                  alignment: Alignment.topCenter,
                  child: LinearProgressIndicator(minHeight: 2),
                ),
              if (_error != null)
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 16,
                  child: Material(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text('Не удалось загрузить экран: $_error'),
                    ),
                  ),
                ),
              if (_isPersonalProfile && _profileLoadStatus != null)
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 16,
                  child: ProfileLoadStatusBanner(
                    status: _profileLoadStatus!,
                  ),
                ),
            ],
          ),
        ),
      );
}

String _stageLabel(ScreenStage stage) => switch (stage) {
      ScreenStage.core => 'Beta 1.0 · тестовый экран',
      ScreenStage.deferred => 'Отложен · заглушка',
      // Future concepts are deliberately retained in the dev gallery, not removed.
      ScreenStage.future => 'Beta 2.0+ · заглушка',
    };

class ScreenPickerSheet extends StatefulWidget {
  const ScreenPickerSheet({required this.choices, required this.selectedKey, super.key});
  final List<ScreenChoice> choices;
  final String selectedKey;

  @override
  State<ScreenPickerSheet> createState() => _ScreenPickerSheetState();
}

class _ScreenPickerSheetState extends State<ScreenPickerSheet> {
  final _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final filtered = widget.choices.where((choice) {
      return q.isEmpty ||
          choice.title.toLowerCase().contains(q) ||
          choice.subtitle.toLowerCase().contains(q) ||
          choice.keyValue.toLowerCase().contains(q);
    }).toList();

    return SafeArea(
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.88,
        minChildSize: 0.5,
        maxChildSize: 0.96,
        builder: (context, scrollController) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Каталог экранов', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 4),
                  Text('22 утверждённых варианта · 73 тестовых экрана · ${screenApiProbes.length} API-привязок',
                      style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _search,
                    onChanged: (value) => setState(() => _query = value),
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      hintText: 'Поиск по ID, названию или разделу',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.separated(
                controller: scrollController,
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final choice = filtered[index];
                  final selected = choice.keyValue == widget.selectedKey;
                  return ListTile(
                    selected: selected,
                    title: Text(choice.title),
                    subtitle: Text(choice.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
                    trailing: selected ? const Icon(Icons.check_circle) : null,
                    onTap: () => Navigator.of(context).pop(choice.keyValue),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ApiTestPanel extends StatefulWidget {
  const ApiTestPanel({
    required this.session,
    required this.screenId,
    required this.screenTitle,
    required this.screenStatus,
    super.key,
  });

  final InOneSession? session;
  final String screenId;
  final String screenTitle;
  final String? screenStatus;

  @override
  State<ApiTestPanel> createState() => _ApiTestPanelState();
}

class _ApiTestPanelState extends State<ApiTestPanel> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _entityId = TextEditingController();
  final _query = TextEditingController();
  bool _busy = false;
  String? _output;

  List<ScreenApiProbe> get _probes =>
      screenApiProbes[widget.screenId] ?? const <ScreenApiProbe>[];

  bool get _needsId => _probes.any((probe) => probe.needsId);
  bool get _needsQuery => _probes.any((probe) => probe.needsQuery);

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _entityId.dispose();
    _query.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    final session = widget.session;
    if (session == null) return;
    setState(() {
      _busy = true;
      _output = null;
    });
    try {
      final result = await session.login(email: _email.text, password: _password.text);
      _password.clear();
      _showResult(result);
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runProbe(ScreenApiProbe probe) async {
    final session = widget.session;
    if (session == null) return;
    if (probe.needsId && _entityId.text.trim().isEmpty) {
      _showError('Укажите ID объекта для этого запроса.');
      return;
    }
    if (probe.needsQuery && _query.text.trim().isEmpty) {
      _showError('Укажите поисковое значение.');
      return;
    }
    var path = probe.path;
    if (probe.needsId) {
      final id = Uri.encodeComponent(_entityId.text.trim());
      path = path.replaceAll(':id', id).replaceAll(':eventId', id);
    }
    if (probe.needsQuery) {
      path = path.replaceAll(':query', Uri.encodeQueryComponent(_query.text.trim()));
    }
    setState(() {
      _busy = true;
      _output = null;
    });
    try {
      final result = await InOneRepositories(session).get(path, authenticated: probe.authenticated);
      _showResult(result);
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _logout() async {
    final session = widget.session;
    if (session == null) return;
    setState(() => _busy = true);
    try {
      await session.logout();
      _showResult({'ok': true, 'message': 'Сессия завершена'});
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showResult(Object? value) {
    if (!mounted) return;
    setState(() => _output = const JsonEncoder.withIndent('  ').convert(value));
  }

  void _showError(Object error) {
    if (!mounted) return;
    setState(() => _output = error.toString());
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 18,
          right: 18,
          top: 18,
          bottom: MediaQuery.of(context).viewInsets.bottom + 18,
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('API / Backend test', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(widget.screenTitle, style: Theme.of(context).textTheme.bodyMedium),
              if (widget.screenStatus != null) ...[
                const SizedBox(height: 4),
                Text(widget.screenStatus!, style: Theme.of(context).textTheme.bodySmall),
              ],
              const SizedBox(height: 12),
              Text('Адрес сервера', style: Theme.of(context).textTheme.titleSmall),
              SelectableText(session?.baseUrl ?? 'Не задан'),
              const SizedBox(height: 6),
              const Text('Локальный тестовый backend: Android-эмулятор использует 10.0.2.2:8080, iOS Simulator — 127.0.0.1:8080. Для физического устройства задайте локальный IP компьютера через INONE_API_BASE_URL.'),
              if (session == null) ...[
                const SizedBox(height: 8),
                const Text('Сервер ещё не настроен. Запустите приложение с параметром --dart-define=INONE_API_BASE_URL=https://адрес-вашего-api.'),
              ] else ...[
                const SizedBox(height: 14),
                AnimatedBuilder(
                  animation: session,
                  builder: (context, _) => session.isAuthenticated
                      ? Row(
                          children: [
                            const Icon(Icons.verified_user, color: Colors.green),
                            const SizedBox(width: 8),
                            const Expanded(child: Text('Авторизованная сессия активна')),
                            TextButton(onPressed: _busy ? null : _logout, child: const Text('Выйти')),
                          ],
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Вход для тестирования', style: Theme.of(context).textTheme.titleSmall),
                            const SizedBox(height: 8),
                            TextField(
                              controller: _email,
                              keyboardType: TextInputType.emailAddress,
                              decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: _password,
                              obscureText: true,
                              decoration: const InputDecoration(labelText: 'Пароль', border: OutlineInputBorder()),
                            ),
                            const SizedBox(height: 8),
                            FilledButton(
                              onPressed: _busy ? null : _login,
                              child: const Text('Войти в тестовый backend'),
                            ),
                          ],
                        ),
                ),
              ],
              const Divider(height: 28),
              Text('Безопасные GET-проверки', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              if (_needsId)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: TextField(
                    controller: _entityId,
                    decoration: const InputDecoration(labelText: 'ID группы / организации / заявки / файла', border: OutlineInputBorder()),
                  ),
                ),
              if (_needsQuery)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: TextField(
                    controller: _query,
                    decoration: const InputDecoration(labelText: 'Поисковое значение', border: OutlineInputBorder()),
                  ),
                ),
              if (_probes.isEmpty)
                const Text('Для этого экрана нет безопасного GET-запроса. Записывающие операции не отправляются без отдельной формы и подтверждения.')
              else
                for (final probe in _probes)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(probe.label),
                    subtitle: Text('GET ${probe.path}'),
                    trailing: IconButton(
                      tooltip: 'Выполнить запрос',
                      icon: const Icon(Icons.play_circle_outline),
                      onPressed: _busy || (probe.authenticated && !(session?.isAuthenticated ?? false))
                          ? null
                          : () => _runProbe(probe),
                    ),
                  ),
              if (_busy) const LinearProgressIndicator(),
              if (_output != null) ...[
                const Divider(height: 28),
                Text('Ответ сервера', style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: SelectableText(_output!, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                ),
              ],
              const SizedBox(height: 12),
              const Text('Тестовый runner выполняет только GET-запросы. POST/PUT/DELETE подключаются через отдельные формы, чтобы исключить случайное изменение данных.'),
            ],
          ),
        ),
      ),
    );
  }
}
