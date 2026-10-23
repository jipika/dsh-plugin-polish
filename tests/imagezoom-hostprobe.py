"""imageZoom 宿主识别探针 —— 直接跑 lib/client.js 里真实的 hostOf/decorate/makeBar。

不复刻逻辑：把候选容器摆进 DOM，加载真插件，看哪些 img 拿到 data-polish-lb、
哪些 host 被插进 [data-polish-lb-bar]。

正例（应命中）
  A  官方灯箱 ImageLightbox：fixed backdrop > stage > img（img 距 fixed 祖先 2 层）

负例（都不该命中）
  B  正文流内图片（祖先全 static）
  C  增强图片查看器 .dcsiv-root：fixed inset:0 > workspace > stage > surface > img（正好 4 层）
  E  官方 Modal 根：fixed inset:0 > 卡片 > img
  F  第三方弹窗 .lc-modal-backdrop（dsh-context）：类名含 backdrop 词根
  G  顶栏头像：fixed 满宽条，但 img 嵌 6 层（用深度断言证明它靠「够不着」而非「识别对」而幸免）

说明
  D  theme-manager 壁纸层（fixed inset:0 > img，直接子）只在 type!=none 时挂载，
     本机 background.json 现为 type=none，故不构造，仅在此标注它是同类风险面。

Run: python3 tests/imagezoom-hostprobe.py
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

SOURCE = Path(os.environ.get("POLISH_CLIENT",
                             Path(__file__).resolve().parents[1] / "lib" / "client.js"))

VIEWPORT = {"width": 1280, "height": 720}

# 满宽一律用 inset:0 / left:0;right:0，不写死像素，避免随窗口漂移
FIXTURE = """
<style>
  * { box-sizing: border-box; }
  body { margin: 0; }
  img { width: 40px; height: 40px; }
</style>

<!-- A. 官方灯箱：backdrop 是 fixed+inset:0 -->
<div id="A" class="aB3cd4_backdrop" style="position:fixed;inset:0;z-index:1000">
  <div class="aB3cd4_stage" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
    <img id="A-img" class="aB3cd4_image" src="data:,a" alt="A">
  </div>
</div>

<!-- B. 会话正文里的普通图片，纯流内 -->
<div id="B"><img id="B-img" src="data:,b" alt="b"></div>

<!-- C. 增强图片查看器：root fixed inset:0，img 距 root 正好 4 层 -->
<div id="C" class="dcsiv-root" role="dialog" style="position:fixed;inset:0;z-index:1000">
  <div class="dcsiv-workspace" style="position:absolute;inset:0">
    <main class="dcsiv-stage" style="position:relative;display:grid;place-items:center">
      <div class="dcsiv-surface" style="position:relative">
        <img id="C-img" class="dcsiv-image" src="data:,c" alt="c">
      </div>
    </main>
  </div>
</div>

<!-- E. 官方 Modal 根：fixed inset:0，卡里一张图 -->
<div id="E" style="position:fixed;inset:0;z-index:1000;display:flex">
  <div style="margin:auto;padding:24px"><img id="E-img" src="data:,e" alt="e"></div>
</div>

<!-- F. dsh-context 弹窗：类名含 backdrop 词根（第一判据误伤） -->
<div id="F" class="lc-modal-backdrop" style="position:fixed;inset:0;display:flex">
  <div class="lc-modal-card" style="margin:auto"><img id="F-img" src="data:,f" alt="f"></div>
</div>

<!-- G. 顶栏满宽 fixed 条 + 深层嵌套头像（fixed 在第 6 层祖先） -->
<div id="G" style="position:fixed;top:0;left:0;right:0;height:48px">
  <div class="g1"><div class="g2"><div class="g3"><div class="g4"><div class="g5">
    <img id="G-img" src="data:,g" alt="g">
  </div></div></div></div></div>
</div>

<!-- H. 附件缩略图 button > img -->
<button id="H"><img id="H-img" src="data:,h" alt="h"></button>
"""

EXPECT = [
    ("A", True, "官方灯箱（应命中）"),
    ("B", False, "正文流内图"),
    ("C", False, "增强图片查看器 dcsiv"),
    ("E", False, "官方 Modal 根"),
    ("F", False, "dsh-context 弹窗 backdrop"),
    ("G", False, "顶栏深层头像"),
    ("H", False, "附件缩略图"),
]


def launch(playwright):
    """优先用 playwright 自带 Chromium；本机没装就退回系统 Edge/Chrome。"""
    for factory in (
        lambda: playwright.chromium.launch(headless=True),
        lambda: playwright.chromium.launch(headless=True, channel="msedge"),
        lambda: playwright.chromium.launch(headless=True, channel="chrome"),
    ):
        try:
            return factory()
        except Exception as err:  # noqa: BLE001 - 逐个兜底，最后一个错再抛
            last = err
    raise last


def main():
    with sync_playwright() as playwright:
        browser = launch(playwright)
        page = browser.new_page(viewport=VIEWPORT)
        page.set_content(FIXTURE)
        page.evaluate("""() => {
          const ds = document.documentElement.dataset;
          // 只留 imageZoom，其它模块关掉，排除干扰；imageZoom 保持默认（开）
          for (const k of ['Motion','Scrollbar','Surfaces','Drag','Dragzone',
                           'TimeLabel','Perf','TabMenu']) ds['polish' + k] = 'native';
          window.__ModuleLoader__ = { load(def) { window.polishDefinition = def; } };
        }""")
        page.add_script_tag(content=SOURCE.read_text())
        page.evaluate("window.polishDefinition.factory(() => ({}))")
        page.wait_for_timeout(150)

        # 先断言 fixture 拓扑没被将来改坏（深度是这些负例幸免的唯一原因）
        depth = page.evaluate("""() => {
          const fixedDepth = (id) => {
            let n = 0, box = document.getElementById(id).parentElement;
            while (box !== null) {
              if (getComputedStyle(box).position === 'fixed'
                  && box.clientWidth >= window.innerWidth - 2) return n;
              box = box.parentElement; n++;
            }
            return -1;
          };
          return { A: fixedDepth('A-img'), C: fixedDepth('C-img'),
                   E: fixedDepth('E-img'), G: fixedDepth('G-img'),
                   B: fixedDepth('B-img') };
        }""")
        assert depth["A"] == 1, f"A fixture 漂移：{depth}"
        assert depth["C"] == 3, f"C fixture 漂移：{depth}"
        assert depth["G"] >= 5, f"G fixture 被改浅了：{depth}"
        assert depth["B"] == -1, f"B fixture 混进了 fixed 满宽祖先：{depth}"

        report = page.evaluate("""() => {
          const out = {};
          for (const k of ['A','B','C','E','F','G','H']) {
            const img = document.getElementById(k + '-img');
            const host = img ? img.closest('[data-polish-lb-host]') : null;
            const bar = host ? host.querySelector(':scope > [data-polish-lb-bar]') : null;
            out[k] = {
              decorated: !!img && img.getAttribute('data-polish-lb') !== null,
              hasBar: !!bar,
              hostId: host ? host.id : null,
              barPos: bar ? getComputedStyle(bar).position + '/' + getComputedStyle(bar).bottom : null,
            };
          }
          out.totalBars = document.querySelectorAll('[data-polish-lb-bar]').length;
          return out;
        }""")

        print(f"视口 {VIEWPORT['width']}x{VIEWPORT['height']} · 真实 {SOURCE.name} · 只开 polishImageZoom\n")
        print(f"fixture 深度核对（img 到最近 fixed 满宽祖先的层数）：{depth}\n")

        bad = []
        for key, want, label in EXPECT:
            row = report[key]
            got = row["decorated"]
            if got != want:
                bad.append((key, label, row))
            verdict = "✓" if got == want else "✗"
            state = "挂上工具栏" if row["hasBar"] else ("仅打标" if got else "未处理")
            print(f"{verdict} {key} {label:<24} {'命中' if got else '未命中'}"
                  f"{'  → 宿主 #' + str(row['hostId']) + ' · bar=' + str(row['barPos']) if row['hasBar'] else ''}  [{state}]")

        print(f"\n页面上工具栏总数 = {report['totalBars']}（应只有 1 个：A）")
        if bad:
            print("\n误命中：")
            for key, label, row in bad:
                print(f"  · {key} {label} —— 宿主 #{row['hostId']}，"
                      f"其自带的底部操作区会被第二个工具栏压住")
            return 1
        print("\n无误命中")
        browser.close()
        return 0


if __name__ == "__main__":
    sys.exit(main())
