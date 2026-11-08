import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/test_api/screen_api_catalog.dart';
import 'package:inone_mobile/test_screens.dart';

void main() {
  test('primary test screens have read-only API probes where supported', () {
    expect(screenApiProbes['GR-01']?.single.path, '/rooms/mine');
    expect(screenApiProbes['OR-01']?.single.path, '/orgs/mine');
    expect(screenApiProbes['PR-05']?.single.path, '/devices/mine');
    expect(screenApiProbes['ST-03']?.single.authenticated, isFalse);
  });

  test('future concepts remain visible but are not misclassified as Beta 0.7.1', () {
    final future = testScreens.where((screen) => screen.stage == ScreenStage.future);
    expect(future.length, 21);
    expect(future.every((screen) => screen.status == 'Следующий этап'), isTrue);
  });
}
