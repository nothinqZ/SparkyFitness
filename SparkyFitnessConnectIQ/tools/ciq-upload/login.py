"""Opens the Garmin Connect IQ developer dashboard in a separate browser
profile (sparky-ciq-upload\\profile) so you can sign in once. The profile keeps
the session; upload.py then publishes new watch app versions without you.
Your normal browser and its passwords are not touched."""
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile-edge"
# Installed Microsoft Edge instead of the bundled Chromium, without the
# automation switch: Garmin's sign-in refuses browsers that announce they are
# remote-controlled ("unexpected error"). The profile stays separate.
BROWSER = {
    "channel": "msedge",
    "ignore_default_args": ["--enable-automation"],
    "args": ["--disable-blink-features=AutomationControlled"],
}
APP_URL = "https://apps-developer.garmin.com/apps/72557e98-0839-42e3-925f-3f97907e6a12"

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=False, viewport=None, **BROWSER)
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    # The dashboard start page leads to Garmin's sign-in; the app page itself
    # just says "not found" until you are signed in.
    page.goto("https://apps-developer.garmin.com/")
    print("Bitte oben rechts bei Garmin anmelden (Sign In). Danach erscheinen")
    print("deine Apps. Dann einfach das Fenster schliessen.")
    try:
        page.wait_for_event("close", timeout=0)
    except Exception:
        pass
    ctx.close()
