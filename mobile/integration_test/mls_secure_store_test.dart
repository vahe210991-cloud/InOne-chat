import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:inone_mobile/core/mls/rust_mls_session_bridge.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'native platform store persists SQLCipher key across close/resume and purges it on logout',
    (_) async {
      final stamp = DateTime.now().microsecondsSinceEpoch;
      final userId = '@mls-smoke-$stamp:inone.test';
      final deviceId = 'MLS-SMOKE-$stamp';
      final accessToken = 'smoke-access-$stamp';
      final refreshToken = 'smoke-refresh-$stamp';
      const baseUrl = 'http://127.0.0.1:1';

      // Exercise the real MainActivity channel and Android application context
      // before Rust is entered; no test platform override or fake directory.
      const storageChannel = MethodChannel('com.inone.mls/platform_storage');
      final supportPath = await storageChannel.invokeMethod<String>(
        'applicationSupportDirectory',
      );
      expect(supportPath, isNotNull);
      final resolvedSupportPath = supportPath!;
      expect(FileSystemEntity.isAbsolute(resolvedSupportPath), isTrue);
      expect(await Directory(resolvedSupportPath).exists(), isTrue);

      final first = RustMlsSessionBridge();
      await first.open(
        baseUrl: baseUrl,
        userId: userId,
        deviceId: deviceId,
        accessToken: accessToken,
        refreshToken: refreshToken,
      );
      final initialAccessToken = await first.accessTokenSnapshot();
      expect(initialAccessToken.isNotEmpty, isTrue);
      await first.close();

      final resumed = RustMlsSessionBridge();
      await resumed.resume(
        baseUrl: baseUrl,
        userId: userId,
        deviceId: deviceId,
      );
      final resumedAccessToken = await resumed.accessTokenSnapshot();
      expect(resumedAccessToken == initialAccessToken, isTrue);

      // The server is intentionally unreachable. Native logout must still
      // purge the SQLCipher database and platform key before returning its error.
      await expectLater(resumed.logout(), throwsA(anything));

      final afterLogout = RustMlsSessionBridge();
      await expectLater(
        afterLogout.resume(
          baseUrl: baseUrl,
          userId: userId,
          deviceId: deviceId,
        ),
        throwsA(anything),
      );
    },
  );
}
