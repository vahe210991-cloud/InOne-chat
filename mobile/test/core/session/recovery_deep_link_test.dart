import 'package:flutter_test/flutter_test.dart';

import 'package:inone_mobile/core/session/recovery_deep_link.dart';

void main() {
  group('RecoveryDeepLink', () {
    test('parses the InOne recovery scheme and preserves locale', () {
      final result = RecoveryDeepLink.parse(
        'inone://recovery/confirm?user=%40alice%3Ainone.test&token=Abc_123-x&locale=ru',
      );

      expect(result, isNotNull);
      expect(result!.userId, '@alice:inone.test');
      expect(result.token, 'Abc_123-x');
      expect(result.locale, 'ru');
    });

    test('parses the Flutter platform route', () {
      final result = RecoveryDeepLink.parse(
        '/recovery/confirm?user=%40alice%3Ainone.test&token=Abc_123-x&locale=en',
      );

      expect(result, isNotNull);
      expect(result!.locale, 'en');
    });

    test('rejects wrong schemes, paths, missing values and duplicate security parameters', () {
      expect(RecoveryDeepLink.parse('https://evil.example/recovery/confirm?user=a&token=abc'), isNull);
      expect(RecoveryDeepLink.parse('inone://other/confirm?user=a&token=abc'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a&user=b&token=abc'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a&token=abc&token=def'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a&token=abc&locale=hy&locale=ru'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a&token=abc#fragment'), isNull);
    });

    test('rejects control characters, malformed tokens and oversized routes', () {
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a%0Aadmin&token=abc'), isNull);
      expect(RecoveryDeepLink.parse('inone://recovery/confirm?user=a&token=abc%20def'), isNull);
      expect(RecoveryDeepLink.parse('x' * 2049), isNull);
    });

    test('falls back to Armenian for an unsupported locale', () {
      final result = RecoveryDeepLink.parse(
        'inone://recovery/confirm?user=a&token=abc&locale=fr',
      );

      expect(result?.locale, 'hy');
    });
  });
}
