#!/usr/bin/env python3
"""Generate native InOne launcher icons from the editable SVG master."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cairosvg
from PIL import Image

if len(sys.argv) != 4:
    raise SystemExit(
        "Usage: generate_app_icons.py <repository-root> <mobile-root> <android[,ios]>"
    )

repo_root = Path(sys.argv[1]).resolve()
mobile_root = Path(sys.argv[2]).resolve()
platforms = sys.argv[3].split(",")
if not platforms or any(item not in {"android", "ios"} for item in platforms):
    raise SystemExit(f"Unsupported platform list: {sys.argv[3]}")

master = repo_root / "branding" / "app-icon" / "inone-app-icon.svg"
if not master.is_file():
    raise SystemExit(f"Editable icon master not found: {master}")

png_bytes = cairosvg.svg2png(
    url=str(master),
    output_width=1024,
    output_height=1024,
)
from io import BytesIO

image = Image.open(BytesIO(png_bytes)).convert("RGBA")
if image.size != (1024, 1024):
    raise SystemExit(f"Unexpected master render size: {image.size}")
if image.getpixel((0, 0))[3] != 255:
    raise SystemExit("App icon must be opaque and full-bleed")

def save_png(target: Path, size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    resized = image if size == 1024 else image.resize(
        (size, size), Image.Resampling.LANCZOS
    )
    resized.save(target, format="PNG", optimize=True)

if "android" in platforms:
    res = mobile_root / "android" / "app" / "src" / "main" / "res"
    density_sizes = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    for density, size in density_sizes.items():
        save_png(res / f"mipmap-{density}" / "ic_launcher.png", size)

    # Android's adaptive foreground uses the approved square artwork. The OS
    # applies the device-specific mask; the green field is intentionally full bleed.
    save_png(res / "drawable-nodpi" / "ic_launcher_foreground.png", 1024)

    values = res / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="ic_launcher_background">#A9F000</color>\n'
        '</resources>\n',
        encoding="utf-8",
    )
    adaptive = res / "mipmap-anydpi-v26"
    adaptive.mkdir(parents=True, exist_ok=True)
    adaptive_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background" />\n'
        '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
        '</adaptive-icon>\n'
    )
    (adaptive / "ic_launcher.xml").write_text(adaptive_xml, encoding="utf-8")
    (adaptive / "ic_launcher_round.xml").write_text(adaptive_xml, encoding="utf-8")
    print("Generated Android legacy and adaptive launcher icons.")

if "ios" in platforms:
    appicon = (
        mobile_root
        / "ios"
        / "Runner"
        / "Assets.xcassets"
        / "AppIcon.appiconset"
    )
    appicon.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, str]] = []
    specs = [
        ("iphone", "20x20", 2), ("iphone", "20x20", 3),
        ("iphone", "29x29", 2), ("iphone", "29x29", 3),
        ("iphone", "40x40", 2), ("iphone", "40x40", 3),
        ("iphone", "60x60", 2), ("iphone", "60x60", 3),
        ("ipad", "20x20", 1), ("ipad", "20x20", 2),
        ("ipad", "29x29", 1), ("ipad", "29x29", 2),
        ("ipad", "40x40", 1), ("ipad", "40x40", 2),
        ("ipad", "76x76", 1), ("ipad", "76x76", 2),
        ("ipad", "83.5x83.5", 2),
    ]
    index = 0
    for idiom, logical_size, scale in specs:
        pixels = round(float(logical_size.split("x")[0]) * scale)
        filename = f"AppIcon-{pixels}-{index}.png"
        save_png(appicon / filename, pixels)
        entries.append({
            "filename": filename,
            "idiom": idiom,
            "scale": f"{scale}x",
            "size": logical_size,
        })
        index += 1

    save_png(appicon / "AppIcon-1024.png", 1024)
    entries.append({
        "filename": "AppIcon-1024.png",
        "idiom": "ios-marketing",
        "scale": "1x",
        "size": "1024x1024",
    })
    (appicon / "Contents.json").write_text(
        json.dumps({"images": entries, "info": {"author": "xcode", "version": 1}}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print("Generated iOS AppIcon asset catalog including the 1024px marketing icon.")
