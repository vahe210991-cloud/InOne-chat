import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

const _galleryParts = <String>[
  'assets/test-ui/part-01.b64',
  'assets/test-ui/part-02.b64',
  'assets/test-ui/part-03.b64',
  'assets/test-ui/part-04.b64',
  'assets/test-ui/part-05.b64',
  'assets/test-ui/part-06.b64',
  'assets/test-ui/part-07.b64',
];

/// Loads the exact owner-provided 0.8 full-screen gallery source.
///
/// The HTML is stored as deterministic gzip/base64 text parts to keep source
/// import manageable; it is reconstructed in memory and never rewritten.
Future<String> loadTestGalleryHtml() async {
  final encoded = StringBuffer();
  for (final asset in _galleryParts) {
    encoded.write((await rootBundle.loadString(asset)).trim());
  }
  final compressed = base64Decode(encoded.toString());
  final htmlBytes = GZipCodec().decode(compressed);
  return utf8.decode(htmlBytes);
}
