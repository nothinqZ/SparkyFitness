"""Tests for the release publisher (python3 -m unittest discover tests)."""
import datetime as dt
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path[:0] = [str(HERE.parent / "publisher"), str(REPO / "scripts" / "ios")]

import sparky_release as sr  # noqa: E402
from test_validate_ipa import macho, make_ipa  # noqa: E402

ENTITLEMENTS = {
    "com.apple.developer.healthkit": True,
    "com.apple.security.application-groups": ["group.com.sparkyfitness.personal"],
}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        env = {
            "DATA_DIR": str(self.root / "data"),
            "PUBLIC_BASE_URL": "https://apps.example.ts.net/",
            "KEEP_RELEASES": "3",
            "GITHUB_REPO": "me/SparkyFitness",
            "ICON_PATH": str(self.root / "icon.png"),
        }
        (self.root / "icon.png").write_bytes(b"\x89PNG fake")
        self.env = mock.patch.dict(os.environ, env)
        self.env.start()
        self.cfg = sr.Config.from_env()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def ipa(self, version="1.8.0", build="1", bundle="com.sparkyfitness.personal"):
        path = self.root / f"in-{version}-{build}.ipa"
        make_ipa(path, info={"CFBundleShortVersionString": version, "CFBundleVersion": build,
                             "CFBundleIdentifier": bundle},
                 exe=macho(entitlements=ENTITLEMENTS))
        return path

    def source(self):
        return json.loads((self.cfg.public / "source.json").read_text())


class PublisherTest(Base):

    def test_requires_https_base_url(self):
        with mock.patch.dict(os.environ, {"PUBLIC_BASE_URL": "http://apps.local"}):
            with self.assertRaises(SystemExit):
                sr.Config.from_env()

    def test_publish_writes_ipa_checksum_and_source(self):
        ipa = self.ipa(build="7")
        r = sr.publish(self.cfg, ipa, notes="First build",
                       now=dt.datetime(2026, 10, 20, 8, 0, tzinfo=dt.timezone.utc))
        stored = self.cfg.public / r["file"]
        self.assertTrue(stored.exists())
        digest = hashlib.sha256(ipa.read_bytes()).hexdigest()
        self.assertEqual(r["sha256"], digest)
        self.assertEqual((stored.parent / (stored.name + ".sha256")).read_text().split()[0], digest)

        src = self.source()
        app = src["apps"][0]
        self.assertEqual(src["sourceURL"], "https://apps.example.ts.net/source.json")
        self.assertEqual(app["bundleIdentifier"], "com.sparkyfitness.personal")
        self.assertEqual(app["versions"][0], {
            "version": "1.8.0",
            "buildVersion": "7",
            "date": "2026-10-20T08:00:00Z",
            "localizedDescription": "First build",
            "downloadURL": "https://apps.example.ts.net/releases/1.8.0-7/SparkyFitness-1.8.0-7.ipa",
            "size": ipa.stat().st_size,
            "sha256": digest,
            "minOSVersion": "16.0",
        })
        self.assertEqual(app["appPermissions"]["entitlements"],
                         sorted(ENTITLEMENTS))
        self.assertIn("NSCameraUsageDescription", app["appPermissions"]["privacy"])
        self.assertTrue((self.cfg.public / "icon.png").exists())
        self.assertIn("sidestore://source?url=", (self.cfg.public / "index.html").read_text())

    def test_download_url_escapes_spaces_in_app_name(self):
        self.cfg.app_name = "Fitness Intelligence"
        sr.publish(self.cfg, self.ipa(build="8"))
        version = self.source()["apps"][0]["versions"][0]
        self.assertEqual(
            version["downloadURL"],
            "https://apps.example.ts.net/releases/1.8.0-8/Fitness%20Intelligence-1.8.0-8.ipa",
        )
        self.assertIn("Fitness%20Intelligence-1.8.0-8.ipa", (self.cfg.public / "index.html").read_text())

    def test_publish_is_idempotent_but_refuses_changed_content(self):
        first = sr.publish(self.cfg, self.ipa(build="2"))
        again = sr.publish(self.cfg, self.ipa(build="2"))
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(len(sr.load_state(self.cfg)["releases"]), 1)
        other = self.root / "other.ipa"
        make_ipa(other, info={"CFBundleVersion": "2"}, exe=macho(entitlements={"x": True}))
        with self.assertRaisesRegex(ValueError, "different content"):
            sr.publish(self.cfg, other)

    def test_rejects_wrong_bundle_and_checksum(self):
        with self.assertRaisesRegex(ValueError, "bundle id"):
            sr.publish(self.cfg, self.ipa(bundle="com.other.app"))
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            sr.publish(self.cfg, self.ipa(build="3"), expected_sha256="0" * 64)
        self.assertEqual(sr.load_state(self.cfg)["releases"], [])

    def test_versions_newest_first_and_rollback_restore(self):
        for build in ("1", "2", "10"):
            sr.publish(self.cfg, self.ipa(build=build))
        builds = lambda: [v["buildVersion"] for v in self.source()["apps"][0]["versions"]]  # noqa: E731
        self.assertEqual(builds(), ["10", "2", "1"])  # numeric, not lexical

        self.assertEqual(sr.rollback(self.cfg)["id"], "1.8.0-2")
        self.assertEqual(builds(), ["2", "1"])
        self.assertEqual(sr.rollback(self.cfg, to="1.8.0-1")["id"], "1.8.0-1")
        self.assertEqual(builds(), ["1"])
        # Withdrawn IPAs stay on disk, so restoring is instant.
        sr.restore(self.cfg, "1.8.0-10")
        self.assertEqual(builds(), ["10", "1"])
        with self.assertRaisesRegex(ValueError, "not available"):
            sr.rollback(self.cfg, to="9.9.9-1")
        sr.rollback(self.cfg, to="1.8.0-1")
        with self.assertRaisesRegex(ValueError, "nothing to roll back"):
            sr.rollback(self.cfg)

    def test_prune_keeps_newest_and_current(self):
        for build in ("1", "2", "3", "4", "5"):
            sr.publish(self.cfg, self.ipa(build=build))
        removed = sr.prune(self.cfg, keep=2)
        self.assertEqual(sorted(removed), ["1.8.0-1", "1.8.0-2", "1.8.0-3"])
        self.assertFalse((self.cfg.public / "releases" / "1.8.0-1").exists())
        self.assertEqual([v["buildVersion"] for v in self.source()["apps"][0]["versions"]], ["5", "4"])
        with self.assertRaisesRegex(ValueError, "pruned"):
            sr.restore(self.cfg, "1.8.0-1")

    def test_cli_publish_list_rollback(self):
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            self.assertEqual(sr.main(["publish", str(self.ipa(build="1")), "--notes", "a"]), 0)
            self.assertEqual(sr.main(["publish", str(self.ipa(build="2"))]), 0)
            self.assertEqual(sr.main(["rollback"]), 0)
            self.assertEqual(sr.main(["list"]), 0)
        self.assertIn("current release is now 1.8.0-1", out.getvalue())
        self.assertIn("* 1.8.0-1", out.getvalue())
        with mock.patch("sys.stderr", io.StringIO()):
            self.assertEqual(sr.main(["restore", "nope"]), 1)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class GithubSyncTest(Base):
    def fake_github(self, ipa_bytes, sha=None, meta_sha=None, tag="sideload-v1.8.0-1"):
        digest = sha or hashlib.sha256(ipa_bytes).hexdigest()
        releases = [
            {"tag_name": tag, "draft": False, "created_at": "2026-10-20T08:00:00Z",
             "body": "Notes from the tag",
             "assets": [
                 {"name": "SparkyFitness-1.8.0-1.ipa", "url": "https://api/ipa"},
                 {"name": "SparkyFitness-1.8.0-1.ipa.sha256", "url": "https://api/sha"},
                 {"name": "release.json", "url": "https://api/meta"},
             ]},
            {"tag_name": "v1.9.0", "draft": False, "created_at": "2026-10-21", "assets": []},
        ]
        bodies = {
            "https://api.github.com/repos/me/SparkyFitness/releases?per_page=30": json.dumps(releases).encode(),
            "https://api/ipa": ipa_bytes,
            "https://api/sha": f"{digest}  SparkyFitness-1.8.0-1.ipa\n".encode(),
            "https://api/meta": json.dumps({"sha256": meta_sha or digest}).encode(),
        }
        calls = []

        def urlopen(req, timeout=None):
            calls.append(req)
            return FakeResponse(bodies[req.full_url])
        return urlopen, calls

    def test_publishes_new_sideload_releases_once(self):
        data = self.ipa(build="1").read_bytes()
        urlopen, calls = self.fake_github(data)
        with mock.patch.object(sr.urllib.request, "urlopen", urlopen), \
                mock.patch.dict(os.environ, {"GITHUB_TOKEN": "t0ken"}):
            cfg = sr.Config.from_env()
            self.assertEqual(sr.sync_github(cfg, log=lambda *_: None), ["1.8.0-1"])
            self.assertEqual(sr.sync_github(cfg, log=lambda *_: None), [])
        self.assertEqual(calls[0].get_header("Authorization"), "Bearer t0ken")
        release = sr.load_state(self.cfg)["releases"][0]
        self.assertEqual(release["source_tag"], "sideload-v1.8.0-1")
        self.assertEqual(release["notes"], "Notes from the tag")

    def test_refuses_checksum_mismatch(self):
        data = self.ipa(build="1").read_bytes()
        logs = []
        urlopen, _ = self.fake_github(data, sha="f" * 64)
        with mock.patch.object(sr.urllib.request, "urlopen", urlopen):
            self.assertEqual(sr.sync_github(self.cfg, log=logs.append), [])
        self.assertTrue(any("SHA-256 mismatch" in line for line in logs), logs)
        urlopen, _ = self.fake_github(data, meta_sha="e" * 64)
        with mock.patch.object(sr.urllib.request, "urlopen", urlopen):
            self.assertEqual(sr.sync_github(self.cfg, log=logs.append), [])
        self.assertTrue(any("disagree" in line for line in logs), logs)
        self.assertEqual(sr.load_state(self.cfg)["releases"], [])


if __name__ == "__main__":
    unittest.main()
