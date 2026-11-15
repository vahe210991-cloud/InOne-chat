import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/auth/recovery_deep_link.dart';

void main() {
  group('parseRecoveryDeepLink', () {
    test('accepts the Beta custom recovery scheme', () {
      final link = parseRecoveryDeepLink(
        Uri.parse('inone://recovery/confirm?user=%40alice%3Ainone.test&token=abc_DEF-123'),
      );

      expect(link?.userId, '@alice:inone.test');
      expect(link?.token, 'abc_DEF-123');
    });

    test('accepts HTTPS only for the explicitly configured host', () {
      final uri = Uri.parse(
        'https://recovery.inone.example/recovery/confirm?user=alice&token=token123',
      );

      expect(parseRecoveryDeepLink(uri), isNull);
      final link = parseRecoveryDeepLink(
        uri,
        verifiedHttpsHost: 'RECOVERY.INONE.EXAMPLE',
      );
      expect(link?.userId, 'alice');
      expect(link?.token, 'token123');
    });

    test('rejects unrelated schemes, hosts and paths', () {
      expect(
        parseRecoveryDeepLink(Uri.parse('https://evil.example/recovery/confirm?user=a&token=t')),
        isNull,
      );
      expect(
        parseRecoveryDeepLink(Uri.parse('inone://other/confirm?user=a&token=t')),
        isNull,
      );
      expect(
        parseRecoveryDeepLink(Uri.parse('inone://recovery/start?user=a&token=t')),
        isNull,
      );
    });

    test('rejects missing or oversized credentials and control characters', () {
      expect(parseRecoveryDeepLink(Uri.parse('inone://recovery/confirm?user=a')), isNull);
      expect(
        parseRecoveryDeepLink(Uri.parse('inone://recovery/confirm?user=a&token=%0A')),
        isNull,
      );
      expect(
        parseRecoveryDeepLink(
          Uri(
            scheme: 'inone',
            host: 'recovery',
            path: '/confirm',
            queryParameters: {
              'user': List.filled(257, 'a').join(),
              'token': 't',
            },
          ),
        ),
        isNull,
      );
    });
  });
}
