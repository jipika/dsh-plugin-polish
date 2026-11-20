/**
 * dsh-plugin-polish client half — QueueDock reorder wiring.
 * ---------------------------------------------------------------------------
 * 在 stub DOM 里真跑 lib/client.js，把「拖一行 → 上报 host」这条链路拆开断言：
 *
 *   ① 拖拽落点改变顺序后，确实向 /plugins/dsh-plugin-polish/queue-order
 *      发了一次 POST，body.ids 是**新**的 id 顺序（不是原顺序）；
 *   ② 队列里有 in-flight echo 行（data-submission-echo）时不发请求
 *      （echo 没有 host 身份，映射只能靠猜）；
 *   ③ DOM 行数与 inbox 条数不一致时不发请求；
 *   ④ host 回 4xx → 视觉顺序回退成 host/DOM 顺序；
 *   ⑤ host 回 5xx → 保留视觉顺序（回退修不了服务端问题）；
 *   ⑥ 路由不存在（SPA fallback 回 HTML）→ 只尝试一次，之后不再打扰。
 *
 * 跑法：node tests/queue-order-client-test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.POLISH_CLIENT || join(HERE, "..", "lib", "client.js");
const ORDER_ROUTE = "/plugins/dsh-plugin-polish/queue-order";

let pass = 0;
const failures = [];
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) pass += 1;
	else failures.push({ name, actual, expected });
}

/* ------------------------------------------------------------ stub DOM */

/** A minimal element: children, attributes, class-name suffix matching. */
function element(tag, attrs = {}) {
	const el = {
		tagName: tag.toUpperCase(),
		nodeType: 1,
		/* Real DOM nodes report liveness; QueueDock's row scan filters on it, so
		 * the stub must too or every row is silently discarded. */
		isConnected: true,
		children: [],
		parentNode: null,
		attrs: { ...attrs },
		style: {
			_order: "",
			get order() { return this._order; },
			set order(v) { this._order = String(v); },
			setProperty(k, v) { this[k] = v; },
			removeProperty(k) { delete this[k]; },
			getPropertyValue(k) { return this[k] || ""; }
		},
		classList: { contains: () => false, toggle() {} },
		/* Browsers map `data-*` attributes onto `dataset`; the plugin reads
		 * `dataset.conversationSession`, so the stub must synthesize it. */
		get dataset() {
			const out = {};
			for (const [key, value] of Object.entries(el.attrs)) {
				if (!key.startsWith("data-")) continue;
				const camel = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
				out[camel] = String(value);
			}
			return out;
		},
		listeners: new Map(),
		get className() { return this.attrs.class || ""; },
		set className(v) { this.attrs.class = v; },
		hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); },
		getAttribute(name) { return this.attrs[name] ?? null; },
		setAttribute(name, v) { this.attrs[name] = v === undefined ? "" : String(v); },
		removeAttribute(name) { delete this.attrs[name]; },
		addEventListener(type, fn) { this.listeners.set(type, fn); },
		removeEventListener(type) { this.listeners.delete(type); },
		appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
		contains(node) {
			if (node === el) return true;
			return el.children.some((c) => c === node || c.contains?.(node));
		},
		closest(selector) {
			let node = el;
			while (node) {
				if (selectorMatches(node, selector)) return node;
				node = node.parentNode;
			}
			return null;
		},
		querySelector(selector) {
			for (const child of allDescendants(el)) if (selectorMatches(child, selector)) return child;
			return null;
		},
		querySelectorAll(selector) {
			return allDescendants(el).filter((n) => selectorMatches(n, selector));
		},
		getBoundingClientRect() {
			/* Rows are 40px tall and stacked, so drag maths is deterministic. */
			const index = el.parentNode ? el.parentNode.children.indexOf(el) : 0;
			return { top: index * 40, height: 40, left: 0, right: 400, bottom: index * 40 + 40 };
		},
		matches(selector) { return selectorMatches(el, selector); },
		fire(type, event) { el.listeners.get(type)?.(event); }
	};
	return el;
}

function allDescendants(node) {
	const out = [];
	for (const child of node.children) {
		out.push(child);
		out.push(...allDescendants(child));
	}
	return out;
}

/** Only the selectors this plugin actually uses. */
function selectorMatches(node, selector) {
	if (node.nodeType !== 1) return false;
	const cls = node.attrs.class || "";
	if (selector === "li") return node.tagName === "LI";
	if (selector === "[data-queue-dock]") return node.hasAttribute("data-queue-dock");
	if (selector === "[data-conversation-session]") return node.hasAttribute("data-conversation-session");
	if (selector === "[data-submission-echo]") return node.hasAttribute("data-submission-echo");
	if (selector === "ul[class$='_list']") return node.tagName === "UL" && cls.endsWith("_list");
	if (selector === "[data-queue-dock] ul[class$='_list'] > li") return node.tagName === "LI";
	return false;
}

/* --------------------------------------------------------------- harness */

function build({ rows = 3, echo = 0, hostIds, respond } = {}) {
	const requests = [];
	const doc = element("body");
	const root = element("div", { "data-conversation-session": "s-1" });
	const dock = element("div", { "data-queue-dock": "" });
	const panel = element("div");
	const list = element("ul", { class: "x_list" });
	dock.appendChild(panel);
	panel.appendChild(list);
	root.appendChild(dock);
	doc.appendChild(root);

	const rowNodes = [];
	for (let i = 0; i < rows; i += 1) {
		const li = element("li", { class: "x_row" });
		list.appendChild(li);
		rowNodes.push(li);
	}
	for (let i = 0; i < echo; i += 1) {
		const li = element("li", { class: "x_row", "data-submission-echo": "" });
		list.appendChild(li);
	}

	const ids = hostIds || rowNodes.map((_, i) => `m${i}`);
	const inbox = { "next-turn": ids.map((id) => ({ id })) };
	const sessions = {
		binding: (sid) => (sid === "s-1"
			? { session: { projections: { faceOf: () => ({ getSnapshot: () => inbox }) } } }
			: undefined)
	};

	let def = null;
	const document = {
		/* sessionHealth 轮询会往 requests 里混入对 /session-activity 的 GET，
		 * 与本测试的 POST 计数断言相冲 —— 按插件的开关约定在启动前关掉。 */
		documentElement: { dataset: { polishFailMark: "native", polishNotify: "native" }, style: { setProperty() {}, removeProperty() {} } },
		head: { querySelector: () => null, appendChild() {} },
		body: doc,
		/* motionScale sweeps the real page's stylesheets; an empty list keeps it
		 * a no-op here without disabling the module. */
		styleSheets: [],
		createElement: () => element("style"),
		querySelector: (s) => doc.querySelector(s),
		querySelectorAll: (s) => doc.querySelectorAll(s),
		getElementById: () => null,
		addEventListener() {},
		removeEventListener() {}
	};
	const sandbox = {
		document,
		getComputedStyle: () => ({ backgroundColor: "", webkitAppRegion: "" }),
		MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
		performance: { now: () => 0 },
		requestAnimationFrame: () => 1,
		cancelAnimationFrame() {},
		setTimeout: (fn) => { if (typeof fn === "function") fn(); return 1; },
		clearTimeout() {},
		fetch: (url, init) => {
			requests.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
			const spec = respond ? respond(requests.length) : { status: 200, json: true };
			return Promise.resolve({
				ok: spec.status >= 200 && spec.status < 300,
				status: spec.status,
				headers: { get: () => (spec.json ? "application/json; charset=utf-8" : "text/html") }
			});
		},
		console
	};
	const window = { document, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
	window.window = window;
	window.__ModuleLoader__ = { load: (d) => { def = d; } };
	sandbox.window = window;
	sandbox.self = window;
	sandbox.navigator = { platform: "MacIntel", userAgent: "node" };
	sandbox.location = { href: "http://localhost/", pathname: "/" };
	sandbox.HTMLElement = class {};

	const context = vm.createContext(sandbox);
	new vm.Script(readFileSync(SOURCE, "utf8"), { filename: SOURCE }).runInContext(context);
	const plugin = def.factory(() => ({}));
	plugin.apply({ get: (name) => (name === "sessions" ? sessions : undefined), slots: undefined, locale: undefined, sidebarRight: null });

	return { rows: rowNodes, list, requests, flush: () => new Promise((r) => setTimeout(r, 0)) };
}

/** Drag row `from` down past row `to` and drop it. */
async function dragDown(env, from, to) {
	const node = env.rows[from];
	const startY = from * 40 + 20;
	node.fire("pointerdown", {
		/* The grab handle is the pseudo-element strip 8–36px from the row's
		 * left edge; pressing anywhere else is an ordinary row click. */
		button: 0, clientX: 20, clientY: startY, pointerId: 1,
		preventDefault() {}
	});
	/* Past the next row's midpoint, so the swap is a real slot change. */
	const targetY = to * 40 + 25;
	node.fire("pointermove", { clientY: targetY, pointerId: 1 });
	node.fire("pointerup", { pointerId: 1 });
	await env.flush();
}

/* ------------------------------------------------------------- ① 正常上报 */

{
	const env = build({ rows: 3, respond: () => ({ status: 200, json: true }) });
	await dragDown(env, 0, 1);
	check("① 发了一次 POST", env.requests.length, 1);
	check("① 打到正确路由", env.requests[0].url, ORDER_ROUTE);
	check("① 带 session", env.requests[0].body.session, "s-1");
	check("① ids 是新顺序", env.requests[0].body.ids, ["m1", "m0", "m2"]);
}

/* ------------------------------------------------------- ② echo 行存在 */

{
	const env = build({ rows: 3, echo: 1, respond: () => ({ status: 200, json: true }) });
	await dragDown(env, 0, 1);
	check("② 有 echo 行时不上报（映射会靠猜）", env.requests.length, 0);
}

/* ---------------------------------------------------- ③ 行数与 inbox 不符 */

{
	const env = build({ rows: 3, hostIds: ["m0", "m1"], respond: () => ({ status: 200, json: true }) });
	await dragDown(env, 0, 1);
	check("③ 数量不匹配时不上报", env.requests.length, 0);
}

/* ------------------------------------------------------------ ④ 4xx 回退 */

{
	const env = build({ rows: 3, respond: () => ({ status: 409, json: true }) });
	await dragDown(env, 0, 1);
	const orders = env.rows.map((r) => r.style.order);
	check("④ 发过请求", env.requests.length, 1);
	check("④ 回退成 DOM 顺序", orders, ["0", "1", "2"]);
}

/* ------------------------------------------------------------ ⑤ 5xx 保留 */

{
	const env = build({ rows: 3, respond: () => ({ status: 500, json: true }) });
	await dragDown(env, 0, 1);
	const orders = env.rows.map((r) => r.style.order);
	check("⑤ 发过请求", env.requests.length, 1);
	check("⑤ 保留视觉顺序", orders, ["1", "0", "2"]);
}

/* -------------------------------------------------- ⑥ 路由不存在只试一次 */

{
	const env = build({ rows: 3, respond: () => ({ status: 200, json: false }) });
	await dragDown(env, 0, 1);
	check("⑥ 第一次会尝试", env.requests.length, 1);
	await dragDown(env, 1, 2);
	check("⑥ 第二次不再尝试", env.requests.length, 1);
}

/* -------------------------------------------------------------- 汇总 */

for (const f of failures) {
	console.log(`✗ ${f.name}  → got ${JSON.stringify(f.actual)}, want ${JSON.stringify(f.expected)}`);
}
console.log(`\n${pass}/${pass + failures.length} 通过`);
if (failures.length) process.exitCode = 1;
