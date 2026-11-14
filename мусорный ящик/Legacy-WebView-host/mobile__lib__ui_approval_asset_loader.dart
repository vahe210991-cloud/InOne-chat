import 'package:flutter/services.dart';

import 'claude_screen_catalog.dart';

/// Loads an owner-approved HTML screen from the bundled local asset package.
/// The asset must be imported from the canonical Ui.zip before this is used
/// by the production host. HTML is never allowed to fetch authenticated APIs.
Future<String> loadClaudeScreenHtml(ClaudeScreenSource screen) {
  return rootBundle.loadString(screen.assetPath);
}
