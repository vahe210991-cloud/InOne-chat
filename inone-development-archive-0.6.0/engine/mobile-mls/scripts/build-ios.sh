#!/usr/bin/env bash
# Сборка ядра MLS для iOS: устройство и симулятор на Apple Silicon, упаковка в XCFramework.
# Работает только на macOS с установленным Xcode.
set -euo pipefail

# Keep C/assembly objects and rustc's iOS link target on the same supported
# deployment version. Rust otherwise defaults aarch64-apple-ios to 10.0.
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-15.0}"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "iOS-сборка работает только на macOS с Xcode" >&2
  exit 1
fi
here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$here/../flutter_app/ios/MlsBridge.xcframework}"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cd "$here/mls-bridge"
cargo build --release --locked --target aarch64-apple-ios
cargo build --release --locked --target aarch64-apple-ios-sim
rm -rf "$out"
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libmls_bridge.a \
  -library target/aarch64-apple-ios-sim/release/libmls_bridge.a \
  -output "$out"
echo "iOS: XCFramework собран в $out"
