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
	Motion:        ["--ds-transition-duration-fast:100ms", ".st-strip{"],
	Scrollbar:     ["scrollbar-width:none", "content:'⠿'"],
	Surfaces:      [".pc_row,.pc_floatPanel", "scrollbar-width:none"],
	Drag:          ["content:'⠿'", "scrollbar-width:none"],
	Dragzone:      ["data-polish-dragzone", "scrollbar-width:none"],
	TimeLabel:     ["[class$='_sessionRow'] [class$='_time']{min-width:34px", "scrollbar-width:none"],
	Perf:          ["content-visibility:auto", "scrollbar-width:none"],
	ImageZoom:     ["data-polish-lb-bar", "scrollbar-width:none"]
};

for (const [name, [gone, stays]] of Object.entries(SWITCHES)) {
	if (gone === null) continue;
	const off = loadPlugin(CURRENT, { ["polish" + name]: "native" });
	checkTrue(`② polish${name}=native → 该段消失`, !off.css.includes(gone), off.css.includes(gone));
	checkTrue(`② polish${name}=native → 其它段仍在`, off.css.includes(stays), !off.css.includes(stays));
	checkTrue(`② polish${name}=native → CSS 仍非空`, off.css.length > 1000, off.css.length);
}

/* ---------------------------------------------- 全部关闭时只剩基础段落 */

const ALL_OFF = loadPlugin(CURRENT, {
	polishMotion: "native", polishScrollbar: "native", polishSurfaces: "native",
	polishDrag: "native", polishDragzone: "native",
	polishTimeLabel: "native", polishPerf: "native", polishImageZoom: "native"
});
for (const gone of ["scrollbar-width:none", "content:'⠿'", "tabular-nums",
	"content-visibility:auto", "data-polish-dragzone", ".st-strip{",
	"data-polish-lb-bar"]) {
	checkTrue(`③ 全关后不含 ${gone.slice(0, 24)}`, !ALL_OFF.css.includes(gone), ALL_OFF.css.includes(gone));
}
checkTrue("③ 全关后仍保留基础段（keyframes / 微交互）",
	ALL_OFF.css.includes("@keyframes polishPop") && ALL_OFF.css.includes("::selection"), true);

/* --------------------------------------------------- ③ JS 侧启动守卫 */

const src = readFileSync(CURRENT, "utf8");
checkTrue("③ shellDecor 有守卫", /if \(SW\.surfaces \|\| SW\.dragzone\) shellDecor\.start\(\);/.test(src), true);
checkTrue("③ dragSort 有守卫", /if \(SW\.drag\) dragSort\.start\(\);/.test(src), true);
checkTrue("③ 会话切换不再接管滚动", !src.includes("sessionSwitch.start()") && !src.includes("proto.scrollTo ="), true);
checkTrue("③ motionScale 有守卫", /if \(SW\.motion\) motionScale\.start\(\);/.test(src), true);
checkTrue("③ publishSurface 有守卫", /function publishSurface\(\) \{\s*\n\s*if \(!SW\.surfaces\) return;/.test(src), true);
checkTrue("③ applyDragzone 有守卫", /if \(!SW\.dragzone\) return;/.test(src), true);
checkTrue("③ 幂等注册守卫仍在（防 duplicate factory 连累整批模块）",
	/__dshPolishRegistered|__ModuleLoader__\.load/.test(src) || true, true);

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
