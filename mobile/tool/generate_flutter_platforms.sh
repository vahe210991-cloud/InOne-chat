#!/usr/bin/env bash
# Generate Flutter platform projects outside the existing application root.
# Usage: bash tool/generate_flutter_platforms.sh android,ios
set -euo pipefail

platforms="${1:?Usage: generate_flutter_platforms.sh <android[,ios]>}"
case "$platforms" in
  android|ios|android,ios) ;;
  *) echo "Unsupported Flutter platforms: $platforms" >&2; exit 2 ;;
esac

app_root="$(pwd)"
repo_root="$(git -C "$app_root" rev-parse --show-toplevel)"
scaffold_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/inone-flutter-scaffold.XXXXXX")"
trap 'rm -rf "$scaffold_root"' EXIT

generated_app="$scaffold_root/inone_mobile"
flutter create \
  --platforms="$platforms" \
  --project-name app \
  --org com.inone \
  --no-pub \
  "$generated_app"

IFS=',' read -r -a requested_platforms <<< "$platforms"
for platform in "${requested_platforms[@]}"; do
  test -d "$generated_app/$platform" || {
    echo "Flutter did not generate the requested $platform project" >&2
    exit 1
  }
  mkdir -p "$app_root/$platform"
  cp -a "$generated_app/$platform/." "$app_root/$platform/"
done

# Install only the checked-in, validated Firebase client config for each requested
# native platform. This runs after scaffold generation and before any build step.
node "$app_root/tool/prepare_firebase_platforms.mjs" "$platforms" "$repo_root" "$app_root"
node "$app_root/tool/configure_firebase_native.mjs" "$platforms" "$app_root"

# Derive all native launcher assets from the single editable SVG brand master.
if ! python3 -c "import cairosvg; from PIL import Image" >/dev/null 2>&1; then
  python3 -m pip install --disable-pip-version-check --no-input -r "$app_root/tool/requirements-app-icons.txt"
fi
python3 "$app_root/tool/generate_app_icons.py" "$repo_root" "$app_root" "$platforms"

# Scaffold generation must never modify dependency manifests or lockfiles.
git -C "$repo_root" diff --exit-code -- mobile/pubspec.yaml mobile/pubspec.lock
