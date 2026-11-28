import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:inone_mobile/core/mls/rust_mls_session_bridge.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Firebase Core initializes and Android FCM registers a FID', (_) async {
    if (Firebase.apps.isEmpty) await Firebase.initializeApp();
    final registration = Completer<String>();
    final subscription = FirebaseMessaging.instance.onRegistered.listen((fid) {
      if (!registration.isCompleted) registration.complete(fid);
    });
    try {
      // Android CI grants POST_NOTIFICATIONS through adb before launching
      // the app. Do not open the interactive system permission dialog from
      // flutter drive: the headless emulator cannot answer it and the driver
      // remains blocked until the smoke-test timeout. iOS still exercises the
      // native permission request path.
      final settings = Platform.isAndroid
          ? await FirebaseMessaging.instance.getNotificationSettings()
          : await FirebaseMessaging.instance.requestPermission();
      expect(settings.authorizationStatus, AuthorizationStatus.authorized);
      await FirebaseMessaging.instance.register();
      final fid = await registration.future.timeout(const Duration(seconds: 45));
      expect(fid, matches(RegExp(r'^[A-Za-z0-9_-]{22}$')));
    } finally {
      await subscription.cancel();
    }
  });

  testWidgets(
    'native platform store persists SQLCipher key across close/resume and purges it on logout',
    (_) async {
      final stamp = DateTime.now().microsecondsSinceEpoch;
      final userId = '@mls-smoke-$stamp:inone.test';
      final deviceId = 'MLS-SMOKE-$stamp';
      const baseUrl = 'https://127.0.0.1:1';

      final supportDirectory = await getApplicationSupportDirectory();
      expect(supportDirectory.isAbsolute, isTrue);
      expect(await supportDirectory.exists(), isTrue);

      final identity = '$userId/$deviceId';
      final databaseName = '${sha256.convert(utf8.encode(identity))}.sqlcipher';
      final databasePath =
          '${supportDirectory.path}/inone/mls/$databaseName';
      final backupDirectory = Directory(
        '${supportDirectory.path}/.mls-keystore-smoke-$stamp',
      );
      await backupDirectory.create(recursive: true);
      final backedUpSuffixes = <String>[];
      const suffixes = ['', '-wal', '-shm', '-journal'];

      try {
        final first = RustMlsSessionBridge();
        await first.open(
          baseUrl: baseUrl,
          userId: userId,
          deviceId: deviceId,
          accessToken: 'smoke-access-$stamp',
          refreshToken: 'smoke-refresh-$stamp',
        );
        final initialAccessToken = await first.accessTokenSnapshot();
        expect(initialAccessToken, 'smoke-access-$stamp');
        await first.close();

        final resumed = RustMlsSessionBridge();
        await resumed.resume(
          baseUrl: baseUrl,
          userId: userId,
          deviceId: deviceId,
        );
        expect(await resumed.accessTokenSnapshot(), initialAccessToken);
        await resumed.close();

        // Back up only the encrypted database artifacts. Restoring this
        // ciphertext after logout proves that a missing database alone is
        // not what makes the post-logout resume fail.
        expect(await File(databasePath).exists(), isTrue);
        for (final suffix in suffixes) {
          final source = File('$databasePath$suffix');
          if (await source.exists()) {
            await source.copy(
              '${backupDirectory.path}/$databaseName$suffix',
            );
            backedUpSuffixes.add(suffix);
          }
        }
        expect(backedUpSuffixes, contains(''));

        final logoutSession = RustMlsSessionBridge();
        await logoutSession.resume(
          baseUrl: baseUrl,
          userId: userId,
          deviceId: deviceId,
        );

        // The server is intentionally unreachable. Rust must still delete
        // the encrypted database and Android Keystore key before returning
        // the remote logout error.
        await expectLater(logoutSession.logout(), throwsA(anything));
        for (final suffix in suffixes) {
          expect(await File('$databasePath$suffix').exists(), isFalse);
        }

        // Restore ciphertext without restoring its platform-protected key.
        for (final suffix in backedUpSuffixes) {
          await File(
            '${backupDirectory.path}/$databaseName$suffix',
          ).copy('$databasePath$suffix');
        }

        final afterLogout = RustMlsSessionBridge();
        Object? resumeError;
        try {
          await afterLogout.resume(
            baseUrl: baseUrl,
            userId: userId,
            deviceId: deviceId,
          );
        } catch (error) {
          resumeError = error;
        }
        if (resumeError == null) {
          await afterLogout.close();
        }
        expect(resumeError, isNotNull);
        expect(
          resumeError.toString(),
          contains('ключ SQLCipher сохранённой MLS-сессии отсутствует'),
        );
      } finally {
        await backupDirectory.delete(recursive: true);
        for (final suffix in suffixes) {
          final artifact = File('$databasePath$suffix');
          if (await artifact.exists()) {
            await artifact.delete();
          }
        }
      }
    },
  );
}
