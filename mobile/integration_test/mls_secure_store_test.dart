import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
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
      final userId = '@mls-smoke-${stamp}:inone.test';
      final deviceId = 'MLS-SMOKE-${stamp}';
      final accessToken = 'smoke-access-${stamp}';
      final refreshToken = 'smoke-refresh-${stamp}';
      const baseUrl = 'http://127.0.0.1:1';

      const storageChannel = MethodChannel('com.inone.mls/platform_storage');
      final supportPath = await storageChannel.invokeMethod<String>(
        'applicationSupportDirectory',
      );
      expect(supportPath, isNotNull);
      final resolvedSupportPath = supportPath!;
      expect(FileSystemEntity.isAbsolute(resolvedSupportPath), isTrue);
      expect(await Directory(resolvedSupportPath).exists(), isTrue);

      final identity = '${userId}/${deviceId}';
      final databaseName = '${sha256.convert(utf8.encode(identity))}.sqlcipher';
      final databaseDirectory = Directory('${resolvedSupportPath}/inone/mls');
      final databasePath = '${databaseDirectory.path}/${databaseName}';
      final backupDirectory = Directory(
        '${resolvedSupportPath}/.mls-keystore-smoke-${stamp}',
      );
      await backupDirectory.create(recursive: true);
      final backedUpSuffixes = <String>[];

      try {
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
        await resumed.close();

        // Preserve only the encrypted database artifacts. After logout we
        // restore this ciphertext to prove the platform key itself is gone.
        for (final suffix in ['', '-wal', '-shm', '-journal']) {
          final source = File('${databasePath}${suffix}');
          if (await source.exists()) {
            await source.copy(
              '${backupDirectory.path}/${databaseName}${suffix}',
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

        // The server is intentionally unreachable. Rust must still remove
        // the SQLCipher database and the Android Keystore key before returning.
        await expectLater(logoutSession.logout(), throwsA(anything));
        for (final suffix in ['', '-wal', '-shm', '-journal']) {
          expect(await File('${databasePath}${suffix}').exists(), isFalse);
        }

        // Restore the old ciphertext without restoring its key. Resume must
        // fail specifically because the protected SQLCipher key was purged.
        for (final suffix in backedUpSuffixes) {
          await File('${backupDirectory.path}/${databaseName}${suffix}').copy(
            '${databasePath}${suffix}',
          );
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
        for (final suffix in ['', '-wal', '-shm', '-journal']) {
          final artifact = File('${databasePath}${suffix}');
          if (await artifact.exists()) {
            await artifact.delete();
          }
        }
      }
    },
  );
}
