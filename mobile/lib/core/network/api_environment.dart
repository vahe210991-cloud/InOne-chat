import 'package:flutter/foundation.dart';

/// Resolves the API origin for local-only development and test runs.
String resolveInOneApiBaseUrl({
  required String configured,
  required bool isAndroid,
}) {
  final override = configured.trim();
  if (override.isNotEmpty) return override.replaceFirst(RegExp(r'/+ reaches the host machine through 10.0.2.2.
  // iOS simulator and desktop builds can use the host loopback interface.
  return isAndroid ? 'http://10.0.2.2:8080' : 'http://127.0.0.1:8080';
}
), '');
  if (!kDebugMode) return '';

  // Android emulator reaches the host machine through 10.0.2.2.
  // iOS simulator and desktop builds can use the host loopback interface.
  return isAndroid ? 'http://10.0.2.2:8080' : 'http://127.0.0.1:8080';
}
