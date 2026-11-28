#!/usr/bin/env sh
set -eu

diag_dir="/tmp/inone-android-runtime-diagnostics"
mkdir -p "$diag_dir"

# Keep Flutter and the shell on the same Android SDK / ADB server. The
# emulator runner can start QEMU before the ADB daemon is ready; without
# explicitly selecting this SDK Flutter may list only desktop/web devices.
adb_bin="$(command -v adb)"
android_sdk="$(CDPATH= cd -- "$(dirname -- "$adb_bin")/.." && pwd)"
export ANDROID_HOME="$android_sdk"
export ANDROID_SDK_ROOT="$android_sdk"
export PATH="$(dirname "$adb_bin"):$PATH"
flutter config --android-sdk "$android_sdk"

adb start-server
timeout 90 adb wait-for-device
adb -s emulator-5554 get-state
timeout 60 flutter devices --device-timeout 60
adb install -r build/app/outputs/flutter-apk/app-x86_64-debug.apk
adb shell pm grant com.inone.app android.permission.POST_NOTIFICATIONS
notification_permission="$(adb shell pm check-permission com.inone.app android.permission.POST_NOTIFICATIONS | tr -d '\\r')"
if [ "$notification_permission" != "granted" ]; then
  echo "::error::Android notification permission was not granted for the headless smoke test (state=$notification_permission)"
  exit 1
fi
adb logcat -c || true
adb logcat -b all -v threadtime > "$diag_dir/logcat.txt" 2>&1 &
logcat_pid=$!

set +e
timeout --signal=TERM --kill-after=30s 5m flutter drive --driver=test_driver/integration_test.dart --target=integration_test/mls_secure_store_test.dart -d emulator-5554
smoke_status=$?
set -e

kill "$logcat_pid" 2>/dev/null || true
wait "$logcat_pid" 2>/dev/null || true

if [ "$smoke_status" -ne 0 ]; then
  {
    echo "=== Android SDK / ADB selection ==="
    echo "ANDROID_HOME=$ANDROID_HOME"
    echo "ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
    command -v adb || true
    adb version || true
    echo "=== Flutter device discovery ==="
    flutter devices --device-timeout 30 || true
    echo "=== adb devices ==="
    adb devices -l || true
    echo "=== app process memory ==="
    adb shell dumpsys meminfo com.inone.app || true
    echo "=== Android activity processes ==="
    adb shell dumpsys activity processes || true
    echo "=== host memory ==="
    free -h || true
    echo "=== emulator / adb processes ==="
    ps -eo pid,ppid,%cpu,%mem,rss,stat,etime,args | grep -E '[e]mulator|[q]emu|[a]db' || true
    echo "=== kernel OOM / emulator errors ==="
    sudo dmesg -T | grep -Ei 'oom|killed process|qemu|emulator|segfault|fatal' | tail -n 200 || true
    echo "=== emulator runner files ==="
    if [ -d /tmp/android-runner ]; then
      cp -a /tmp/android-runner "$diag_dir/emulator-runner"
      find /tmp/android-runner -maxdepth 3 -type f -print
    fi
  } > "$diag_dir/host-diagnostics.txt" 2>&1
  cat "$diag_dir/host-diagnostics.txt"
  tail -n 2000 "$diag_dir/logcat.txt" || true
fi

exit "$smoke_status"
