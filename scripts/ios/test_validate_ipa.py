"""Tests for validate_ipa.py with synthetic IPAs (python3 -m unittest)."""
import io
import os
import plistlib
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
import validate_ipa as v  # noqa: E402


def code_signature(entitlements):
    """Embedded-signature superblob holding only an entitlements blob."""
    ent = plistlib.dumps(entitlements)
    ent_blob = struct.pack(">II", v.CSMAGIC_EMBEDDED_ENTITLEMENTS, 8 + len(ent)) + ent
    header_len = 12 + 8
    return struct.pack(">IIIII", v.CSMAGIC_EMBEDDED_SIGNATURE, header_len + len(ent_blob), 1,
                       5, header_len) + ent_blob


def macho(cputype=v.CPU_TYPE_ARM64, platform=v.PLATFORM_IOS, entitlements=None):
    """Minimal 64-bit little-endian Mach-O: LC_BUILD_VERSION and, optionally,
    an ad-hoc code signature carrying entitlements."""
    cmds = struct.pack("<IIIIII", v.LC_BUILD_VERSION, 24, platform, 0, 0, 0)
    ncmds = 1
    sig = b""
    if entitlements is not None:
        sig = code_signature(entitlements)
        ncmds += 1
        header_size = 32 + len(cmds) + 16
        cmds += struct.pack("<IIII", v.LC_CODE_SIGNATURE, 16, header_size, len(sig))
    header = struct.pack("<IiiIIIII", v.MH_MAGIC_64, cputype, 0, 2, ncmds, len(cmds), 0, 0)
    return header + cmds + sig


def fat(*slices):
    out = struct.pack(">II", v.FAT_MAGIC, len(slices))
    offset = 8 + 20 * len(slices)
    body = b""
    for s in slices:
        out += struct.pack(">iiIII", 0, 0, offset + len(body), len(s), 0)
        body += s
    return out + body


def make_ipa(path, *, info=None, exe=None, extra=None, omit=()):
    info = {
        "CFBundleIdentifier": "com.sparkyfitness.personal",
        "CFBundleExecutable": "SparkyFitness",
        "CFBundleShortVersionString": "1.8.0",
        "CFBundleVersion": "42",
        "CFBundleSupportedPlatforms": ["iPhoneOS"],
        "MinimumOSVersion": "16.0",
        "NSCameraUsageDescription": "Scan barcodes",
        **(info or {}),
    }
    files = {
        "Payload/SparkyFitness.app/Info.plist": plistlib.dumps(info, fmt=plistlib.FMT_BINARY),
        "Payload/SparkyFitness.app/SparkyFitness": exe if exe is not None else macho(),
        "Payload/SparkyFitness.app/main.jsbundle": b"// js",
        **(extra or {}),
    }
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in files.items():
            if name not in omit:
                zf.writestr(name, data)


class ValidateIpaTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.ipa = os.path.join(self.dir.name, "app.ipa")

    def tearDown(self):
        self.dir.cleanup()

    def check(self, **kwargs):
        return v.validate(self.ipa, kwargs.get("bundle_id", "com.sparkyfitness.personal"),
                          kwargs.get("no_extensions", True), True)

    def test_valid_sideload_ipa(self):
        make_ipa(self.ipa)
        result = self.check()
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["version"], "1.8.0")
        self.assertEqual(result["build"], "42")
        self.assertEqual(result["executable_arch"], "arm64")
        self.assertEqual(len(result["sha256"]), 64)

    def test_fat_binary_with_arm64_slice(self):
        make_ipa(self.ipa, exe=fat(macho(cputype=0x01000007), macho()))
        self.assertEqual(self.check()["errors"], [])

    def test_simulator_build_is_rejected(self):
        make_ipa(self.ipa, exe=macho(platform=v.PLATFORM_IOS_SIMULATOR))
        self.assertIn("executable is built for the iOS simulator", self.check()["errors"])

    def test_x86_only_is_rejected(self):
        make_ipa(self.ipa, exe=macho(cputype=0x01000007))
        self.assertIn("executable has no arm64 Mach-O slice", self.check()["errors"])

    def test_wrong_bundle_id(self):
        make_ipa(self.ipa, info={"CFBundleIdentifier": "com.SparkyApps.SparkyFitnessMobile"})
        self.assertTrue(any("bundle id" in e for e in self.check()["errors"]))

    def test_extensions_are_rejected_for_sideload(self):
        make_ipa(self.ipa, extra={
            "Payload/SparkyFitness.app/PlugIns/Widget.appex/Info.plist": b"x",
            "Payload/SparkyFitness.app/Watch/SparkyFitnessWatch.app/Info.plist": b"x",
        })
        errors = self.check()["errors"]
        self.assertTrue(any("Widget.appex" in e and "SparkyFitnessWatch.app" in e for e in errors), errors)
        self.assertEqual(self.check(no_extensions=False)["errors"], [])

    def test_reads_entitlements_from_ad_hoc_signature(self):
        make_ipa(self.ipa, exe=macho(entitlements={
            "com.apple.developer.healthkit": True,
            "com.apple.security.application-groups": ["group.com.sparkyfitness.personal"],
        }))
        result = v.validate(self.ipa, None, True, True, ("com.apple.developer.healthkit",))
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["entitlements"], [
            "com.apple.developer.healthkit", "com.apple.security.application-groups"])
        self.assertEqual(result["privacy"], {"NSCameraUsageDescription": "Scan barcodes"})

    def test_unsigned_binary_fails_required_entitlement(self):
        make_ipa(self.ipa)
        result = v.validate(self.ipa, None, True, True, ("com.apple.developer.healthkit",))
        self.assertTrue(any("not embedded" in e for e in result["errors"]))

    def test_missing_executable_and_js_bundle(self):
        make_ipa(self.ipa, omit=("Payload/SparkyFitness.app/SparkyFitness",
                                 "Payload/SparkyFitness.app/main.jsbundle"))
        errors = self.check()["errors"]
        self.assertTrue(any("executable" in e and "missing" in e for e in errors))
        self.assertTrue(any("main.jsbundle" in e for e in errors))

    def test_not_a_zip(self):
        with open(self.ipa, "wb") as fh:
            fh.write(b"not a zip")
        self.assertEqual(self.check()["errors"], ["not a zip archive"])

    def test_two_apps(self):
        make_ipa(self.ipa, extra={"Payload/Other.app/Info.plist": b"x"})
        self.assertTrue(any("exactly one" in e for e in self.check()["errors"]))

    def test_cli_exit_codes(self):
        make_ipa(self.ipa)
        stdout = io.StringIO()
        sys_stdout, sys.stdout = sys.stdout, stdout
        try:
            self.assertEqual(v.main([self.ipa, "--bundle-id", "com.sparkyfitness.personal", "--no-extensions"]), 0)
        finally:
            sys.stdout = sys_stdout
        self.assertIn('"bundle_id": "com.sparkyfitness.personal"', stdout.getvalue())
        devnull = open(os.devnull, "w")
        sys_stderr, sys.stderr = sys.stderr, devnull
        try:
            self.assertEqual(v.main([self.ipa, "--bundle-id", "x.y"]), 1)
        finally:
            sys.stderr = sys_stderr
            devnull.close()


if __name__ == "__main__":
    unittest.main()
