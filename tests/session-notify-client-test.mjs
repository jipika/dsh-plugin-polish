/**
 * dsh-plugin-polish client 半边 — 通知点击跳转到对应会话。
 * ---------------------------------------------------------------------------
 * 在 stub 环境里真跑 lib/client.js，让 sessionHealth 的轮询拿到一条
 * completed 事件，再点那条系统通知的 onclick，断言跳转链路：
 *
 *   ① 有 uiWorkspace 服务 → openSession(sessionId)（点击后窗口仍会聚焦）
 *   ② 会话已归档 → 先 unarchiveSession，落定后 openSession
 *   ③ 取不到服务（旧宿主 / ctx 缺失）→ 点侧栏行 [data-row-key="session:<id>"]
 *   ④ openSession 抛错 → 回落到点侧栏行，不吞掉整次点击
 *   ⑤ 行也不在 → 只聚焦，不抛
 *   ⑥ 裸调 apply() 不带 ctx 时点击通知不崩（hostCtx 为空走兜底）
 *
 * 跑法：node tests/session-notify-client-test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.POLISH_CLIENT || join(HERE, "..", "lib", "client.js");
const SESSION = "s-1";
const EVENT = { seq: 1, session: SESSION, kind: "completed", at: 1000, title: "壁纸排查" };

let pass = 0;
const failures = [];
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) pass += 1;
	else failures.push({ name, actual, expected });
}

/* ------------------------------------------------------------ stub DOM */

function element(tag) {
	const el = {
		tagName: tag.toUpperCase(),
		nodeType: 1,
		children: [],
		style: { setProperty() {}, removeProperty() {} },
		dataset: {},
		classList: { contains: () => false, toggle() {} },
		hasAttribute: () => false,
		getAttribute: () => null,
		setAttribute() {},
		removeAttribute() {},
		addEventListener() {},
		removeEventListener() {},
		appendChild(child) { el.children.push(child); return child; },
		contains: () => false,
		closest: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		matches: () => false,
		getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
	};
	return el;
}

/* --------------------------------------------------------------- harness */

/**
 * @param {object} options
 * @param {"granted"|"denied"} [options.permission] - Notification 权限。
 * @param {object|null} [options.services] - ctx.get 的服务表；null = 裸调（无 ctx）。
 * @param {boolean} [options.archived] - 会话是否在归档集里。
 * @param {boolean} [options.rowVisible] - 侧栏行是否已渲染。
 * @param {boolean} [options.openThrows] - openSession 是否抛错。
 */
function build({ permission = "granted", services = {}, archived = false, rowVisible = false, openThrows = false, withCtx = true } = {}) {
	const requests = [];
	const timers = [];
	const clock = { now: 1000 };
	const notifications = [];
	const calls = { open: [], unarchive: [], rowClicks: 0, focuses: 0 };

	const row = {
		children: [],
		click() { calls.rowClicks += 1; }
	};

	class FakeNotification {
		constructor(title, options) {
			this.title = title;
			this.options = options || {};
			this.closed = false;
			notifications.push(this);
		}
		close() { this.closed = true; }
	}
	FakeNotification.permission = permission;
	FakeNotification.requestPermission = () => Promise.resolve(permission);

	const doc = element("body");
	const document = {
		documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } },
		head: { querySelector: () => null, appendChild() {} },
		body: doc,
		styleSheets: [],
		createElement: () => element("style"),
		/* 行选择器只认 `[data-row-key="session:<id>"]`；其余（含 domTitle 的内部查询）一律 null。 */
		querySelector: (selector) => {
			if (!rowVisible) return null;
			return typeof selector === "string" && selector.indexOf('data-row-key="session:') >= 0 ? row : null;
		},
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener() {},
		removeEventListener() {}
	};

	const uiWorkspace = {
		openSession(id) {
			calls.open.push(id);
			if (openThrows) throw new Error("navigation refused");
		},
		unarchiveSession(id) {
			calls.unarchive.push(id);
			return Promise.resolve();
		}
	};
	const workspaces = {
		list: { getSnapshot: () => ({ archivedSessionIds: archived ? [SESSION] : [] }) }
	};
	const table = Object.assign({ uiWorkspace, workspaces }, services);
	const ctx = {
		get: (name) => table[name],
		slots: { inject() {}, register() { return {}; } },
		locale: { register() {}, bind: () => (k) => k }
	};

	const sandbox = {
		document,
		Notification: FakeNotification,
		getComputedStyle: () => ({ backgroundColor: "", webkitAppRegion: "" }),
		MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
		performance: { now: () => clock.now },
		requestAnimationFrame: () => 1,
		cancelAnimationFrame() {},
		setTimeout: (fn) => { timers.push(fn); return timers.length; },
		clearTimeout() {},
		Date: { now: () => clock.now },
		fetch: (url) => {
			requests.push(url);
			const payload = url.indexOf("since=") >= 0
				? { ok: true, cursor: 1, failures: [], events: [EVENT] }
				: { ok: true, cursor: 0, failures: [], events: [] };
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: { get: () => "application/json; charset=utf-8" },
				json: () => Promise.resolve(payload)
			});
		},
		console
	};
	const window = {
		document,
		addEventListener() {},
		removeEventListener() {},
		matchMedia: () => ({ matches: false, addEventListener() {} }),
		CSS: { escape: (text) => String(text).replace(/["\\]/g, "\\$&") },
		focus() { calls.focuses += 1; }
	};
	window.window = window;
	window.__ModuleLoader__ = { load: (d) => { sandbox.__def = d; } };
	sandbox.window = window;
	sandbox.self = window;
	sandbox.navigator = { platform: "MacIntel", userAgent: "node" };
	sandbox.location = { href: "http://localhost/", pathname: "/" };
	sandbox.HTMLElement = class {};

	const context = vm.createContext(sandbox);
	new vm.Script(readFileSync(SOURCE, "utf8"), { filename: SOURCE }).runInContext(context);
	const plugin = sandbox.__def.factory(() => ({}));
	plugin.apply(withCtx ? ctx : undefined);

	return {
		plugin, ctx, calls, requests, notifications, timers,
		/**
		 * 推进轮询：先让首次对齐落定，然后逐个跑掉排队的定时器
		 * （motionScale / parentState 也在用 setTimeout，所以要跳过无关回调），
		 * 直到通知出现或次数用尽。
		 */
		async drain() {
			await settle();
			for (let i = 0; i < 30 && notifications.length === 0; i += 1) {
				const next = timers.shift();
				if (typeof next !== "function") break;
				clock.now += 5000; // 轮询有 4s 节流：每跑一格都往前推时钟
				next();
				await settle();
			}
		}
	};
}

/** 冲干微任务链（fetch → then → then）。 */
async function settle() {
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function fireNotification(env) {
	await env.drain();
	const note = env.notifications[env.notifications.length - 1];
	if (!note || typeof note.onclick !== "function") return { note: null };
	note.onclick();
	await settle();
	return { note };
}

/* --------------------------------------------- ① 服务在 → openSession */

{
	const env = build({});
	const { note } = await fireNotification(env);
	check("① 弹出了通知", Boolean(note), true);
	check("① 通知标题带会话名", note && note.title, "壁纸排查 · 已完成");
	check("① tag 按会话去重", note && note.options.tag, "polish-session-s-1");
	check("① 点了 openSession", env.calls.open, [SESSION]);
	check("① 没走侧栏行兜底", env.calls.rowClicks, 0);
	check("① 窗口照样聚焦", env.calls.focuses, 1);
	check("① 通知被关掉", note && note.closed, true);
}

/* --------------------------------------- ② 归档会话先取回再打开 */

{
	const env = build({ archived: true });
	const { note } = await fireNotification(env);
	check("② 弹出了通知", Boolean(note), true);
	check("② 先 unarchive", env.calls.unarchive, [SESSION]);
	check("② 落定后 openSession", env.calls.open, [SESSION]);
	check("② 窗口聚焦", env.calls.focuses, 1);
}

/* ------------------------------ ③ 服务缺失 → 点侧栏行 */

{
	const env = build({ services: { uiWorkspace: undefined }, rowVisible: true });
	const { note } = await fireNotification(env);
	check("③ 弹出了通知", Boolean(note), true);
	check("③ 没调用 openSession", env.calls.open, []);
	check("③ 点了侧栏行", env.calls.rowClicks, 1);
	check("③ 窗口聚焦", env.calls.focuses, 1);
}

/* ------------------------------ ④ openSession 抛错 → 落到点行 */

{
	const env = build({ rowVisible: true, openThrows: true });
	const { note } = await fireNotification(env);
	check("④ 弹出了通知", Boolean(note), true);
	check("④ openSession 抛了但被吞掉", env.calls.open, [SESSION]);
	check("④ 回落到点侧栏行", env.calls.rowClicks, 1);
	check("④ 窗口聚焦", env.calls.focuses, 1);
}

/* ------------------------------ ⑤ 什么都没有 → 只聚焦，不崩 */

{
	const env = build({ services: { uiWorkspace: undefined } });
	const { note } = await fireNotification(env);
	check("⑤ 弹出了通知", Boolean(note), true);
	check("⑤ 没点任何行", env.calls.rowClicks, 0);
	check("⑤ 仍然聚焦窗口", env.calls.focuses, 1);
	check("⑤ 通知照常关闭", note && note.closed, true);
}

/* ------------------------------ ⑥ 裸调 apply()（无 ctx）不崩 */

{
	const env = build({ withCtx: false });
	const { note } = await fireNotification(env);
	check("⑥ 弹出了通知", Boolean(note), true);
	check("⑥ hostCtx 为空时只用兜底", env.calls.open, []);
	check("⑥ 窗口聚焦", env.calls.focuses, 1);
}

/* -------------------------------------------------------------- 汇总 */

for (const f of failures) {
	console.log(`✗ ${f.name}  → got ${JSON.stringify(f.actual)}, want ${JSON.stringify(f.expected)}`);
}
console.log(`\n${pass}/${pass + failures.length} 通过`);
if (failures.length) process.exitCode = 1;
