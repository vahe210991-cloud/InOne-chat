import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_public_config.dart';
import 'package:inone_mobile/core/network/api_exception.dart';

void main() {
  test('parses only the public maintenance and minimum-version flags', () {
    final config = InOnePublicConfig.fromJson({
      'version': 7,
      'flags': {
        'maintenance.enabled': true,
        'app.minVersion': '1.2.3',
      },
    });

    expect(config.configVersion, 7);
    expect(config.maintenanceEnabled, isTrue);
    expect(config.minimumAppVersion, '1.2.3');
  });

  test('rejects private or malformed configuration payloads', () {
    expect(
      () => InOnePublicConfig.fromJson({'version': 7, 'flags': {'push.enabled': true}}),
      throwsA(isA<ApiException>()),
    );
    expect(
      () => InOnePublicConfig.fromJson({'version': '7', 'flags': {}}),
      throwsA(isA<ApiException>()),
    );
  });
}
