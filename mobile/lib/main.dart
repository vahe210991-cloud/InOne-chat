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
    theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFFC9F53F)),
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
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFFAF9F5))
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() { _loading = true; _error = null; });
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: (error) {
          if (mounted) setState(() {
            _loading = false;
            _error = error.description;
          });
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

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(child: Stack(children: [
      WebViewWidget(controller: _controller),
      if (_loading) const Align(
        alignment: Alignment.topCenter,
        child: LinearProgressIndicator(minHeight: 2),
      ),
      if (_error != null) Positioned(
        left: 16, right: 16, bottom: 16,
        child: Material(
          color: Theme.of(context).colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Text('Не удалось загрузить экран: $_error'),
          ),
        ),
      ),
    ])),
  );
}
