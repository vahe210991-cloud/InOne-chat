import 'package:flutter_test/flutter_test.dart';

import 'package:inone_mobile/core/session/recovery_deep_link.dart';

void main() {
  group('RecoveryDeepLink', () {
    test('parses the InOne recovery scheme and preserves the requested locale', () {
      final result = RecoveryDeepLink.parse(
        'inone://recovery/confirm?user=%40alice%3Ainone.test&token=one-time&locale=ru',
      );

      expect(result, isNotNull);
      expect(result!.userId, '@alice:inone.test');
      expect(result.token, 'one-time');
      expect(result.locale, 'ru');
    });

    test('parses the Flutter path route used by platform route delivery', () {
      final result = RecoveryDeepLink.parse(
        '/recovery/confirm?user=%40alice%3Ainone.test&token=one-time&locale=en',
      );

      expect(result, isNotNull);
      expect(result!.locale, 'en');
    });

    test('rejects wrong schemes, wrong paths, missing values, and duplicate tokens', () {
      expect(RecoveryDeepLink.parse('https://evil.example/recovery/confirm?user=a&token=b'), isNull);
      expect(RecoveryDeepLink.parse('inone://other/confirm?user=a&token=b'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a&token=b&token=c'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a&token=b#fragment'), isNull);
    });

    test('falls back to Armenian for an unsupported locale', () {
      final result = RecoveryDeepLink.parse(
        'inone://recovery/confirm?user=a&token=b&locale=fr',
      );

      expect(result?.locale, 'hy');
    });
  });
}
