import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/test_gallery_loader.dart';
import 'package:inone_mobile/test_screens.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('original full-screen design gallery contains every registered test screen', () async {
    final html = await loadTestGalleryHtml();
    final cards = RegExp(r'<article class="screen-card"').allMatches(html);
    expect(cards, hasLength(73));

    for (final screen in testScreens) {
      final matches = RegExp(
        r'<article class="screen-card"[^>]*data-title="[^"]*' +
            RegExp.escape(screen.id) +
            r'[^"]*"',
      ).allMatches(html);
      expect(matches, hasLength(1), reason: 'Missing or duplicate gallery card for ${screen.id}');
    }
  });
}
