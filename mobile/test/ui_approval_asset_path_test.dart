import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/claude_screen_catalog.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('all handoff screens map to deterministic local asset paths', () {
    expect(claudeScreenSources, hasLength(31));
    for (final screen in claudeScreenSources) {
      expect(screen.assetPath, 'assets/ui-approval/${screen.path}');
      expect(screen.assetPath, isNot(contains('..')));
    }
  });

  test('all 31 approved HTML files are bundled and match their stable IDs', () async {
    for (final screen in claudeScreenSources) {
      final html = await rootBundle.loadString(screen.assetPath);
      expect(html, contains('data-screen="${screen.id}"'), reason: screen.assetPath);
      expect(html, contains('<html'), reason: screen.assetPath);
    }
    await rootBundle.loadString('assets/ui-approval/interactions.v2.js');
    await rootBundle.loadString('assets/ui-approval/interactions.js');
    await rootBundle.loadString('assets/ui-approval/design-tokens.v2.css');
    await rootBundle.loadString('assets/ui-approval/design-tokens.css');
    await rootBundle.loadString('assets/ui-approval/legacy-fonts.css');
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
