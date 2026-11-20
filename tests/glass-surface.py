"""Glass-surface regression: the hardcoded frosted-glass values resolve.

Run: python3 tests/glass-surface.py

The rule this test protects (learned the hard way):
  **`[data-menu-backing]` must stay opaque on darwin.** It is the only thing the
  menu's `backdrop-filter` layer has to sample over native window vibrancy. Making
  it transparent deletes the blur entirely -- that is exactly how the frosted glass
  disappeared once, and the assertion below is what stops it happening again.

Checks:
  1. the darwin `.94` fill fallback is overridden down to the hardcoded value;
  2. the menu material carries the hardcoded blur, not the token;
  3. the backing is still opaque.
"""
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

SOURCE = Path(os.environ.get("POLISH_CLIENT", Path(__file__).resolve().parents[1] / "lib" / "client.js"))

CHROME = os.environ.get(
    "POLISH_CHROME",
    str(Path.home() / "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/"
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
)

FIXTURE = """
<!doctype html><html data-platform="darwin"><head><meta charset="utf-8"><style>
  /* Official tokens, including the darwin .94 hole we have to beat. */
  body {
    --dsw-menu-surface-fill: rgba(252, 253, 254, 0.70);
    --dsw-specific-menu: var(--dsw-menu-surface-fill);
    --dsw-alias-menu-group-header-fill: rgba(248, 249, 250, 0.94);
    --dsw-menu-backdrop-filter: blur(40px) saturate(150%);
    --dsw-alias-bg-base: rgb(255, 255, 255);
    background: #fff;
  }
  body[data-ds-dark-theme] {
    --dsw-menu-surface-fill: rgba(48, 49, 54, 0.64);
    --dsw-alias-menu-group-header-fill: rgba(48, 49, 54, 0.94);
    --dsw-alias-bg-base: rgb(21, 21, 23);
  }
  html[data-platform='darwin'] body { --dsw-specific-menu: rgba(248, 249, 250, 0.94); }
  html[data-platform='darwin'] body[data-ds-dark-theme] { --dsw-specific-menu: rgba(48, 49, 54, 0.94); }

  .panel {
    position: fixed; top: 40px; left: 40px; width: 260px; height: 120px;
    background: var(--dsw-specific-menu);
    border-radius: 12px;
  }
  /* Mirrors MenuSurface.module.css: a .material blur layer inside the surface,
     plus the darwin backing portal behind it. */
  .surface { position: fixed; top: 200px; left: 40px; width: 260px; height: 120px; }
  .material {
    position: absolute; inset: 0; border-radius: 12px;
    background: var(--dsw-menu-surface-fill);
    backdrop-filter: var(--dsw-menu-backdrop-filter);
  }
  .backing {
    position: fixed; top: 360px; left: 40px; width: 260px; height: 120px;
    background: var(--dsw-alias-bg-base);
    border-radius: 12px;
  }
</style></head><body>
  <div class="panel" id="panel"></div>
  <div class="surface" id="surface"><div class="material" id="material" data-menu-material></div></div>
  <div class="backing" id="backing" data-menu-backing></div>
</body></html>
"""


def extract_rules():
    """Pull the literal CSS strings out of the 7d-3 block, reassembling `+` joins."""
    src = SOURCE.read_text(encoding="utf-8")
    assert "---- 7d-3" in src, "7d-3 block missing"
    start = src.index("---- 7d-3")
    end = src.index("] : []),", start)
    block = src[start:end]
    joined = re.sub(r'"\s*\+\s*"', "", block)
    return re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', joined)


def alpha_of(color):
    assert color.startswith("rgba"), f"not translucent: {color}"
    return float(color.rstrip(")").rsplit(",", 1)[1].strip())


def main():
    rules = extract_rules()
    assert rules, "no CSS rules extracted from the 7d-3 block"
    joined = "\n".join(rules)
    assert re.search(r"\[data-menu-backing\][^{]*\{[^}]*transparent", joined) is None, (
        "7d-3 must NOT make [data-menu-backing] transparent -- that deletes the blur"
    )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
        page = browser.new_page(viewport={"width": 900, "height": 700})
        page.set_content(FIXTURE)

        before = page.evaluate("getComputedStyle(document.getElementById('panel')).backgroundColor")
        print("before (official darwin):", before)
        assert "0.94" in before, "fixture did not reproduce the darwin .94 hole"

        backing_before = page.evaluate("getComputedStyle(document.getElementById('backing')).backgroundColor")
        print("backing before:", backing_before)

        page.evaluate(
            """(rules) => {
                const el = document.createElement('style');
                el.textContent = rules.join('\\n');
                document.head.appendChild(el);
            }""",
            rules,
        )

        fill = page.evaluate("getComputedStyle(document.getElementById('panel')).backgroundColor")
        print("fill after:", fill)
        assert "0.94" not in fill, f"darwin .94 survived: {fill}"
        assert alpha_of(fill) < 0.5, f"fill not translucent enough: {fill}"

        header = page.evaluate(
            "getComputedStyle(document.body).getPropertyValue('--dsw-alias-menu-group-header-fill').trim()"
        )
        print("group header fill:", header)
        assert header in ("transparent", "rgba(0, 0, 0, 0)"), f"group header still solid: {header}"

        blur = page.evaluate("getComputedStyle(document.getElementById('material')).backdropFilter")
        print("menu material blur:", blur)
        assert "44px" in blur, f"hardcoded blur did not land on the material: {blur}"

        backing_after = page.evaluate("getComputedStyle(document.getElementById('backing')).backgroundColor")
        print("backing after:", backing_after)
        assert backing_after == backing_before, (
            f"backing changed ({backing_before} -> {backing_after}); it must stay opaque "
            "or the native-vibrancy blur has nothing to sample"
        )

        browser.close()

    print("\nPASS")


if __name__ == "__main__":
    main()
