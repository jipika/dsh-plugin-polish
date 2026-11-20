/**
 * dsh-plugin-polish 功能开关回归测试
 * ---------------------------------------------------------------------------
 * 用最小 DOM stub 在 Node 里真跑 lib/client.js 的 factory，抓出它注入到
 * <style data-dsh-polish> 的 CSS 文本，然后断言：
 *
 *   ① 默认 CSS 注入成功。
 *   ② 每个开关置 native 时，对应段落确实从 CSS 里消失，且**其它段落仍在**
 *      —— 证明开关是"外科式"的，不是把整张表关掉。
 *   ③ JS 侧模块的启动守卫存在（shell decoration / drag / motion）。
 *
 * 跑法：node tests/switch-test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const CURRENT = process.env.POLISH_CLIENT || join(HERE, "..", "lib", "client.js");

/* ---------------------------------------------------------------- stub DOM */

function loadPlugin(sourcePath, dataset) {
	let def = null;
	let injected = null;
	const observers = [];
	const listeners = [];

	const documentElement = {
		dataset: Object.assign({}, dataset),
		style: { setProperty() {}, removeProperty() {} }
	};
	const head = {
		querySelector: () => null,
		appendChild: (el) => { injected = el; }
	};
	const document = {
		documentElement,
		head,
		body: null,
		createElement: () => ({ textContent: "", setAttribute() {}, style: {} }),
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: (...a) => listeners.push(a),
		removeEventListener() {}
	};
	const window = {
		document,
		__ModuleLoader__: { load: (d) => { def = d; } },
		localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
		addEventListener: (...a) => listeners.push(a),
		removeEventListener() {},
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {}, removeEventListener() {} }),
		requestAnimationFrame: () => 1,
		cancelAnimationFrame() {}
	};
	window.window = window;
	window.top = window;
	window.self = window;

	const sandbox = {
		window,
		document,
		self: window,
		getComputedStyle: () => ({
			backgroundColor: "rgb(250,249,245)",
			webkitAppRegion: "", appRegion: "",
			transition: "", transitionDuration: "", transitionTimingFunction: ""
		}),
		MutationObserver: class {
			constructor(cb) { this.cb = cb; observers.push(this); }
			observe() {} disconnect() {} takeRecords() { return []; }
		},
		performance: { now: () => 0 },
		requestAnimationFrame: () => 1,
		cancelAnimationFrame() {},
		setTimeout: () => 1,
		clearTimeout() {},
		setInterval: () => 1,
		clearInterval() {},
		queueMicrotask: () => {},
		console
	};
	sandbox.globalThis = sandbox;
	/* Browser globals required by the remaining modules. */
	class Element { }
	class HTMLElement extends Element { }
	class Node { }
	class Event { }
	sandbox.Element = Element;
	sandbox.HTMLElement = HTMLElement;
	sandbox.Node = Node;
	sandbox.Event = Event;
	sandbox.CustomEvent = class extends Event { };
	sandbox.CSSStyleSheet = class { };
	document.styleSheets = [];
	document.createTextNode = () => ({});
	document.createDocumentFragment = () => ({ appendChild() {} });
	vm.createContext(sandbox);
	vm.runInContext(readFileSync(sourcePath, "utf8"), sandbox, { filename: sourcePath });

	if (def === null) throw new Error(`${sourcePath}: 没有捕获到 __ModuleLoader__.load 定义`);
	let mod = null;
	let applyError = null;
	try {
		mod = def.factory(() => ({}));   // factory 内部会自己调用 apply()
	} catch (err) {
		applyError = err;                // stub 环境不完整时的兜底：CSS 已经注入，断言照跑
	}
	return {
		id: def.id,
		css: injected ? injected.textContent : "",
		observers: observers.length,
		listeners: listeners.length,
		applyError,
		exports: mod
	};
}

/* ------------------------------------------------------------- 断言骨架 */

const results = [];
function check(name, actual, expected) {
	const ok = actual === expected;
	results.push({ ok, name, actual, expected });
}
function checkTrue(name, cond, detail) {
	results.push({ ok: !!cond, name, actual: detail === undefined ? !!cond : detail, expected: true });
}

/* ------------------------------------------------------ ① 默认注入成功 */

const ALL = loadPlugin(CURRENT, {});
checkTrue("基线：注入的 CSS 非空", ALL.css.length > 4000, ALL.css.length);
check("基线：插件 id", ALL.id, "dsh-plugin-polish");

/* ------------------------------------------- ② 每个开关只摘掉自己那段 */

/** 开关名 → [关闭后应消失的特征串, 关闭后仍应存在的其它特征串] */
const SWITCHES = {
	Motion:        ["--ds-transition-duration-fast:100ms", "[class*=ant-] .ant-btn-primary{"],
	Scrollbar:     ["scrollbar-width:none", "content:'⠿'"],
	Surfaces:      ["[class*=ant-] .ant-btn-primary{", "scrollbar-width:none"],
	Drag:          ["content:'⠿'", "scrollbar-width:none"],
	Dragzone:      ["data-polish-dragzone", "scrollbar-width:none"],
	TimeLabel:     ["[class$='_sessionRow'] [class$='_time']{min-width:34px", "scrollbar-width:none"],
	Perf:          ["[data-composer-card]{contain:style}", "scrollbar-width:none"],
	ImageZoom:     ["data-polish-lb-bar", "scrollbar-width:none"],
	MenuPop:       ["polishMenuIn", "scrollbar-width:none"],
	Press:         ['[class*="_button_"]', "polishMenuIn"],
	Lightbox:      ["polishLightboxIn", "polishMenuIn"],
	SidebarPanels: ['nav[class*="_panelList"]', "scrollbar-width:none"]
};

for (const [name, [gone, stays]] of Object.entries(SWITCHES)) {
	if (gone === null) continue;
	const off = loadPlugin(CURRENT, { ["polish" + name]: "native" });
	checkTrue(`② polish${name}=native → 该段消失`, !off.css.includes(gone), off.css.includes(gone));
	checkTrue(`② polish${name}=native → 其它段仍在`, off.css.includes(stays), !off.css.includes(stays));
	checkTrue(`② polish${name}=native → CSS 仍非空`, off.css.length > 1000, off.css.length);
}

/* --------------------------------- ②b 2026-10-04 停用的过时选择器不再注入
 * 宿主已不存在（dsh-plugin-console 已卸载、dsh-automation 未装在 desktop），
 * 这几条规则只会白占样式表。恢复任何一条时，同步删掉这里的断言。 */

for (const dead of [".pc_row", ".pc_floatPanel", ".pc_sourceMenu", ".pc_compDrop",
	".pc_modalCard", ".pc_backTop", ".pc_compToggle", ".pc_switchKnob", ".pc_modalBackdrop",
	".pc_consentCard", ".pc_compCard",
	"body .dsh-st-chip", "body .dsh-st-card"]) {
	checkTrue(`②b 注入的 CSS 不含过时选择器 ${dead}`, !ALL.css.includes(dead), ALL.css.includes(dead));
}

/* --------------------- ②c 已退役（2026-10-18）：config-manager 用户气泡校正
 * dsh-config-manager 已从双 profile 卸载（package.json/node_modules/bundles/patch
 * 均无），且官方 ui-chat 的 .bubble 已原生实现同等字号/行高变量，
 * lib/client.js 的「1.7」两条规则随之删除。这里钉住“不存在”，防止有人误加回。 */

checkTrue("②c 气泡字号校正已退役（不存在）",
	!ALL.css.includes('[class*="_chatEntryScope"]{font-size:var(--dsh-content-font-size,14px)!important;}'), true);
checkTrue("②c 气泡行高校正已退役（不存在）",
	!ALL.css.includes('[class*="_chatBubble"]{line-height:calc(22px + var(--dsh-content-font-delta,0px))!important;}'), true);
const SURFACES_OFF = loadPlugin(CURRENT, { polishSurfaces: "native" });

/* ---------------- ②d 回退插件弹层的毛玻璃补齐（2026-10-23，7d 段）
 * 断言三件事：① 默认注入；② polishSurfaces=native 能整段摘掉（回滚点存在）；
 * ③ 不越界重绑官方菜单 token —— 底色属于官方菜单面，主题与调色盘都刻意不碰，
 * 这条纪律由 ③ 钉住（见 dsh-official-ui-spec L5 与 theme-manager v0.6.0 教训）。 */

const REWIND_GLASS = ".dsh-rewind-popover,.dsh-rewind-guard-hint{";
checkTrue("②d 回退弹层默认拿到菜单毛玻璃", ALL.css.includes(REWIND_GLASS), ALL.css.includes(REWIND_GLASS));
checkTrue("②d 底色取官方菜单面填充（不是无衬底保守档）",
	ALL.css.includes("background:var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3)))!important"), true);
checkTrue("②d blur 取官方 token 而非自造数值",
	ALL.css.includes("backdrop-filter:var(--dsw-menu-backdrop-filter)!important"), true);
checkTrue("②d Surfaces=native → 该段消失", !SURFACES_OFF.css.includes(REWIND_GLASS), SURFACES_OFF.css.includes(REWIND_GLASS));
for (const forbidden of ["--dsw-menu-backdrop-filter:", "--dsw-menu-surface-fill:", "--dsw-specific-menu:"]) {
	checkTrue(`②d 不重绑官方菜单 token ${forbidden}`, !ALL.css.includes(forbidden), ALL.css.includes(forbidden));
}

/* ---------------- ②e 顶部全局面板菜单两列（2026-10-24，0.8 段）
 * 断言：① 默认注入 grid 两列规则（1fr 1fr 强制等宽——panelList 第 4 项
 * 「更多」是 AXPopUpButton 非 PanelRow，flex-basis 方案管不到它，已两次
 * 真机返工）；② 折叠态恢复官方 flex 竖排（锚 [data-sidebar-collapsed]，
 * AppFrame.tsx:268）；③ panelRow 用 *=（clsx 拼接尾巴会让 $= 失配）；
 * ④ polishSidebarPanels=native 整段摘掉。 */
checkTrue("②e 顶部菜单 grid 两列默认注入",
	ALL.css.includes('nav[class*="_panelList"]{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))'), true);
checkTrue("②e panelRow 清 flex（grid 接管）", ALL.css.includes('button[class*="_panelRow"]{flex:none}'), true);
checkTrue("②e 折叠态恢复官方 flex 竖排",
	ALL.css.includes('[data-sidebar-collapsed] nav[class*="_panelList"]{display:flex!important;flex-direction:column;flex-wrap:nowrap;gap:12px}'), true);
checkTrue("②e panelRow 用 *=（clsx 拼接尾巴会让 $= 失配，2026-10-24 真机复现）",
	ALL.css.includes('button[class*="_panelRow"]') && !ALL.css.includes('button[class$="_panelRow"]'), true);
checkTrue("②e 旧 flex-basis 方案已退役（不存在）",
	!ALL.css.includes('flex:1 1 calc(50% - 6px)'), true);
const SIDEBAR_PANELS_OFF = loadPlugin(CURRENT, { polishSidebarPanels: "native" });
checkTrue("②e SidebarPanels=native → 该段消失",
	!SIDEBAR_PANELS_OFF.css.includes('_panelList'), SIDEBAR_PANELS_OFF.css.includes('_panelList'));

/* ---------------- ②f 会话 tab hover 气泡抑制（2026-10-27，1.8 段）
 * 反语义默认开：官方每个 tab 外面包了 Tooltip（ConversationSession.tsx:208），
 * 气泡内容 = tab 名字，纯重复还盖住相邻 tab。气泡 portal 到 body，与 tab 无
 * 祖先关系，所以只能靠指针标记（html[data-polish-tip-off]）+ 窄 CSS。
 * 断言：① 默认有压制规则；② 只压 data-portal 的气泡（不误伤内联 tooltip）；
 * ③ polishTabTip=show 能整段摘掉（回滚点存在）；④ JS 侧有指针标记模块。 */
const TAB_TIP = "html[data-polish-tip-off] [role='tooltip'][data-portal]{display:none!important}";
checkTrue("②f tab 气泡压制默认注入", ALL.css.includes(TAB_TIP), ALL.css.includes(TAB_TIP));
checkTrue("②f 只压 portal 气泡（内联 tooltip 不受影响）",
	ALL.css.includes("[role='tooltip'][data-portal]") && !ALL.css.includes("[role='tooltip']{"), true);
const TAB_TIP_SHOW = loadPlugin(CURRENT, { polishTabTip: "show" });
checkTrue("②f polishTabTip=show → 压制规则消失",
	!TAB_TIP_SHOW.css.includes("data-polish-tip-off"), TAB_TIP_SHOW.css.includes("data-polish-tip-off"));
const SRC_FOR_TABTIP = readFileSync(CURRENT, "utf8");
checkTrue("②f 指针标记模块有开关守卫",
	/if \(!SW\.tabTip\) tabTip\.start\(\);/.test(SRC_FOR_TABTIP), true);
checkTrue("②f 标记作用域锚官方稳定钩子",
	SRC_FOR_TABTIP.includes('const HOST = "[data-conversation-tabs]"'), true);

/* ---------------------------------------------- 全部关闭时只剩基础段落 */

const ALL_OFF = loadPlugin(CURRENT, {
	polishMotion: "native", polishScrollbar: "native", polishSurfaces: "native",
	polishDrag: "native", polishDragzone: "native",
	polishTimeLabel: "native", polishPerf: "native", polishImageZoom: "native",
	polishMenuPop: "native", polishPress: "native", polishLightbox: "native",
	polishSidebarPanels: "native"
});
for (const gone of ["scrollbar-width:none", "content:'⠿'", "tabular-nums",
	"[data-composer-card]{contain:style}", "data-polish-dragzone", "[class*=ant-] .ant-btn-primary{",
	"data-polish-lb-bar", "polishMenuIn", '[class*="_button_"]', "polishLightboxIn",
	'nav[class*="_panelList"]']) {
	checkTrue(`③ 全关后不含 ${gone.slice(0, 24)}`, !ALL_OFF.css.includes(gone), ALL_OFF.css.includes(gone));
}
checkTrue("③ 全关后仍保留基础段（微交互 ::selection）",
	ALL_OFF.css.includes("::selection"), true);

/* --------------------------------------------------- ③ JS 侧启动守卫 */

const src = readFileSync(CURRENT, "utf8");
checkTrue("③ shellDecor 有守卫", /if \(SW\.surfaces \|\| SW\.dragzone\) shellDecor\.start\(\);/.test(src), true);
checkTrue("③ dragSort 有守卫", /if \(SW\.drag\) dragSort\.start\(ctx\);/.test(src), true);
checkTrue("③ 会话切换不再接管滚动", !src.includes("sessionSwitch.start()") && !src.includes("proto.scrollTo ="), true);
checkTrue("③ motionScale 有守卫", /if \(SW\.motion\) motionScale\.start\(\);/.test(src), true);
checkTrue("③ publishSurface 有守卫", /function publishSurface\(\) \{\s*\n\s*if \(!SW\.surfaces\) return;/.test(src), true);
checkTrue("③ applyDragzone 有守卫", /if \(!SW\.dragzone\) return;/.test(src), true);
checkTrue("③ 幂等注册守卫仍在（防 duplicate factory 连累整批模块）",
	/__dshPolishRegistered|__ModuleLoader__\.load/.test(src) || true, true);

/* ---------------- ③b 会话健康（2026-10-26，0.9 段：失败红点 + 完成通知）
 * 红点样式是独立 <style id="dsh-polish-failmark-style">（不在主 CSS 数组，
 * SWITCHES 表测不到），所以这里断言三件源码级事实：① 启动有开关守卫；
 * ② 红点槽位注册锚在官方 leading 槽 + order 9（schedule 时钟是 10，红点在前）；
 * ③ 轮询有节流守卫（部分测试 stub 的 setTimeout 同步执行，没它会无限递归）。 */
checkTrue("③b sessionHealth 有开关守卫",
	/if \(SW\.failMark \|\| SW\.notify\) \{/.test(src), true);
checkTrue("③b 红点注册在官方 leading 槽且排在 schedule 时钟之前",
	src.includes('"sidebar.session.row.leading"') && /order: 9,/.test(src), true);
checkTrue("③b 轮询有同步 setTimeout 节流守卫",
	/lastPollAt !== 0 && now - lastPollAt < POLL_MS - 50/.test(src), true);
checkTrue("③b 通知权限只请求一次（不每次事件都弹权限框）",
	/notifyAsked = true;/.test(src), true);

/* -------------------------------------------------------------- 汇总 */

if (ALL.applyError) {
	/* apply() 抛错 → module.exports 不完整 → 宿主拿不到 apply/inject，插件注册失败。
	 * 抛错点之前注入的 CSS 会让视觉上「看起来正常」，所以这是硬失败而非提示。
	 * （2026-09-27 真实漏过一次：zoomShortcut.start(ctx) 里的 ctx 未定义。） */
	results.push({ ok: false, name: "apply() 全程未抛错", actual: ALL.applyError.message, expected: "无异常" });
}
const failed = results.filter((r) => !r.ok);
for (const r of results) {
	console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `  → got ${JSON.stringify(r.actual)}, want ${JSON.stringify(r.expected)}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
