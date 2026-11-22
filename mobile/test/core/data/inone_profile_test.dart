import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_profile.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  test('parses the complete backend account summary response', () {
    final profile = InOneProfile.fromJson({
      'userId': 'user-1',
      'nickname': 'Test User',
      'email': 'user@example.test',
      'verificationLevel': 2,
      'providers': ['google'],
      'backupEmail': {'email': 'backup@example.test', 'verified': true},
      'securityHints': ['offer_biometric'],
      'locale': 'ru',
      'platformRole': 'owner',
    });

    expect(profile.userId, 'user-1');
    expect(profile.nickname, 'Test User');
    expect(profile.email, 'user@example.test');
    expect(profile.verificationLevel, 2);
    expect(profile.providers, ['google']);
    expect(profile.backupEmail?.email, 'backup@example.test');
    expect(profile.backupEmail?.verified, isTrue);
    expect(profile.securityHints, ['offer_biometric']);
    expect(profile.locale, 'ru');
    expect(profile.platformRole, 'owner');
    expect(profile.canViewPlatformRequests, isTrue);
    expect(profile.canDecidePlatformRequests, isTrue);
    expect(profile.isEmpty, isFalse);
  });

  test('accepts nullable account fields returned by the backend', () {
    final profile = InOneProfile.fromJson({
      'userId': 'user-2',
      'nickname': null,
      'email': null,
      'verificationLevel': 0,
      'providers': [],
      'backupEmail': null,
      'securityHints': ['no_backup_email'],
    });

    expect(profile.isEmpty, isTrue);
    expect(profile.nickname, isNull);
    expect(profile.email, isNull);
    expect(profile.backupEmail, isNull);
    expect(profile.locale, 'hy');
    expect(profile.platformRole, isNull);
    expect(profile.canViewPlatformRequests, isFalse);
    expect(profile.canDecidePlatformRequests, isFalse);
  });

  test('rejects invalid backend profile shapes', () {
    expect(
      () => InOneProfile.fromJson({
        'userId': 'user-1',
        'nickname': 'Test User',
        'email': null,
        'verificationLevel': 3,
        'providers': [],
        'backupEmail': null,
        'securityHints': [],
      }),
      throwsA(
        isA<ApiException>().having(
          (error) => error.code,
          'code',
          'invalid_response',
        ),
      ),
    );
  });


  test('rejects unsupported persisted account locales', () {
    expect(
      () => InOneProfile.fromJson({
        'userId': 'user-1',
        'nickname': null,
        'email': null,
        'verificationLevel': 0,
        'providers': [],
        'backupEmail': null,
        'securityHints': [],
        'locale': 'de',
      }),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
  });

  test('rejects profile responses missing a backend field', () {
    expect(
      () => InOneProfile.fromJson({
        'userId': 'user-1',
        'nickname': null,
        'email': null,
        'verificationLevel': 0,
        'providers': [],
        'backupEmail': null,
      }),
      throwsA(isA<ApiException>().having(
        (error) => error.code,
        'code',
        'invalid_response',
      )),
    );
  });
  test('accepts admin role for platform queue but never grants decisions', () {
    final profile = InOneProfile.fromJson({
      'userId': 'admin-1',
      'nickname': 'Platform Admin',
      'email': 'admin@example.test',
      'verificationLevel': 1,
      'providers': [],
      'backupEmail': null,
      'securityHints': [],
      'platformRole': 'admin',
    });
    expect(profile.canViewPlatformRequests, isTrue);
    expect(profile.canDecidePlatformRequests, isFalse);
  });

}
