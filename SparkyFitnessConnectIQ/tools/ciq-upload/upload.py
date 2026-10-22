"""Publishes a new version of the Sparky Strength beta app:

    venv\\Scripts\\python.exe upload.py <path-to.iq> <version>
    venv\\Scripts\\python.exe upload.py --submit-pending <version>

Uses the Edge profile signed in with login (the .bat on the desktop). Fills
Garmin's two-step form, including the final "Submit" on "Edit App Details".
The second command finishes a verified upload left by an older script.
Exits 2 when the session has expired (sign in again with the .bat)."""
import sys
sys.stdout.reconfigure(errors="replace")
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile-edge"
OUT = HERE / "probe"
OUT.mkdir(exist_ok=True)
BROWSER = {
    "channel": "msedge",
    "ignore_default_args": ["--enable-automation"],
    "args": ["--disable-blink-features=AutomationControlled"],
}
APP_URL = "https://apps-developer.garmin.com/apps/72557e98-0839-42e3-925f-3f97907e6a12"

pending_only = len(sys.argv) == 3 and sys.argv[1] == "--submit-pending"
if pending_only:
    iq, version = None, sys.argv[2]
elif len(sys.argv) == 3:
    iq, version = Path(sys.argv[1]).resolve(), sys.argv[2]
else:
    sys.exit("usage: upload.py <path-to.iq> <version> | --submit-pending <version>")
if iq is not None and not iq.is_file():
    sys.exit(f"no such file: {iq}")

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=True,
        viewport={"width": 1400, "height": 1000}, **BROWSER)
    page = ctx.new_page()
    page.goto(APP_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(8000)
    action = page.get_by_text(
        "Edit Details" if pending_only else "Upload New Version", exact=True
    )
    if action.count() == 0:
        page.screenshot(path=str(OUT / "upload-failed.png"))
        print("not signed in or app action unavailable: run the login .bat again")
        sys.exit(2)
    action.first.click()
    if not pending_only:
        page.wait_for_timeout(3000)
        with page.expect_file_chooser() as chooser:
            page.get_by_text("Choose file", exact=True).first.click()
        chooser.value.set_files(str(iq))
        page.fill("#app-version", version)
        page.wait_for_timeout(1500)
        publish = page.get_by_role("button", name="Upload and publish")
        publish.wait_for(state="visible")
        if not publish.is_enabled():
            page.screenshot(path=str(OUT / "upload-failed.png"), full_page=True)
            print("'Upload and publish' stays disabled; see probe\\upload-failed.png")
            sys.exit(1)
        publish.click()
    try:
        page.get_by_text("Edit App Details").first.wait_for(timeout=90000)
    except Exception:
        page.screenshot(path=str(OUT / "upload-failed.png"), full_page=True)
        print("Garmin did not accept the file; see probe\\upload-failed.png")
        sys.exit(1)
    text = page.inner_text("body")
    if f"Version: {version}" not in text or "Status: Verified" not in text:
        page.screenshot(path=str(OUT / "upload-failed.png"), full_page=True)
        print("wrong or unverified version; see probe\\upload-failed.png")
        sys.exit(1)
    submit = page.get_by_role("button", name="Submit", exact=True)
    submit.wait_for(state="visible")
    if not submit.is_enabled():
        page.screenshot(path=str(OUT / "upload-failed.png"), full_page=True)
        print("final Submit is disabled; see probe\\upload-failed.png")
        sys.exit(1)
    submit.click()
    try:
        page.wait_for_url(APP_URL, timeout=90000)
    except Exception:
        page.screenshot(path=str(OUT / "upload-failed.png"), full_page=True)
        print("Garmin did not return to the app page after Submit")
        sys.exit(1)
    page.screenshot(path=str(OUT / "upload-result.png"), full_page=True)
    print(f"submitted {version}; check the store version after Garmin processes it")
    ctx.close()
