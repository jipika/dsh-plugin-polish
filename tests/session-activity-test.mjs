/**
 * session-activity host-half smoke test — 失败红点 / 完成通知的数据源。
 *
 * activity 状态是模块级单例（生产中每进程只挂载一次），所以全部断言走
 * 一条连续事件流水线 + 绝对 seq，不按用例重置。
 *
 * 覆盖（node tests/session-activity-test.mjs，纯断言零依赖）：
 *   1. apply() 同时挂载 queue-order 与 session-activity，互不影响
 *   2. session/title 进标题表；turn/end error 进失败表并中继 failed 事件
 *   3. turn/start 清失败；turn/end completed 清失败并中继 completed 事件
 *   4. aborted / max-tokens / blocked 不中继也不进失败表
 *   5. GET ?since= 增量语义；无 since 只回失败表与 cursor（首次对齐）
 *   6. 非 GET 405、非 loopback 403
 *   7. 坏事件（缺 id / 缺 data）不抛、不进表、不推进 cursor
 *   8. session/disposed 清该会话失败与标题（事件流是历史，保留）
 */

import { apply } from "../lib/index.js";

let passed = 0;
let failed = 0;

function ok(cond, name) {
	if (cond) {
		passed += 1;
		console.log("  ✓ " + name);
	} else {
		failed += 1;
		console.error("  ✗ " + name);
	}
}

function eq(a, b, name) {
	const ja = JSON.stringify(a);
	const jb = JSON.stringify(b);
	ok(ja === jb, name + (ja === jb ? "" : " — got " + ja + ", want " + jb));
}

/** Mock host context：记录 effect / 事件订阅 / webServer 路由。 */
function makeCtx() {
	const routes = new Map();
	const listeners = new Map();
	return {
		ctx: {
			effect(fn) { return fn(); },
			on(name, handler) {
				listeners.set(name, handler);
				return () => listeners.delete(name);
			},
			webServer: { register(spec) { routes.set(spec.path, spec.handler); } },
		},
		routes,
		listeners,
	};
}

/** 假 req/res，收集 JSON 响应。 */
function call(handler, { method = "GET", url = "/plugins/dsh-plugin-polish/session-activity", peer = "127.0.0.1" } = {}) {
	return new Promise((resolve) => {
		const res = {
			statusCode: 0,
			headers: null,
			body: "",
			writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
			end(payload) { this.body = String(payload ?? ""); resolve(this); },
		};
		handler({ method, url, socket: { remoteAddress: peer } }, res);
	});
}

async function poll(activity, url) {
	const res = await call(activity, { url });
	return JSON.parse(res.body);
}

function sessionOf(id) { return { id }; }

console.log("session-activity host half");

/* ---- 1. 双路由挂载互不影响 ---------------------------------------------- */
const { ctx, routes, listeners } = makeCtx();
apply(ctx);
ok(routes.has("/plugins/dsh-plugin-polish/queue-order"), "queue-order 路由仍在");
ok(routes.has("/plugins/dsh-plugin-polish/session-activity"), "session-activity 路由已挂载");
ok(typeof routes.get("/plugins/dsh-plugin-polish/session-activity") === "function", "activity handler 可调用");

const onEvent = listeners.get("session/event");
const onDisposed = listeners.get("session/disposed");
const activity = routes.get("/plugins/dsh-plugin-polish/session-activity");

/* ---- 2. 标题 + 失败轮 ---------------------------------------------------- */
onEvent(sessionOf("s1"), { type: "session/title", time: 100, data: { title: "壁纸排查" } });
onEvent(sessionOf("s1"), { type: "turn/end", time: 200, data: { turn: 1, reason: { kind: "error", error: { message: "every account is rate-limited", code: "soft_rate" } } } });
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=0");
	eq(body.failures, [{ session: "s1", at: 200, code: "soft_rate", message: "every account is rate-limited" }], "失败进入失败表");
	eq(body.cursor, 1, "failed 事件 cursor=1");
	eq(body.events, [{ seq: 1, session: "s1", kind: "failed", at: 200, code: "soft_rate", message: "every account is rate-limited", title: "壁纸排查" }], "failed 事件中继带标题与 LlmFailure");
}

/* ---- 3. turn/start 清失败；completed 中继 -------------------------------- */
onEvent(sessionOf("s1"), { type: "turn/start", time: 300, data: { turn: 2 } });
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=1");
	eq(body.failures, [], "turn/start 清失败");
	eq(body.cursor, 1, "turn/start 不产生事件");
	eq(body.events, [], "turn/start 后无新事件");
}
onEvent(sessionOf("s1"), { type: "turn/end", time: 400, data: { turn: 2, reason: { kind: "completed" } } });
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=1");
	eq(body.failures, [], "completed 不进失败表");
	eq(body.events, [{ seq: 2, session: "s1", kind: "completed", at: 400, title: "壁纸排查" }], "completed 事件中继");
}

/* ---- 4. aborted / max-tokens / blocked：静默 ------------------------------ */
onEvent(sessionOf("s1"), { type: "turn/end", time: 500, data: { turn: 3, reason: { kind: "aborted", reason: { kind: "user" } } } });
onEvent(sessionOf("s1"), { type: "turn/end", time: 510, data: { turn: 4, reason: { kind: "max-tokens" } } });
onEvent(sessionOf("s1"), { type: "turn/end", time: 520, data: { turn: 5, reason: { kind: "blocked" } } });
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=2");
	eq(body.cursor, 2, "aborted/max-tokens/blocked 不推进 cursor");
	eq(body.failures, [], "它们也不进失败表");
}

/* ---- 5. since 增量 + 无 since 首次对齐 ------------------------------------ */
onEvent(sessionOf("a"), { type: "turn/end", time: 600, data: { turn: 1, reason: { kind: "completed" } } });
onEvent(sessionOf("b"), { type: "turn/end", time: 610, data: { turn: 1, reason: { kind: "error", error: { message: "boom" } } } });
onEvent(sessionOf("c"), { type: "turn/end", time: 620, data: { turn: 1, reason: { kind: "completed" } } });
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=3");
	eq(body.cursor, 5, "since 响应仍带全量 cursor");
	eq(body.events.map((e) => e.seq), [4, 5], "since=3 只回 seq>3");
	eq(body.failures.map((f) => f.session), ["b"], "失败表全量（只有 b 会话）");
}
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity");
	eq(body.events, [], "无 since 不回事件（首次对齐语义）");
	eq(body.cursor, 5, "无 since 仍带 cursor");
}
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=abc");
	eq(body.events, [], "非数字 since 视作未提供");
}

/* ---- 6. 门禁：405 / 403 --------------------------------------------------- */
{
	const res = await call(activity, { method: "POST" });
	ok(res.statusCode === 405, "POST → 405");
	const res2 = await call(activity, { peer: "10.0.0.8" });
	ok(res2.statusCode === 403, "非 loopback → 403");
}

/* ---- 7. 坏事件不抛 --------------------------------------------------------- */
onEvent(null, { type: "turn/end", time: 700, data: { reason: { kind: "completed" } } });
onEvent({ id: "s2" }, null);
onEvent({ id: "s2" }, { type: "turn/end" });
onEvent({ id: "s2" }, { type: "message/append", time: 710, data: {} });
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=5");
	eq(body.cursor, 5, "坏事件不推进 cursor");
	eq(body.failures.map((f) => f.session), ["b"], "坏事件不进失败表");
}

/* ---- 8. session/disposed 清失败与标题 -------------------------------------- */
onEvent(sessionOf("d"), { type: "session/title", time: 800, data: { title: "临时" } });
onEvent(sessionOf("d"), { type: "turn/end", time: 810, data: { turn: 1, reason: { kind: "error", error: { message: "x", code: "E1" } } } });
onDisposed(sessionOf("d"));
{
	const body = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=5");
	eq(body.failures.map((f) => f.session), ["b"], "dispose 清失败");
	eq(body.cursor, 6, "dispose 前 cursor=6");
	eq(body.events.map((e) => e.seq), [6], "dispose 前的 failed 事件仍在中继流（历史保留）");
	// dispose 后同会话再失败：标题表已清，事件不带标题
	onEvent(sessionOf("d"), { type: "turn/end", time: 820, data: { turn: 1, reason: { kind: "error", error: { message: "y", code: "E2" } } } });
	const body2 = await poll(activity, "/plugins/dsh-plugin-polish/session-activity?since=6");
	eq(body2.cursor, 7, "第二次失败 cursor=7");
	eq(body2.events[body2.events.length - 1].title, "", "dispose 后标题表已清");
}

console.log("\n结果: " + passed + " 通过, " + failed + " 失败");
process.exit(failed === 0 ? 0 : 1);
