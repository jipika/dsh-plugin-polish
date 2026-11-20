/**
 * dsh-plugin-polish — host half.
 *
 * The browser half owns presentation; the one thing it cannot do alone is
 * reorder the durable queue. `QueueAction` is a closed union
 * (`edit` / `remove` / `steer`) with no position parameter, so a drag that only
 * writes CSS `order` reorders the picture while the agent keeps walking the
 * original array. This route is the missing verb: it splices the agent's inbox,
 * so picture and send order come from one array.
 *
 * The inbox IS durable — `agent-loop/src/inbox.ts` folds every
 * `agent/inbox/spliced` event out of the session log, so a reorder survives a
 * restart exactly like an append does.
 *
 * Contract
 * --------
 *   POST /plugins/dsh-plugin-polish/queue-order
 *   { "session": "<sessionId>", "ids": ["<messageId>", …] }
 *
 * `ids` must be a permutation of the agent's current `next-turn` identities.
 * A stale list (the agent already claimed the head, another client edited the
 * queue) answers 409 with the current order, and the browser half drops back to
 * the host's own sequence — which is what React renders anyway.
 *
 * Every response is JSON, including 405 and the error paths: the shipped Web
 * composition owns the SPA fallback seat, which would otherwise answer an
 * unmatched POST with `index.html` and a 200. The browser half reads a non-JSON
 * answer as "host half not mounted", which is exactly what an un-restarted app
 * is.
 *
 * ## Why ordinary user messages only
 *
 * `inbox.splice()` runs with `discardRemoved = true`, so every replaced identity
 * emits `agent/inbox/discarded`. Two consumers care: `goal-round-driver` marks a
 * queued goal attempt cancelled, and `user-questions` releases a queued question
 * reply. Both match on their own message source, so a queue made of plain user
 * prompts is unaffected — but a queue holding a goal or question row must not be
 * reshuffled this way. Those markers live in `message.source.kind`, and the
 * handler refuses (409 `not-plain`) instead of guessing.
 *
 * ## The `canceled` label on a reorder
 *
 * A reorder is one splice with `inserted.length === removedCount`, and the inbox
 * stamps every removing splice `outcome: 'canceled'` — it has no "moved" verb.
 * That label is wrong on the event, so it is worth knowing exactly who reads it
 * and why none of them misfire on a permutation:
 *
 *   - `consumed-work` only counts a cancellation when `inserted.length === 0`;
 *     a permutation always re-inserts, so the turn accounting is untouched.
 *   - `goal-round-driver` / `user-questions` match on their own `source.kind`,
 *     which the plain-user gate above already excluded.
 *   - The client session's submission receipts are positional: a replaced index
 *     is remapped over `start`/`removedCount`/`inserted.length`, all equal here,
 *     so every echo keeps its own index and nothing is retired as failed.
 *
 * The one honest cost is history: replaying this session's log shows a
 * `canceled` splice where a move happened. That is a label, not a behaviour —
 * `agent/inbox/spliced` carries no `moved` variant to emit instead.
 */

/** Exact route path; the browser half hardcodes the same string. */
const ORDER_PATH = '/plugins/dsh-plugin-polish/queue-order'

/**
 * 会话健康（失败红点 + 完成通知）路由，与 ORDER_PATH 同约定：client 半轮询
 * 该端点拿 (a) 每会话最后一次失败（红点用）与 (b) 增量 turn/end 结果（通知用）。
 */
const ACTIVITY_PATH = '/plugins/dsh-plugin-polish/session-activity'

/** 中继的 turn/end 事件环形上限；client 以 since=cursor 增量拉取。 */
const MAX_ACTIVITY_EVENTS = 200

/** 失败消息截断上限；通知正文用不了更多。 */
const MAX_FAILURE_MESSAGE = 300

/** Hard cap on a request body; an id list is far below this. */
const MAX_BODY_BYTES = 64 * 1024

/** Hard cap on queue length; the dock collapses long queues anyway. */
const MAX_ITEMS = 200

/**
 * 会话健康状态。模块级单例：本半每进程只挂载一次；为空时 client 半把该
 * 路由视为「宿主半未挂载」。
 *   - failures: sessionId → 最近一次失败轮 ({ at, code, message })
 *   - events:   中继的 turn/end 结果，seq 单调递增（只收 completed/error，
 *                aborted / blocked / max-tokens 不值得打扰）
 *   - titles:   sessionId → 最近一条 `session/title` 事件的标题
 */
const activity = {
  cursor: 0,
  failures: new Map(),
  events: [],
  titles: new Map(),
}

/** Host services this half needs: the registry, and a route table to join. */
export const inject = ['agents', 'webServer']

/**
 * Mount the queue-order route. A failure here must never take the app down.
 * @param {object} ctx - Cordis host context carrying `agents` and `webServer`.
 */
export function apply(ctx) {
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: ORDER_PATH,
      handler: (req, res) => { void handle(ctx, req, res) },
    }))
  } catch (error) {
    console.error('[dsh-plugin-polish] queue-order route not mounted:', error)
  }
  // 会话健康：失败表 + 通知事件流。任何一步挂了都不影响 queue-order。
  try {
    ctx.effect(() => ctx.on('session/event', observeSessionEvent))
    ctx.effect(() => ctx.on('session/disposed', (session) => {
      const id = String(session?.id ?? '')
      if (!id) return
      activity.failures.delete(id)
      activity.titles.delete(id)
    }))
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: ACTIVITY_PATH,
      handler: (req, res) => { handleActivity(req, res) },
    }))
  } catch (error) {
    console.error('[dsh-plugin-polish] session-activity not mounted:', error)
  }
}

/**
 * Fold one session event into the health tables.turn/start clears the session's
 * failure (a new attempt supersedes the old one); turn/end either records the
 * failure (`reason.kind === 'error'`, LlmFailure facts verbatim) or clears it,
 * and completed/error outcomes are relayed for notifications.
 * @param {object} session - live Session carrying `.id`.
 * @param {object} event - session log event; only turn/* and session/title matter.
 */
function observeSessionEvent(session, event) {
  try {
    const id = String(session?.id ?? '')
    if (!id) return
    if (event?.type === 'session/title') {
      const title = event.data?.title
      if (typeof title === 'string' && title.trim() !== '') activity.titles.set(id, title.trim())
      return
    }
    if (event?.type === 'turn/start') {
      activity.failures.delete(id)
      return
    }
    if (event?.type !== 'turn/end') return
    const reason = event.data?.reason
    const kind = reason?.kind
    const at = typeof event.time === 'number' ? event.time : Date.now()
    if (kind === 'error') {
      const failure = reason.error ?? {}
      activity.failures.set(id, {
        at,
        code: typeof failure.code === 'string' ? failure.code : 'UNKNOWN',
        message: String(failure.message ?? '').slice(0, MAX_FAILURE_MESSAGE),
      })
    } else {
      activity.failures.delete(id)
    }
    if (kind !== 'completed' && kind !== 'error') return
    activity.events.push({
      seq: ++activity.cursor,
      session: id,
      kind: kind === 'error' ? 'failed' : 'completed',
      at,
      ...(kind === 'error' ? { code: activity.failures.get(id)?.code } : {}),
      ...(kind === 'error' ? { message: activity.failures.get(id)?.message } : {}),
      title: activity.titles.get(id) ?? '',
    })
    if (activity.events.length > MAX_ACTIVITY_EVENTS) {
      activity.events.splice(0, activity.events.length - MAX_ACTIVITY_EVENTS)
    }
  } catch {
    // 一个坏事件不能拖垮事件总线上的其它订阅者。
  }
}

/**
 * Answer one activity poll: the full failure table (small) plus, when
 * `since` is given, the relayed events past that cursor.
 * @param {import('node:http').IncomingMessage} req - HTTP request.
 * @param {import('node:http').ServerResponse} res - HTTP response.
 */
function handleActivity(req, res) {
  if (req.method !== 'GET') {
    send(res, 405, { ok: false, reason: 'method-not-allowed' }, { allow: 'GET' })
    return
  }
  // Read-only loopback snapshot, same posture as queue-order's not-local gate.
  if (!isLoopback(req.socket?.remoteAddress)) {
    send(res, 403, { ok: false, reason: 'not-local' })
    return
  }
  let since
  try {
    const raw = new URL(req.url, 'http://localhost').searchParams.get('since')
    if (raw !== null && Number.isFinite(Number(raw))) since = Number(raw)
  } catch {
    // 无 since / 可疑查询串 → 只回全量失败表，client 下轮再对齐游标。
  }
  const failures = [...activity.failures.entries()].map(([session, failure]) => ({ session, ...failure }))
  const events = since === undefined ? [] : activity.events.filter((item) => item.seq > since)
  send(res, 200, { ok: true, cursor: activity.cursor, failures, events })
}

/**
 * Answer one reorder request.
 * @param {object} ctx - host context (agents registry).
 * @param {import('node:http').IncomingMessage} req - HTTP request.
 * @param {import('node:http').ServerResponse} res - HTTP response.
 */
async function handle(ctx, req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, reason: 'method-not-allowed' }, { allow: 'POST' })
    return
  }
  // The GUI is a loopback app and this route mutates a live agent's queue, so it
  // answers the local machine only. A proxied/reverse-tunnelled peer keeps the
  // public address here and is refused.
  if (!isLoopback(req.socket?.remoteAddress)) {
    send(res, 403, { ok: false, reason: 'not-local' })
    return
  }
  let body
  try {
    body = await readJson(req)
  } catch {
    send(res, 400, { ok: false, reason: 'bad-body' })
    return
  }
  const sessionId = typeof body?.session === 'string' ? body.session : ''
  const ids = Array.isArray(body?.ids) ? body.ids : null
  if (sessionId.length === 0 || ids === null) {
    send(res, 400, { ok: false, reason: 'bad-request' })
    return
  }
  // Two is the floor: a one-item queue has no order to change, and an empty
  // splice would be a no-op the caller cannot distinguish from success.
  if (ids.length < 2 || ids.length > MAX_ITEMS || !ids.every(id => typeof id === 'string' && id.length > 0)) {
    send(res, 400, { ok: false, reason: 'bad-ids' })
    return
  }
  if (new Set(ids).size !== ids.length) {
    send(res, 400, { ok: false, reason: 'duplicate-id' })
    return
  }

  let agent
  try {
    agent = ctx.agents.get(sessionId)
  } catch (error) {
    send(res, 500, { ok: false, reason: 'internal', detail: String(error) })
    return
  }
  if (agent === undefined) {
    // A cold session has no live agent, and only a live one owns a queue.
    send(res, 409, { ok: false, reason: 'no-agent' })
    return
  }
  if (subagentLocked(ctx, agent)) {
    // Mirrors the dock's own `queueMutable` gate: a non-continuable subagent's
    // queue is not the user's to edit.
    send(res, 409, { ok: false, reason: 'not-mutable' })
    return
  }

  try {
    const current = agent.inbox.nextTurn
    const currentIds = current.map(message => String(message.id))
    if (currentIds.length < 2 || !sameSet(currentIds, ids)) {
      // Stale view, or the head was already claimed: hand back the truth so the
      // browser half can fall back instead of inventing an order.
      send(res, 409, { ok: false, reason: 'order-mismatch', current: currentIds })
      return
    }
    const special = current.find(message => !isPlainUserMessage(message))
    if (special !== undefined) {
      send(res, 409, { ok: false, reason: 'not-plain', item: String(special.id) })
      return
    }
    if (currentIds.every((id, index) => id === ids[index])) {
      send(res, 200, { ok: true, changed: false })
      return
    }
    const byId = new Map(current.map(message => [String(message.id), message]))
    const ordered = ids.map(id => {
      const message = byId.get(id)
      if (message === undefined) throw new Error(`queue item "${id}" vanished during reorder`)
      return message
    })
    // One splice expresses any permutation; the inbox rejects duplicate
    // identities itself, so a bad payload cannot duplicate a message.
    agent.inbox.splice('next-turn', 0, current.length, ordered)
    const applied = agent.inbox.nextTurn.map(message => String(message.id))
    if (!applied.every((id, index) => id === ids[index])) {
      send(res, 500, { ok: false, reason: 'not-applied', current: applied })
      return
    }
    send(res, 200, { ok: true, changed: true })
  } catch (error) {
    send(res, 500, { ok: false, reason: 'internal', detail: String(error) })
  }
}

/**
 * Whether a queued message is a plain user prompt. Anything carrying another
 * source kind (goal, user-question reply, subagent, team) is left alone because
 * replacing it emits a `discarded` those owners read as a cancellation.
 * @param {object} message - one pending UserMessage.
 * @returns {boolean} whether a reorder may safely replace it.
 */
function isPlainUserMessage(message) {
  return message?.source?.kind === 'user'
}

/**
 * Whether this agent's queue belongs to a non-continuable subagent, matching the
 * dock's `queueMutable` gate. A missing projection is not a lock: the read is
 * optional, exactly like the occupancy guard in dsh-composer-predict.
 * @param {object} ctx - host context.
 * @param {object} agent - live agent carrying the session.
 * @returns {boolean} whether queue mutations must be refused.
 */
function subagentLocked(ctx, agent) {
  try {
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) return false
    const identity = projections.snapshot(agent.session, ['subagent']).values.subagent
    return identity !== undefined && identity !== null && identity.mode !== 'continuable'
  } catch {
    return false
  }
}

/**
 * Whether an address is the local machine.
 * @param {string | undefined} address - socket peer address.
 * @returns {boolean} true for loopback (IPv4, IPv6, or IPv4-mapped).
 */
function isLoopback(address) {
  if (typeof address !== 'string') return false
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

/**
 * Compare two id lists as sets (lengths are checked by the caller).
 * @param {readonly string[]} left - current identities.
 * @param {readonly string[]} right - requested identities.
 * @returns {boolean} whether both lists hold the same identities.
 */
function sameSet(left, right) {
  if (left.length !== right.length) return false
  const known = new Set(left)
  return right.every(id => known.has(id))
}

/**
 * Read and parse a JSON request body under a hard byte cap.
 * @param {import('node:http').IncomingMessage} req - HTTP request.
 * @returns {Promise<unknown>} the parsed body.
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - HTTP response.
 * @param {number} status - HTTP status code.
 * @param {object} body - JSON body.
 * @param {Record<string, string>} [headers] - extra headers.
 */
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}
