$ErrorActionPreference = "Stop"

$MobileRoot = Split-Path -Parent $PSScriptRoot
Push-Location $MobileRoot
$BackupRoot = Join-Path $env:TEMP ("inone-frb-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $BackupRoot | Out-Null

$Preserve = @(
    "lib/main.dart",
    "rust/src/api/mod.rs"
)

try {
    foreach ($relative in $Preserve) {
        $source = Join-Path $MobileRoot $relative
        $destination = Join-Path $BackupRoot $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }

    # Never regenerate an existing native host project: Flutter create can rewrite
    # Gradle/Xcode files owned by the application. Create only missing platforms.
    $MissingPlatforms = @()
    foreach ($platform in @("android", "ios")) {
        if (-not (Test-Path -LiteralPath (Join-Path $MobileRoot $platform))) {
            $MissingPlatforms += $platform
        }
    }
    if ($MissingPlatforms.Count -gt 0) {
        $PlatformList = $MissingPlatforms -join ","
        flutter create --platforms=$PlatformList --project-name inone_mobile --org com.inone .
        if ($LASTEXITCODE -ne 0) { throw "flutter create for $PlatformList failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "Preserving existing Android and iOS host projects."
    }

    cargo install --locked --version 2.13.0 flutter_rust_bridge_codegen
    if ($LASTEXITCODE -ne 0) { throw "Installing flutter_rust_bridge_codegen failed with exit code $LASTEXITCODE" }

    flutter_rust_bridge_codegen integrate --rust-crate-dir rust --rust-crate-name inone_mls_frb --integration-backend native-assets --platforms android,ios --skip-fvm-install --no-dart-fix --no-dart-format --no-integration-test
    if ($LASTEXITCODE -ne 0) { throw "flutter_rust_bridge_codegen integrate failed with exit code $LASTEXITCODE" }

    foreach ($relative in $Preserve) {
        $source = Join-Path $BackupRoot $relative
        $destination = Join-Path $MobileRoot $relative
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }

    $obsolete = @(
        "rust/src/api/simple.rs",
        "lib/src/rust/api/simple.dart"
    )
    foreach ($relative in $obsolete) {
        $path = Join-Path $MobileRoot $relative
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
        }
    }

    flutter_rust_bridge_codegen generate --skip-fvm-install
    if ($LASTEXITCODE -ne 0) { throw "flutter_rust_bridge_codegen generate failed with exit code $LASTEXITCODE" }

    $requiredGenerated = @(
        "hook/build.dart",
        "lib/src/rust/frb_generated.dart",
        "lib/src/rust/api/session.dart",
        "rust/build.rs",
        "rust/src/frb_generated.rs",
        "rust/Cargo.lock"
    )
    foreach ($relative in $requiredGenerated) {
        if (-not (Test-Path -LiteralPath (Join-Path $MobileRoot $relative))) {
            throw "Required generated Flutter Rust Bridge file is missing: $relative"
        }
    }

    node tool/prepare_android_mls.mjs
    if ($LASTEXITCODE -ne 0) { throw "Android MLS context preparation failed with exit code $LASTEXITCODE" }

    flutter pub get
    if ($LASTEXITCODE -ne 0) { throw "flutter pub get failed with exit code $LASTEXITCODE" }

    cargo generate-lockfile --manifest-path rust/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw "Generating the Rust bridge lockfile failed with exit code $LASTEXITCODE" }

    cargo fmt --manifest-path rust/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw "Rust formatting failed with exit code $LASTEXITCODE" }

    Write-Host "Native MLS bindings generated. Next run flutter analyze, flutter test, cargo test --manifest-path rust/Cargo.toml, and Android/iOS device builds."
}
finally {
    foreach ($relative in $Preserve) {
        $source = Join-Path $BackupRoot $relative
        $destination = Join-Path $MobileRoot $relative
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
    }
    Remove-Item -LiteralPath $BackupRoot -Recurse -Force -ErrorAction SilentlyContinue
    Pop-Location
}
