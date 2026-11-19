import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:inone_mobile/core/mls/rust_mls_session_bridge.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'native platform store persists SQLCipher key across close/resume and purges it on logout',
    (_) async {
      final stamp = DateTime.now().microsecondsSinceEpoch;
      final userId = '@mls-smoke-$stamp:inone.test';
      final deviceId = 'MLS-SMOKE-$stamp';
      const baseUrl = 'http://127.0.0.1:1';

      // Exercise the real Android plugin registration and application context
      // before Rust is entered; no test platform override or fake directory.
      final supportDirectory = await getApplicationSupportDirectory();
      expect(FileSystemEntity.isAbsolute(supportDirectory.path), isTrue);
      expect(await supportDirectory.exists(), isTrue);

      final first = RustMlsSessionBridge();
      await first.open(
        baseUrl: baseUrl,
        userId: userId,
        deviceId: deviceId,
        accessToken: 'smoke-access-token',
        refreshToken: 'smoke-refresh-token',
      );
      expect(await first.accessTokenSnapshot(), 'smoke-access-token');
      await first.close();

      final resumed = RustMlsSessionBridge();
      await resumed.resume(
        baseUrl: baseUrl,
        userId: userId,
        deviceId: deviceId,
      );
      expect(await resumed.accessTokenSnapshot(), 'smoke-access-token');

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
