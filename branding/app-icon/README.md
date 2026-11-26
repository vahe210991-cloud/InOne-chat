# InOne app icon

This directory contains the editable vector master for the approved InOne app-icon direction.

## Master asset

- `inone-app-icon.svg`: 1024 × 1024 full-bleed square vector.
- Straight outer edges, no frame and no baked-in corner mask.
- Lime-green background and dark raised `InOne` wordmark.
- The wordmark remains editable SVG text. Its exact appearance depends on the font available in the editor and renderer.

## Native application icons

The SVG is the single source of truth for native icon assets. The existing Flutter platform scaffold script calls `mobile/tool/generate_app_icons.py` after generating the Android/iOS project:

- Android: density-specific legacy launcher PNGs and Android 8+ adaptive icon resources.
- iOS: iPhone/iPad icon variants and the 1024 × 1024 App Store marketing icon.

Rasterizer dependencies are pinned in `mobile/tool/requirements-app-icons.txt`. Generated platform projects and raster outputs remain in the build workspace and are recreated from this master; they are not separate hand-maintained source assets.

## Visual rule

Keep the source artwork square and full-bleed. Do not round the SVG canvas corners: Android and iOS apply their own launcher masks at the operating-system level.
