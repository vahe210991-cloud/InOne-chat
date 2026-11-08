import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'approved_screens.dart';

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
        ),
        home: const ApprovedScreensHost(),
      );
}

class ApprovedScreensHost extends StatefulWidget {
  const ApprovedScreensHost({super.key});
  @override
  State<ApprovedScreensHost> createState() => _ApprovedScreensHostState();
}

class _ApprovedScreensHostState extends State<ApprovedScreensHost> {
  late final WebViewController _controller;
  String _selectedScreenId = 'messages-light';
  bool _loading = true;
  bool _pageReady = false;
  String? _error;

  ApprovedScreen get _selectedScreen =>
      approvedScreens.firstWhere((screen) => screen.id == _selectedScreenId);

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
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
        onPageFinished: (_) => _waitForApprovedScreens(),
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
          if (uri == null || uri.scheme == 'about' || uri.scheme == 'data') {
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
          return;
        }
      } catch (_) {
        // The bundled HTML is still unpacking; retry within the bounded window.
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
    if (!_pageReady) return;
    final label = jsonEncode(_selectedScreen.label);
    await _controller.runJavaScript('''
      (() => {
        const nodes = document.querySelectorAll('[data-screen-label]');
        nodes.forEach((node) => {
          if (!node.dataset.inoneOriginalDisplay) {
            node.dataset.inoneOriginalDisplay = node.style.display || 'flex';
          }
          const selected = node.getAttribute('data-screen-label') === $label;
          node.style.display = selected ? node.dataset.inoneOriginalDisplay : 'none';
        });
      })();
    ''');
  }

  void _selectScreen(String id) {
    setState(() => _selectedScreenId = id);
    _showSelectedScreen();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(_selectedScreen.label,
              maxLines: 1, overflow: TextOverflow.ellipsis),
          actions: [
            PopupMenuButton<String>(
              tooltip: 'Выбрать экран',
              icon: const Icon(Icons.grid_view_rounded),
              onSelected: _selectScreen,
              itemBuilder: (context) => [
                for (final screen in approvedScreens)
                  PopupMenuItem<String>(
                    value: screen.id,
                    child: Row(
                      children: [
                        Icon(
                          screen.theme == 'dark'
                              ? Icons.dark_mode_outlined
                              : Icons.light_mode_outlined,
                          size: 18,
                        ),
                        const SizedBox(width: 10),
                        Flexible(child: Text(screen.label)),
                      ],
                    ),
                  ),
              ],
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
            ],
          ),
        ),
      );
}
