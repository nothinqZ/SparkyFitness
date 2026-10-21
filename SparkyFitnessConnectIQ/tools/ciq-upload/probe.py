"""Headless check of the developer dashboard session: saves a screenshot and
the HTML of the app page (and its upload page, if found) for inspection."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile-edge"
OUT = HERE / "probe"
OUT.mkdir(exist_ok=True)
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
    ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=True, viewport={"width": 1400, "height": 1000}, **BROWSER)
    page = ctx.new_page()
    page.goto(APP_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(10000)
    print("url:", page.url)
    print("title:", page.title())
    page.screenshot(path=str(OUT / "app.png"), full_page=True)
    (OUT / "app.html").write_text(page.content(), encoding="utf-8")
    links = page.eval_on_selector_all("a,button", "els => els.map(e => (e.innerText||'').trim() + ' -> ' + (e.getAttribute('href')||'')).filter(t => t.length > 4)")
    for l in links[:80]:
        print("  ", l)
    ctx.close()
