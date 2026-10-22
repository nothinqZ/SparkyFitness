#!/usr/bin/env python3
"""Versioned IPA store and SideStore/AltStore source generator.

Layout under DATA_DIR (default /data):

    state.json                      release history (source of truth)
    public/                         served read-only by nginx
      source.json                   AltSource consumed by SideStore
      index.html                    small landing page with the "add source" link
      icon.png
      releases/<id>/<name>.ipa      immutable, one directory per release
      releases/<id>/<name>.ipa.sha256

Commands:
    publish <ipa> [--notes TEXT|--notes-file F] [--source-tag T]
    list
    rollback [--to ID]      withdraw newer releases so ID (default: previous) is current
    restore ID              un-withdraw a release
    prune [--keep N]        delete files of old releases (never the current one)
    generate                rewrite source.json and index.html from state.json
    watch-github            poll GitHub releases (tags sideload-v*) and publish new ones

Standard library only. IPA checks come from scripts/ios/validate_ipa.py, the
same validator the CI workflow runs before uploading.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import validate_ipa

ID_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class Config:
    data_dir: Path
    base_url: str
    bundle_id: str
    app_name: str
    source_name: str
    source_identifier: str
    developer_name: str
    tint_color: str
    keep_releases: int
    github_repo: str | None
    github_token: str | None
    tag_prefix: str

    @staticmethod
    def from_env(env=os.environ) -> "Config":
        base = env.get("PUBLIC_BASE_URL", "").rstrip("/")
        if not base.startswith("https://") and env.get("ALLOW_HTTP_BASE_URL") != "1":
            raise SystemExit("PUBLIC_BASE_URL must be an https:// URL (SideStore requires HTTPS)")
        bundle = env.get("BUNDLE_ID", "com.sparkyfitness.personal")
        return Config(
            data_dir=Path(env.get("DATA_DIR", "/data")),
            base_url=base,
            bundle_id=bundle,
            app_name=env.get("APP_NAME", "SparkyFitness"),
            source_name=env.get("SOURCE_NAME", "SparkyFitness (personal)"),
            source_identifier=env.get("SOURCE_IDENTIFIER", f"{bundle}.source"),
            developer_name=env.get("DEVELOPER_NAME", "Self-hosted"),
            tint_color=env.get("TINT_COLOR", "#22C55E"),
            keep_releases=int(env.get("KEEP_RELEASES", "10")),
            github_repo=env.get("GITHUB_REPO") or None,
            github_token=env.get("GITHUB_TOKEN") or None,
            tag_prefix=env.get("TAG_PREFIX", "sideload-v"),
        )

    @property
    def public(self) -> Path:
        return self.data_dir / "public"

    @property
    def state_path(self) -> Path:
        return self.data_dir / "state.json"


# --- state ------------------------------------------------------------------

def load_state(cfg: Config) -> dict:
    if cfg.state_path.exists():
        return json.loads(cfg.state_path.read_text())
    return {"releases": []}


def atomic_write(path: Path, data: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data.encode() if isinstance(data, str) else data)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def save_state(cfg: Config, state: dict) -> None:
    atomic_write(cfg.state_path, json.dumps(state, indent=2) + "\n")


def version_key(release: dict) -> tuple:
    def parts(v: str) -> list:
        return [int(p) if p.isdigit() else p for p in re.split(r"[.-]", v)]
    build = release.get("build", "0")
    return (parts(release["version"]), int(build) if str(build).isdigit() else 0)


def active_releases(state: dict) -> list[dict]:
    """Published, not withdrawn, files present; newest first."""
    rel = [r for r in state["releases"] if not r.get("withdrawn") and not r.get("pruned")]
    return sorted(rel, key=version_key, reverse=True)


# --- publishing ---------------------------------------------------------------

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def publish(cfg: Config, ipa: Path, notes: str = "", source_tag: str | None = None,
            expected_sha256: str | None = None, now: dt.datetime | None = None) -> dict:
    check = validate_ipa.validate(str(ipa), cfg.bundle_id, no_extensions=True, require_js_bundle=True)
    if check["errors"]:
        raise ValueError("IPA rejected: " + "; ".join(check["errors"]))
    digest = sha256_file(ipa)
    if expected_sha256 and digest != expected_sha256.lower():
        raise ValueError(f"SHA-256 mismatch: got {digest}, expected {expected_sha256}")

    state = load_state(cfg)
    for r in state["releases"]:
        if r["version"] == check["version"] and str(r["build"]) == str(check["build"]):
            if r["sha256"] == digest:
                return r  # idempotent re-publish
            raise ValueError(f"{check['version']} ({check['build']}) already published with different content")

    release_id = ID_SAFE.sub("-", f"{check['version']}-{check['build']}")
    name = f"{cfg.app_name}-{release_id}.ipa"
    target_dir = cfg.public / "releases" / release_id
    target_dir.mkdir(parents=True, exist_ok=True)
    tmp = target_dir / f".{name}.part"
    shutil.copyfile(ipa, tmp)
    os.chmod(tmp, 0o644)
    os.replace(tmp, target_dir / name)
    atomic_write(target_dir / f"{name}.sha256", f"{digest}  {name}\n")

    release = {
        "id": release_id,
        "version": check["version"],
        "build": str(check["build"]),
        "file": f"releases/{release_id}/{name}",
        "size": check["size"],
        "sha256": digest,
        "min_os_version": check.get("minimum_os_version"),
        "entitlements": check.get("entitlements", []),
        "privacy": check.get("privacy", {}),
        "notes": notes.strip(),
        "published_at": (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_tag": source_tag,
        "withdrawn": False,
    }
    state["releases"].append(release)
    save_state(cfg, state)
    generate(cfg, state)
    return release


def rollback(cfg: Config, to: str | None = None) -> dict:
    state = load_state(cfg)
    active = active_releases(state)
    if len(active) < 2 and to is None:
        raise ValueError("nothing to roll back to")
    target = next((r for r in active if r["id"] == to), None) if to else active[1]
    if target is None:
        raise ValueError(f"release {to} is not available")
    for r in state["releases"]:
        if not r.get("withdrawn") and version_key(r) > version_key(target):
            r["withdrawn"] = True
    save_state(cfg, state)
    generate(cfg, state)
    return target


def restore(cfg: Config, release_id: str) -> dict:
    state = load_state(cfg)
    for r in state["releases"]:
        if r["id"] == release_id:
            if r.get("pruned"):
                raise ValueError(f"release {release_id} was pruned; its IPA is gone")
            r["withdrawn"] = False
            save_state(cfg, state)
            generate(cfg, state)
            return r
    raise ValueError(f"unknown release {release_id}")


def prune(cfg: Config, keep: int | None = None) -> list[str]:
    keep = cfg.keep_releases if keep is None else keep
    state = load_state(cfg)
    ordered = sorted([r for r in state["releases"] if not r.get("pruned")], key=version_key, reverse=True)
    current = active_releases(state)[:1]
    removed = []
    for r in ordered[max(keep, 1):]:
        if r in current:
            continue
        shutil.rmtree(cfg.public / "releases" / r["id"], ignore_errors=True)
        r["pruned"] = True
        removed.append(r["id"])
    save_state(cfg, state)
    generate(cfg, state)
    return removed


# --- AltSource ----------------------------------------------------------------

def build_source(cfg: Config, state: dict) -> dict:
    url = lambda path: f"{cfg.base_url}/{path}"  # noqa: E731
    active = active_releases(state)
    latest = active[0] if active else None
    privacy = latest["privacy"] if latest else {}
    entitlements = latest["entitlements"] if latest else []
    return {
        "name": cfg.source_name,
        "identifier": cfg.source_identifier,
        "sourceURL": url("source.json"),
        "iconURL": url("icon.png"),
        "website": cfg.base_url,
        "tintColor": cfg.tint_color,
        "apps": [{
            "name": cfg.app_name,
            "bundleIdentifier": cfg.bundle_id,
            "developerName": cfg.developer_name,
            "subtitle": "Self-hosted fitness, nutrition and training",
            "localizedDescription": "Personal build for SideStore, running next to the "
                                    "official SparkyFitness app.",
            "iconURL": url("icon.png"),
            "tintColor": cfg.tint_color,
            "category": "lifestyle",
            "screenshots": [],
            "versions": [{
                "version": r["version"],
                "buildVersion": r["build"],
                "date": r["published_at"],
                "localizedDescription": r["notes"] or f"Build {r['build']}",
                "downloadURL": url(r["file"]),
                "size": r["size"],
                "sha256": r["sha256"],
                **({"minOSVersion": r["min_os_version"]} if r.get("min_os_version") else {}),
            } for r in active],
            # AltStore 2 / SideStore compare these with the app they install.
            "appPermissions": {
                "entitlements": entitlements,
                "privacy": privacy,
            },
        }],
        "news": [],
    }


def render_index(cfg: Config, state: dict) -> str:
    source_url = f"{cfg.base_url}/source.json"
    rows = []
    for r in sorted(state["releases"], key=version_key, reverse=True):
        status = "pruned" if r.get("pruned") else "withdrawn" if r.get("withdrawn") else "available"
        link = (f'<a href="{html.escape(r["file"])}">IPA</a>' if status != "pruned" else "")
        rows.append(
            f"<tr><td>{html.escape(r['version'])} ({html.escape(r['build'])})</td>"
            f"<td>{html.escape(r['published_at'])}</td><td>{status}</td>"
            f"<td><code>{r['sha256'][:16]}…</code></td><td>{link}</td></tr>")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(cfg.source_name)}</title>
<style>
:root {{ color-scheme: light dark; }}
body {{ font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }}
table {{ border-collapse: collapse; width: 100%; }} td, th {{ padding: .4rem; border-bottom: 1px solid #8884; text-align: left; }}
a.button {{ display: inline-block; padding: .6rem 1rem; border-radius: .5rem; background: {html.escape(cfg.tint_color)}; color: #fff; text-decoration: none; margin: .25rem 0; }}
</style></head><body>
<h1>{html.escape(cfg.source_name)}</h1>
<p><a class="button" href="sidestore://source?url={html.escape(source_url)}">Add to SideStore</a>
<a class="button" href="altstore://source?url={html.escape(source_url)}">Add to AltStore</a></p>
<p>Source URL: <code>{html.escape(source_url)}</code></p>
<table><thead><tr><th>Version</th><th>Published</th><th>Status</th><th>SHA-256</th><th></th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
</body></html>
"""


def generate(cfg: Config, state: dict | None = None) -> None:
    state = state or load_state(cfg)
    cfg.public.mkdir(parents=True, exist_ok=True)
    atomic_write(cfg.public / "source.json", json.dumps(build_source(cfg, state), indent=2) + "\n")
    atomic_write(cfg.public / "index.html", render_index(cfg, state))
    icon_src = Path(os.environ.get("ICON_PATH", "/app/icon.png"))
    if icon_src.exists() and not (cfg.public / "icon.png").exists():
        shutil.copyfile(icon_src, cfg.public / "icon.png")
        os.chmod(cfg.public / "icon.png", 0o644)


# --- GitHub releases ----------------------------------------------------------

def _request(cfg: Config, url: str, accept: str = "application/vnd.github+json"):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "sparky-release-server"})
    if cfg.github_token:
        req.add_header("Authorization", f"Bearer {cfg.github_token}")
    return urllib.request.urlopen(req, timeout=120)


def sync_github(cfg: Config, log=print) -> list[str]:
    """Publishes every new sideload release; returns the published ids."""
    if not cfg.github_repo:
        raise SystemExit("GITHUB_REPO is not set")
    with _request(cfg, f"https://api.github.com/repos/{cfg.github_repo}/releases?per_page=30") as resp:
        releases = json.load(resp)
    state = load_state(cfg)
    seen_tags = {r.get("source_tag") for r in state["releases"]}
    published = []
    for rel in sorted(releases, key=lambda r: r.get("created_at", "")):
        tag = rel.get("tag_name", "")
        if rel.get("draft") or not tag.startswith(cfg.tag_prefix) or tag in seen_tags:
            continue
        assets = {a["name"]: a for a in rel.get("assets", [])}
        ipa = next((a for n, a in assets.items() if n.endswith(".ipa")), None)
        sha_asset = assets.get(f"{ipa['name']}.sha256") if ipa else None
        if not ipa or not sha_asset:
            log(f"skip {tag}: IPA or .sha256 asset missing")
            continue
        try:
            with _request(cfg, sha_asset["url"], "application/octet-stream") as resp:
                expected = resp.read().decode().split()[0]
            meta = None
            if "release.json" in assets:
                with _request(cfg, assets["release.json"]["url"], "application/octet-stream") as resp:
                    meta = json.load(resp)
                if meta.get("sha256") and meta["sha256"] != expected:
                    raise ValueError("release.json and .sha256 disagree")
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / ipa["name"]
                with _request(cfg, ipa["url"], "application/octet-stream") as resp, open(path, "wb") as fh:
                    shutil.copyfileobj(resp, fh)
                release = publish(cfg, path, notes=rel.get("body") or "", source_tag=tag,
                                  expected_sha256=expected)
            published.append(release["id"])
            log(f"published {tag} as {release['id']}")
        except (ValueError, urllib.error.URLError, OSError) as exc:
            log(f"failed {tag}: {exc}")
    return published


def watch_github(cfg: Config, interval: int) -> None:
    generate(cfg)
    while True:
        try:
            new = sync_github(cfg)
            print(f"sync ok: {len(new)} new release(s)", flush=True)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            print(f"sync failed: {exc}", flush=True)
        if cfg.keep_releases > 0:
            prune(cfg)
        sys.stdout.flush()
        time.sleep(interval)


# --- CLI ----------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="SparkyFitness IPA release server")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("publish")
    p.add_argument("ipa", type=Path)
    p.add_argument("--notes", default="")
    p.add_argument("--notes-file", type=Path)
    p.add_argument("--source-tag")
    p.add_argument("--sha256")
    sub.add_parser("list")
    p = sub.add_parser("rollback")
    p.add_argument("--to")
    p = sub.add_parser("restore")
    p.add_argument("id")
    p = sub.add_parser("prune")
    p.add_argument("--keep", type=int)
    sub.add_parser("generate")
    p = sub.add_parser("watch-github")
    p.add_argument("--interval", type=int, default=int(os.environ.get("POLL_INTERVAL", "300")))
    p.add_argument("--once", action="store_true")
    args = parser.parse_args(argv)
    cfg = Config.from_env()

    try:
        if args.cmd == "publish":
            notes = args.notes_file.read_text() if args.notes_file else args.notes
            r = publish(cfg, args.ipa, notes, args.source_tag, args.sha256)
            print(json.dumps(r, indent=2))
        elif args.cmd == "list":
            state = load_state(cfg)
            current = (active_releases(state) or [{}])[0].get("id")
            for r in sorted(state["releases"], key=version_key, reverse=True):
                flag = "*" if r["id"] == current else " "
                status = "pruned" if r.get("pruned") else "withdrawn" if r.get("withdrawn") else ""
                print(f"{flag} {r['id']:<20} {r['published_at']}  {status}")
        elif args.cmd == "rollback":
            print(f"current release is now {rollback(cfg, args.to)['id']}")
        elif args.cmd == "restore":
            print(f"restored {restore(cfg, args.id)['id']}")
        elif args.cmd == "prune":
            print("pruned: " + (", ".join(prune(cfg, args.keep)) or "nothing"))
        elif args.cmd == "generate":
            generate(cfg)
        elif args.cmd == "watch-github":
            if args.once:
                generate(cfg)
                sync_github(cfg)
            else:
                watch_github(cfg, args.interval)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
