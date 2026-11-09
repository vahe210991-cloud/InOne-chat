import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/claude_screen_catalog.dart';

void main() {
  test('all handoff screens map to deterministic local asset paths', () {
    expect(claudeScreenSources, hasLength(31));
    for (final screen in claudeScreenSources) {
      expect(screen.assetPath, 'assets/ui-approval/${screen.path}');
      expect(screen.assetPath, isNot(contains('..')));
    }
  });

  test('screen IDs and local asset paths remain unique', () {
    expect(claudeScreenSources.map((screen) => screen.id).toSet(), hasLength(31));
    expect(claudeScreenSources.map((screen) => screen.assetPath).toSet(), hasLength(31));
  });

  test('chat history endpoint remains explicitly identifiable as unresolved', () {
    final conversation = claudeScreenSources.singleWhere((screen) => screen.id == 'CH-02');
    expect(conversation.api, 'GET /rooms/:id/events');
  });
}
