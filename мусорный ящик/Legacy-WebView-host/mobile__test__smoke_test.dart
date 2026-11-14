import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/approved_screens.dart';
import 'package:inone_mobile/test_screens.dart';

void main() {
  test('all 22 approved screen variants are registered', () {
    expect(approvedScreens, hasLength(22));
    expect(approvedScreens.where((screen) => screen.theme == 'light'), hasLength(11));
    expect(approvedScreens.where((screen) => screen.theme == 'dark'), hasLength(11));
    expect(approvedScreens.map((screen) => screen.id).toSet(), hasLength(22));
  });

  test('all 73 test screens are registered in the shared catalogue', () {
    expect(testScreens, hasLength(73));
    expect(testScreens.map((screen) => screen.id).toSet(), hasLength(73));
    expect(testScreens.where((screen) => screen.stage == ScreenStage.core), hasLength(51));
    expect(testScreens.where((screen) => screen.stage == ScreenStage.deferred), hasLength(1));
    expect(testScreens.where((screen) => screen.stage == ScreenStage.future), hasLength(21));
  });

  test('the unified test host exposes 95 distinct screen variants', () {
    final keys = <String>{
      ...approvedScreens.map((screen) => 'approved:${screen.id}'),
      ...testScreens.map((screen) => 'test:${screen.id}'),
    };
    expect(keys, hasLength(95));
  });

  test('approved HTML design remains a local Flutter asset', () {
    expect(approvedScreensAssetPath,
        'assets/approved-ui/InOne-approved-cross-platform.html');
  });
}
