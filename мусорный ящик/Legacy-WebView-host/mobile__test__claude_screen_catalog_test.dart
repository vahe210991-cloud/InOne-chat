import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/claude_screen_catalog.dart';

void main() {
  test('Claude handoff uses stable screen IDs and unique source paths', () {
    final ids = claudeScreenSources.map((screen) => screen.id).toList();
    final paths = claudeScreenSources.map((screen) => screen.path).toList();

    expect(ids.toSet().length, ids.length);
    expect(paths.toSet().length, paths.length);
    expect(claudeScreenSources.length, 31);
    expect(
      claudeScreenSources.where((screen) => screen.stage == UiDeliveryStage.beta1).length,
      31,
    );
  });

  test('Beta 2.0 approved concepts are retained but marked as placeholders', () {
    expect(beta2ScreenIds, containsAll([
      'leads-light', 'leads-dark', 'kanban-light', 'kanban-dark',
      'deal-detail-light', 'deal-detail-dark',
    ]));
    expect(beta2ScreenPlaceholder, contains('Beta 2.0'));
  });

  test('Claude source catalog includes the current backend room-list route', () {
    final chatList = claudeScreenSources.singleWhere((screen) => screen.id == 'CH-01');
    expect(chatList.api, 'GET /rooms/mine');
  });
}
