"""Publishes a new version of the Sparky Strength beta app:

    venv\\Scripts\\python.exe upload.py <path-to.iq> <version>

Uses the Edge profile signed in with login (the .bat on the desktop). Fills
Garmin's "Upload New Version" form and presses "Upload and publish", then
saves a screenshot of the result in probe\\. Exits 2 when the session has
expired (sign in again with the .bat)."""
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

iq, version = Path(sys.argv[1]).resolve(), sys.argv[2]
if not iq.is_file():
    sys.exit(f"no such file: {iq}")

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=True,
        viewport={"width": 1400, "height": 1000}, **BROWSER)
    page = ctx.new_page()
    page.goto(APP_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(8000)
    upload = page.get_by_text("Upload New Version", exact=True)
    if upload.count() == 0:
        page.screenshot(path=str(OUT / "upload-failed.png"))
        print("not signed in (no 'Upload New Version'): run the login .bat again")
        sys.exit(2)
    upload.first.click()
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
    # "Upload and publish" publishes once Garmin has verified the file; the
    # page then offers step 2 ("Edit App Details") for the store listing,
    # which stays as it is, so nothing more is submitted.
    try:
        page.get_by_text("Edit App Details").first.wait_for(timeout=90000)
    except Exception:
        page.screenshot(path=str(OUT / "upload-failed.png"), full_page=True)
        print("Garmin did not accept the file; see probe\\upload-failed.png")
        sys.exit(1)
    text = page.inner_text("body")
    page.screenshot(path=str(OUT / "upload-result.png"), full_page=True)
    if f"Version: {version}" in text and "Status: Verified" in text:
        print(f"published {version}")
    else:
        print("verified page without the expected version; see probe\\upload-result.png")
        sys.exit(1)
    ctx.close()
