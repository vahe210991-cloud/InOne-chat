#!/usr/bin/env sh
set -eu

diag_dir="/tmp/inone-android-runtime-diagnostics"
mkdir -p "$diag_dir"

timeout 60 adb wait-for-device
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
    echo "=== adb devices ==="
    adb devices -l || true
    echo "=== app process memory ==="
    adb shell dumpsys meminfo com.inone.inone_mobile || true
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
