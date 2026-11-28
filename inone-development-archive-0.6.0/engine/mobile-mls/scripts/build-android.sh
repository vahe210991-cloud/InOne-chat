#!/usr/bin/env bash
# Сборка ядра MLS для Android: три архитектуры, результат кладётся в проект Flutter.
# Нужны: Rust 1.92+ с целями Android, cargo-ndk, Android NDK (переменная ANDROID_NDK_HOME).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$here/../flutter_app/android/app/src/main/jniLibs}"
: "${ANDROID_NDK_HOME:?ANDROID_NDK_HOME не задан: укажите путь к Android NDK}"
for target in aarch64-linux-android armv7-linux-androideabi x86_64-linux-android; do
  rustup target add "$target"
done
cd "$here/mls-bridge"
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o "$out" build --release --locked
echo "Android: библиотеки собраны в $out"
