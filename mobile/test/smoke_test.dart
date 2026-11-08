import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/approved_screens.dart';

void main() {
  test('all 22 approved screen variants are registered', () {
    expect(approvedScreens, hasLength(22));
    expect(approvedScreens.where((screen) => screen.theme == 'light'), hasLength(11));
    expect(approvedScreens.where((screen) => screen.theme == 'dark'), hasLength(11));
    expect(approvedScreens.map((screen) => screen.id).toSet(), hasLength(22));
  });

  test('approved HTML design is packaged as a local Flutter asset', () {
    expect(approvedScreensAssetPath,
        'assets/approved-ui/InOne-approved-cross-platform.html');
  });
}
