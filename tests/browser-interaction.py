"""QueueDock and session-switch regressions in a real Chromium DOM.

Run: python3 tests/browser-interaction.py
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright


SOURCE = Path(os.environ.get("POLISH_CLIENT", Path(__file__).resolve().parents[1] / "lib" / "client.js"))


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content("""
            <div data-row-key="session:a">会话 A</div>
            <div data-slot="conversation.session">
              <div data-conversation-scroll style="height:100px;overflow:auto">
                <div style="height:1000px">内容</div>
              </div>
              <div id="stream"></div>
              <div data-pending-steering><button id="copy">复制</button><button id="undo">撤销</button></div>
            </div>
            <div data-queue-dock>
              <ul class="fixture_list">
                <li class="fixture_row" style="height:36px"><span>消息一</span><button id="edit">编辑</button></li>
                <li class="fixture_row" style="height:36px"><span>消息二</span></li>
              </ul>
            </div>
        """)
        page.evaluate("""() => {
          document.documentElement.dataset.polishMotion = 'native';
          document.documentElement.dataset.polishImageZoom = 'native';
          window.__ModuleLoader__ = { load(def) { window.polishDefinition = def; } };
          window.clicks = { copy: 0, undo: 0, edit: 0 };
          for (const name of Object.keys(window.clicks)) {
            document.getElementById(name).addEventListener('click', () => window.clicks[name]++);
          }
          const original = Document.prototype.querySelectorAll;
          window.queueScans = 0;
          window.topologyScans = 0;
          Document.prototype.querySelectorAll = function(selector) {
            if (selector === "[data-queue-dock] ul[class$='_list'] > li") window.queueScans++;
            if (selector === '[data-slot="conversation.session.header"]' || selector === '[class$="_logoRow"]' || selector === '[data-conversation-scroll]' || selector === "[role='dialog']") window.topologyScans++;
            return original.call(this, selector);
          };
        }""")
        page.add_script_tag(content=SOURCE.read_text())
        page.evaluate("window.polishDefinition.factory(() => ({}))")
        assert page.locator(".polish-drag-handle").count() == 0, "plugin must not inject React children"
        assert page.evaluate("getComputedStyle(document.querySelector('.fixture_row'), '::before').content") == '"⠿"'

        page.evaluate("""() => {
          const scroller = document.querySelector('[data-conversation-scroll]');
          scroller.scrollTop = 320;
          document.querySelector('[data-row-key="session:a"]').click();
          document.querySelector('[data-slot="conversation.session"]').dataset.conversationSession = 'b';
        }""")
        page.wait_for_timeout(700)
        assert page.evaluate("document.querySelector('[data-conversation-scroll]').scrollTop") == 320, "session switch took over native scroll restore"

        before = page.evaluate("[window.queueScans, window.topologyScans]")
        page.evaluate("""() => {
          const stream = document.getElementById('stream');
          for (let i = 0; i < 300; i++) stream.appendChild(document.createElement('span'));
        }""")
        page.wait_for_timeout(100)
        assert page.evaluate("[window.queueScans, window.topologyScans]") == before, "streaming tokens woke unrelated observers"

        page.locator("#copy").click()
        page.locator("#undo").click()
        assert page.evaluate("window.clicks.copy === 1 && window.clicks.undo === 1"), "native candidate actions stopped responding"

        first = page.locator(".fixture_row").first
        second = page.locator(".fixture_row").nth(1)
        box = first.bounding_box()
        page.mouse.click(box["x"] + 20, box["y"] + box["height"] / 2)
        assert page.evaluate("[...document.querySelectorAll('.fixture_row')].map(x => x.textContent.trim())") == ["消息一编辑", "消息二"]

        target = second.bounding_box()
        page.mouse.move(box["x"] + 20, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + 20, target["y"] + target["height"] / 2 + 8, steps=5)
        page.mouse.up()
        assert page.evaluate("[...document.querySelectorAll('.fixture_row')].map(x => x.style.order)") == ["1", "0"], "visual drag did not reorder"
        assert page.evaluate("[...document.querySelectorAll('.fixture_row')].map(x => x.textContent.trim())") == ["消息一编辑", "消息二"], "drag moved React-owned DOM"
        page.locator("#edit").click()
        assert page.evaluate("window.clicks.edit") == 1, "native action stopped responding after drag"
        page.evaluate("""() => document.body.insertAdjacentHTML('beforeend',
          '<div data-queue-dock><ul class="second_list"><li class="second_row" style="height:36px">乙一</li><li class="second_row" style="height:36px">乙二</li></ul></div>')""")
        page.wait_for_timeout(80)
        second_group = page.locator(".second_row")
        lower = second_group.nth(1).bounding_box()
        upper = second_group.first.bounding_box()
        page.mouse.move(lower["x"] + 20, lower["y"] + lower["height"] / 2)
        page.mouse.down()
        page.mouse.move(lower["x"] + 20, upper["y"] + upper["height"] / 2 - 8, steps=5)
        page.mouse.up()
        assert page.evaluate("[...document.querySelectorAll('.second_row')].map(x => x.style.order)") == ["1", "0"], "second conversation visual order did not change"
        assert page.evaluate("[...document.querySelectorAll('.fixture_row')].map(x => x.style.order)") == ["1", "0"], "second conversation changed first conversation order"
        print("Chromium: session position stable; stream updates skip queue scans; candidate actions and visual drag work")
        browser.close()


if __name__ == "__main__":
    main()
