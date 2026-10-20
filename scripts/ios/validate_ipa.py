#!/usr/bin/env python3
"""Structural checks for an unsigned iOS .ipa before it is published.

An IPA that installs through SideStore must be a zip with exactly one
Payload/<Name>.app, a readable Info.plist whose CFBundleExecutable exists and
is an arm64 device Mach-O (not a simulator build), and, for the free-Apple-ID
sideload variant, no app extensions (each would need one more App ID).

Prints a JSON summary on success; exits 1 with every failed check otherwise.
Standard library only, so it runs on the macOS runner and on Linux alike.

    python3 scripts/ios/validate_ipa.py SparkyFitness.ipa \
        --bundle-id com.sparkyfitness.personal --no-extensions
"""
from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import struct
import sys
import zipfile

MH_MAGIC_64 = 0xFEEDFACF
FAT_MAGIC = 0xCAFEBABE
FAT_MAGIC_64 = 0xCAFEBABF
CPU_TYPE_ARM64 = 0x0100000C
LC_BUILD_VERSION = 0x32
PLATFORM_IOS = 2
PLATFORM_IOS_SIMULATOR = 7


def macho_slices(data: bytes) -> list[bytes]:
    """Returns the thin Mach-O images in `data` (one, or one per fat arch)."""
    if len(data) < 8:
        return []
    magic_be = struct.unpack(">I", data[:4])[0]
    if magic_be in (FAT_MAGIC, FAT_MAGIC_64):
        count = struct.unpack(">I", data[4:8])[0]
        slices = []
        entry = 20 if magic_be == FAT_MAGIC else 32
        for i in range(count):
            off = 8 + i * entry
            if magic_be == FAT_MAGIC:
                _cpu, _sub, start, size, _align = struct.unpack(">iiIII", data[off:off + 20])
            else:
                _cpu, _sub, start, size, _align, _res = struct.unpack(">iiQQII", data[off:off + 32])
            slices.append(data[start:start + size])
        return slices
    return [data]


def describe_slice(image: bytes) -> dict:
    """cputype and LC_BUILD_VERSION platform of a thin little-endian Mach-O."""
    if len(image) < 32 or struct.unpack("<I", image[:4])[0] != MH_MAGIC_64:
        return {"valid": False}
    cputype, _sub, _ftype, ncmds, _size, _flags, _res = struct.unpack("<iiIIIII", image[4:32])
    platform = None
    offset = 32
    for _ in range(ncmds):
        if offset + 8 > len(image):
            break
        cmd, cmdsize = struct.unpack("<II", image[offset:offset + 8])
        if cmd == LC_BUILD_VERSION and offset + 12 <= len(image):
            platform = struct.unpack("<I", image[offset + 8:offset + 12])[0]
        if cmdsize == 0:
            break
        offset += cmdsize
    return {"valid": True, "cputype": cputype & 0xFFFFFFFF, "platform": platform}


def validate(path: str, bundle_id: str | None, no_extensions: bool, require_js_bundle: bool) -> dict:
    errors: list[str] = []
    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return {"errors": ["not a zip archive"]}

    names = zf.namelist()
    apps = sorted({n.split("/")[1] for n in names
                   if n.startswith("Payload/") and n.count("/") >= 2 and n.split("/")[1].endswith(".app")})
    if len(apps) != 1:
        errors.append(f"expected exactly one Payload/*.app, found {apps or 'none'}")
        return {"errors": errors}
    app = f"Payload/{apps[0]}"
    stray = [n for n in names if not n.startswith("Payload/")]
    if stray:
        errors.append(f"files outside Payload/: {stray[:5]}")

    try:
        info = plistlib.loads(zf.read(f"{app}/Info.plist"))
    except KeyError:
        return {"errors": errors + ["Info.plist missing"]}
    except Exception as exc:  # malformed plist
        return {"errors": errors + [f"Info.plist unreadable: {exc}"]}

    for key in ("CFBundleIdentifier", "CFBundleExecutable", "CFBundleShortVersionString", "CFBundleVersion"):
        if not info.get(key):
            errors.append(f"Info.plist lacks {key}")
    if bundle_id and info.get("CFBundleIdentifier") != bundle_id:
        errors.append(f"bundle id {info.get('CFBundleIdentifier')!r} != expected {bundle_id!r}")
    if "iPhoneOS" not in info.get("CFBundleSupportedPlatforms", ["iPhoneOS"]):
        errors.append(f"not a device build: CFBundleSupportedPlatforms={info.get('CFBundleSupportedPlatforms')}")

    exe_path = f"{app}/{info.get('CFBundleExecutable', '')}"
    arch = None
    if exe_path in names:
        slices = [describe_slice(s) for s in macho_slices(zf.read(exe_path))]
        arm64 = [s for s in slices if s.get("valid") and s["cputype"] == CPU_TYPE_ARM64]
        if not arm64:
            errors.append("executable has no arm64 Mach-O slice")
        elif any(s["platform"] == PLATFORM_IOS_SIMULATOR for s in arm64):
            errors.append("executable is built for the iOS simulator")
        arch = "arm64" if arm64 else None
    else:
        errors.append(f"executable {exe_path} missing")

    extensions = sorted({n.split("/")[3] for n in names
                         if n.startswith(f"{app}/PlugIns/") and n.count("/") >= 4})
    watch = sorted({n.split("/")[3] for n in names
                    if n.startswith(f"{app}/Watch/") and n.count("/") >= 4})
    if no_extensions and (extensions or watch):
        errors.append(f"app extensions present (each needs an App ID): {extensions + watch}")

    if require_js_bundle and f"{app}/main.jsbundle" not in names:
        errors.append("main.jsbundle missing: a Release build must embed the JS bundle")

    if f"{app}/embedded.mobileprovision" in names:
        errors.append("IPA is already provisioned; SideStore expects an unsigned build")

    return {
        "errors": errors,
        "app": apps[0],
        "bundle_id": info.get("CFBundleIdentifier"),
        "version": info.get("CFBundleShortVersionString"),
        "build": info.get("CFBundleVersion"),
        "minimum_os_version": info.get("MinimumOSVersion"),
        "executable_arch": arch,
        "extensions": extensions + watch,
        "size": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("ipa")
    parser.add_argument("--bundle-id")
    parser.add_argument("--no-extensions", action="store_true")
    parser.add_argument("--allow-missing-js-bundle", action="store_true")
    args = parser.parse_args(argv)
    result = validate(args.ipa, args.bundle_id, args.no_extensions, not args.allow_missing_js_bundle)
    if result["errors"]:
        for err in result["errors"]:
            print(f"IPA check failed: {err}", file=sys.stderr)
        return 1
    result.pop("errors")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
