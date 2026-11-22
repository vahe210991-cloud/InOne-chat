#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# file_picker 11.0.1–11.0.3 skips Kotlin compilation on AGP 9 when
# android.builtInKotlin=false. Flutter 3.47.9 generates AGP 9.1.0 projects.
# Keep the v11 Dart API and apply the upstream-documented Kotlin workaround
# only for that affected dependency/AGP combination.
if ! grep -Eq '^    version: "11\.0\.[1-3]"$' pubspec.lock; then
  echo "file_picker is not on the affected 11.0.1–11.0.3 line; no workaround needed."
  exit 0
fi

if ! grep -Fq 'id("com.android.application") version "9.' android/settings.gradle.kts 2>/dev/null; then
  echo "Android Gradle Plugin is not 9.x; no file_picker workaround needed."
  exit 0
fi

if [[ -f android/build.gradle.kts ]]; then
  root_build="android/build.gradle.kts"
  apply_line='apply(from = "file_picker_android_workaround.gradle")'
elif [[ -f android/build.gradle ]]; then
  root_build="android/build.gradle"
  apply_line='apply from: "file_picker_android_workaround.gradle"'
else
  echo "::error::Generated Android root Gradle build file not found."
  exit 1
fi

if ! grep -Fq "$apply_line" "$root_build"; then
  cat > android/file_picker_android_workaround.gradle <<'GROOVY'
subprojects {
    if (name == "file_picker") {
        apply plugin: "org.jetbrains.kotlin.android"
        tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
            compilerOptions {
                jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
            }
        }
    }
}
GROOVY
  printf '\n// Work around file_picker 11.x Kotlin compilation on AGP 9.\n%s\n' "$apply_line" >> "$root_build"
fi

grep -Fq "$apply_line" "$root_build"
test -s android/file_picker_android_workaround.gradle
echo "Applied file_picker 11.x AGP 9 Kotlin/JVM 17 compatibility workaround."
