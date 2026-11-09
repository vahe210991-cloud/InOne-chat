import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/network/api_environment.dart';

void main() {
  test('uses the local backend on Android emulator by default', () {
    expect(
      resolveInOneApiBaseUrl(configured: '', isAndroid: true),
      'http://10.0.2.2:8080',
    );
  });

  test('uses loopback for iOS simulator and desktop by default', () {
    expect(
      resolveInOneApiBaseUrl(configured: '', isAndroid: false),
      'http://127.0.0.1:8080',
    );
  });

  test('explicit test host overrides the local default', () {
    expect(
      resolveInOneApiBaseUrl(
        configured: 'http://192.168.1.20:8080/',
        isAndroid: true,
      ),
      'http://192.168.1.20:8080',
    );
  });
}
