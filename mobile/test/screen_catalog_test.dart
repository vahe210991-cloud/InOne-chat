import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/test_api/screen_api_catalog.dart';
import 'package:inone_mobile/test_screens.dart';

void main() {
  test('at least ten distinct screens are wired to safe backend GET probes', () {
    const requiredBindings = <String, String>{
      'GR-03': '/rooms/search?q=:query',
      'PR-05': '/devices/mine',
      'PR-07': '/approvals',
      'OR-01': '/orgs/mine',
      'OR-03': '/orgs/:id/settings',
      'RQ-03': '/org-requests',
      'ST-02': '/config',
      'ST-03': '/config/public',
      'SR-01': '/users/search?nickname=:query',
      'personal-profile-light': '/profile',
      'messages-light': '/rooms/mine',
      'notifications-light': '/sync',
    };

    for (final binding in requiredBindings.entries) {
      expect(
        screenApiProbes[binding.key]?.single.path,
        binding.value,
        reason: '${binding.key} must retain its backend route binding',
      );
    }

    expect(requiredBindings.length, greaterThanOrEqualTo(10));
    expect(screenApiProbes.containsKey('GR-01'), isFalse);
    expect(screenApiProbes.containsKey('workspace-light'), isFalse,
        reason: 'workspace room listing is not yet part of this screen catalog');
    expect(
      screenApiProbes.keys.toSet().intersection(requiredBindings.keys.toSet()).length,
      greaterThanOrEqualTo(10),
    );
  });

  test('public probes do not require an authenticated session', () {
    expect(screenApiProbes['ST-03']?.single.authenticated, isFalse);
  });

  test('future concepts remain visible but are not misclassified as Beta 0.7.1', () {
    final future = testScreens.where((screen) => screen.stage == ScreenStage.future);
    expect(future.length, 21);
    expect(future.every((screen) => screen.status == 'Следующий этап'), isTrue);
  });
}
