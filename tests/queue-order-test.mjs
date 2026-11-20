/**
 * dsh-plugin-polish host half — queue-order route regression.
 * ---------------------------------------------------------------------------
 * 用假 ctx / 假 agent.inbox 真跑 lib/index.js 的 handler，断言：
 *   ① 真排列 → 调一次 inbox.splice，并把 nextTurn 换成请求顺序；
 *   ② 非排列（少一条 / 多一条 / 重复 / 陈旧视图）→ 409，且**一次 splice 都不调**；
 *   ③ 队列里有非普通用户消息（goal / 问答回复）→ 409 not-plain，不 splice；
 *   ④ 顺序未变 → 200 changed:false，不写日志；
 *   ⑤ 非本地来源 / 非 POST / 坏 body → 403 / 405 / 400，全部 JSON；
 *   ⑥ 响应永远是 JSON（SPA fallback 不会插进来）。
 *
 * 跑法：node tests/queue-order-test.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = process.env.POLISH_HOST || join(HERE, "..", "lib", "index.js");
const mod = await import(`file://${TARGET}?t=${Date.now()}`);

let pass = 0;
const failures = [];
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) pass += 1;
	else failures.push({ name, actual, expected });
}

/* ------------------------------------------------------------- fakes */

function message(id, source = { kind: "user", rpcId: "r-" + id }) {
	return { id, source, content: [{ type: "text", text: id }] };
}

function makeAgent(ids, sources = {}) {
	let rows = ids.map((id) => message(id, sources[id]));
	const calls = [];
	const agent = {
		session: { id: "s-1" },
		inbox: {
			get nextTurn() { return rows; },
			splice(target, start, deleteCount, inserted) {
				calls.push({ target, start, deleteCount, inserted: inserted.map(m => m.id) });
				if (target !== "next-turn") throw new Error("unexpected target " + target);
				const next = rows.slice();
				next.splice(start, deleteCount, ...inserted);
				const seen = new Set();
				for (const m of next) {
					if (seen.has(m.id)) throw new Error(`message "${m.id}" is already pending`);
					seen.add(m.id);
				}
				rows = next;
				return [];
			},
		},
	};
	return { agent, calls, rows: () => rows };
}

function makeCtx(agents, opts = {}) {
	const routes = [];
	return {
		ctx: {
			agents: { get: (id) => agents[id] },
			webServer: { register: (route) => { routes.push(route); return () => {}; } },
			effect: (fn) => fn(),
			get: (name) => (name === "sessionProjections" ? opts.projections : undefined),
		},
		routes,
	};
}

function call(handler, { method = "POST", body, address = "127.0.0.1" } = {}) {
	return new Promise((resolve) => {
		const listeners = {};
		const req = {
			method,
			socket: { remoteAddress: address },
			on(event, fn) {
				(listeners[event] ||= []).push(fn);
				if (event === "end" || event === "data") {
					queueMicrotask(() => {
						if (body !== undefined) for (const f of listeners.data || []) f(Buffer.from(JSON.stringify(body)));
						for (const f of listeners.end || []) f();
					});
				}
				return req;
			},
			destroy() {},
		};
		const chunks = [];
		let status = 0;
		let headers = {};
		const res = {
			writeHead(code, hdrs) { status = code; headers = hdrs || {}; },
			end(text) {
				const raw = text === undefined ? "" : String(text);
				let parsed;
				try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
				resolve({ status, headers, body: parsed, raw });
			},
			getStatus: () => status,
		};
		void chunks;
		void handler(req, res);
	});
}

/* ------------------------------------------------------------- mount */

mod.apply(makeCtx({}).ctx);
const [route] = makeCtx({}).routes; // 只是确认 apply 会注册；下面用独立实例
check("① apply 注册了 exact 路由", (() => {
	const { ctx, routes } = makeCtx({});
	mod.apply(ctx);
	return routes.map(r => [r.kind, r.path]);
})(), [["exact", "/plugins/dsh-plugin-polish/queue-order"]]);

function handlerFor(agents, opts) {
	const { ctx, routes } = makeCtx(agents, opts);
	mod.apply(ctx);
	return routes[0].handler;
}

/* ----------------------------------------------------------- ① 正常重排 */

{
	const { agent, calls, rows } = makeAgent(["a", "b", "c", "d"]);
	const handler = handlerFor({ "s-1": agent });
	const res = await call(handler, { body: { session: "s-1", ids: ["d", "a", "c", "b"] } });
	check("① 状态 200", res.status, 200);
	check("① 响应 ok+changed", res.body, { ok: true, changed: true });
	check("① splice 只调一次", calls.length, 1);
	check("① splice 参数", [calls[0].target, calls[0].start, calls[0].deleteCount, calls[0].inserted],
		["next-turn", 0, 4, ["d", "a", "c", "b"]]);
	check("① 队列真的换了顺序", rows().map(m => m.id), ["d", "a", "c", "b"]);
}

/* --------------------------------------------------------- ② 拒绝路径 */

{
	const { agent, calls } = makeAgent(["a", "b", "c"]);
	const handler = handlerFor({ "s-1": agent });

	const stale = await call(handler, { body: { session: "s-1", ids: ["a", "b"] } });
	check("② 少一条 → 409", [stale.status, stale.body.reason], [409, "order-mismatch"]);
	check("② 少一条 → 带回真实顺序", stale.body.current, ["a", "b", "c"]);

	const extra = await call(handler, { body: { session: "s-1", ids: ["a", "b", "c", "zzz"] } });
	check("② 多一条 → 409", [extra.status, extra.body.reason], [409, "order-mismatch"]);

	const dup = await call(handler, { body: { session: "s-1", ids: ["a", "a", "b"] } });
	check("② 重复 id → 400", [dup.status, dup.body.reason], [400, "duplicate-id"]);

	const claimed = await call(handler, { body: { session: "s-1", ids: ["b", "c", "x"] } });
	check("② 队首被消费后的陈旧视图 → 409", [claimed.status, claimed.body.reason], [409, "order-mismatch"]);

	check("② 以上四次都没写日志", calls.length, 0);
}

/* ------------------------------------------------------- ③ 非普通消息 */

{
	const { agent, calls } = makeAgent(["a", "b"], { b: { kind: "goal" } });
	const handler = handlerFor({ "s-1": agent });
	const res = await call(handler, { body: { session: "s-1", ids: ["b", "a"] } });
	check("③ goal 行 → 409 not-plain", [res.status, res.body.reason, res.body.item], [409, "not-plain", "b"]);
	check("③ 没写日志", calls.length, 0);
}

{
	const { agent, calls } = makeAgent(["a", "b"], { a: { kind: "user-question-reply", callId: "c1" } });
	const handler = handlerFor({ "s-1": agent });
	const res = await call(handler, { body: { session: "s-1", ids: ["b", "a"] } });
	check("③ 问答回复行 → 409 not-plain", [res.status, res.body.reason], [409, "not-plain"]);
	check("③ 没写日志", calls.length, 0);
}

/* -------------------------------------------------------- ④ 顺序未变 */

{
	const { agent, calls } = makeAgent(["a", "b"]);
	const handler = handlerFor({ "s-1": agent });
	const res = await call(handler, { body: { session: "s-1", ids: ["a", "b"] } });
	check("④ 原顺序 → 200 changed:false", [res.status, res.body.changed], [200, false]);
	check("④ 不写日志", calls.length, 0);
}

/* -------------------------------------------------- ⑤ 传输层拒绝 */

{
	const { agent, calls } = makeAgent(["a", "b"]);
	const handler = handlerFor({ "s-1": agent });

	const get = await call(handler, { method: "GET" });
	check("⑤ GET → 405 + Allow", [get.status, get.headers.allow], [405, "POST"]);

	const remote = await call(handler, { address: "10.0.0.7", body: { session: "s-1", ids: ["b", "a"] } });
	check("⑤ 非本地 → 403", [remote.status, remote.body.reason], [403, "not-local"]);

	const bad = await call(handler, { body: { ids: ["b", "a"] } });
	check("⑤ 缺 session → 400", [bad.status, bad.body.reason], [400, "bad-request"]);

	const single = await call(handler, { body: { session: "s-1", ids: ["a"] } });
	check("⑤ 单条 → 400（无顺序可改）", [single.status, single.body.reason], [400, "bad-ids"]);

	const noAgent = await call(handler, { body: { session: "cold", ids: ["a", "b"] } });
	check("⑤ 冷会话 → 409 no-agent", [noAgent.status, noAgent.body.reason], [409, "no-agent"]);

	check("⑤ 以上都没写日志", calls.length, 0);
}

/* ------------------------------------------------- ⑥ 响应总是 JSON */

{
	const { agent } = makeAgent(["a", "b"]);
	const handler = handlerFor({ "s-1": agent });
	for (const opts of [
		{ method: "GET" },
		{ body: { session: "s-1", ids: ["b", "a"] } },
		{ body: {} },
		{ address: "192.168.1.9", body: { session: "s-1", ids: ["b", "a"] } },
	]) {
		const res = await call(handler, opts);
		check(`⑥ ${opts.method || "POST"} 是 JSON`, res.headers["content-type"], "application/json; charset=utf-8");
		check(`⑥ ${opts.method || "POST"} body 可解析`, typeof res.body, "object");
	}
}

/* ----------------------------------------------------- ⑦ subagent 锁 */

{
	const { agent, calls } = makeAgent(["a", "b"]);
	const handler = handlerFor({ "s-1": agent }, {
		projections: { snapshot: () => ({ values: { subagent: { mode: "one-shot" } } }) },
	});
	const res = await call(handler, { body: { session: "s-1", ids: ["b", "a"] } });
	check("⑦ 一次性 subagent → 409 not-mutable", [res.status, res.body.reason], [409, "not-mutable"]);
	check("⑦ 没写日志", calls.length, 0);
}

{
	const { agent, calls } = makeAgent(["a", "b"]);
	const handler = handlerFor({ "s-1": agent }, {
		projections: { snapshot: () => ({ values: { subagent: { mode: "continuable" } } }) },
	});
	const res = await call(handler, { body: { session: "s-1", ids: ["b", "a"] } });
	check("⑦ continuable subagent 允许重排", [res.status, res.body.changed, calls.length], [200, true, 1]);
}

/* ------------------------------------------------------------- 汇总 */

for (const f of failures) {
	console.log(`✗ ${f.name}  → got ${JSON.stringify(f.actual)}, want ${JSON.stringify(f.expected)}`);
}
console.log(`\n${pass}/${pass + failures.length} 通过`);
if (failures.length) process.exitCode = 1;
