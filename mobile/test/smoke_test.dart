import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/approved_screens.dart';

void main() {
  test('approved HTML design is packaged as a local Flutter asset', () {
    expect(approvedScreensAssetPath,
        'assets/approved-ui/InOne-mobile-design-system-curated.html');
  });
}
