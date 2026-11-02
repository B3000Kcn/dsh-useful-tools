/** Collect the current human/model transcript without injected context or tools. */
function inputError(code, message) {
  return Object.assign(new Error(message), { code })
}

function optionalService(ctx, name) {
  return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
}

async function readLog(ctx, session) {
  const query = optionalService(ctx, 'sessionQuery')
  if (typeof query?.readSession === 'function') {
    const result = await query.readSession(session.id)
    if (!Array.isArray(result?.events)) throw inputError('TITLE_LOG_UNAVAILABLE', '会话日志不可用。')
    return result.events
  }
  // In 0.2.1-rc.2 Session has no asynchronous log reader of its own and the
  // sessionQuery service is optional. This compatibility fallback is used
  // only when that public reader is not installed.
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  throw inputError('TITLE_LOG_UNAVAILABLE', '需要会话日志读取服务。')
}

function visibleContent(message) {
  if (!Array.isArray(message?.content)) return []
  return message.content.filter(block => (block?.type === 'text' && typeof block.text === 'string')
    || block?.type === 'image')
}

function hasVisibleContent(content) {
  return content.some(block => block.type === 'image' || block.text.trim())
}

function eventMessage(session, event) {
  if (typeof session.deriveEventMessage === 'function') return session.deriveEventMessage(event)
  return event.type === 'user/message' ? event.data : event.data?.message
}

// A surface replacement can have a much newer log seq than the position it
// replaced. Follow its original position when locating the first turn.
function originalPosition(event, bySeq) {
  const visited = new Set()
  let current = event
  while (current && !visited.has(current.seq)) {
    visited.add(current.seq)
    const op = current.surfaceOp
    if (!op || typeof op !== 'object' || op.op !== 'replace') break
    const previous = bySeq.get(op.startSeq)
    if (!previous || previous.type !== current.type) break
    current = previous
  }
  return current?.seq ?? event.seq
}

function firstTurn(events, firstUser, bySeq, throughSeq) {
  const origin = originalPosition(firstUser, bySeq)
  let start
  for (const event of events) {
    if (event.seq > origin) break
    if (event.type === 'turn/start') start = event
    if (event.type === 'turn/end' && event.data?.turn === start?.data?.turn) start = undefined
  }
  if (!start) throw inputError('TITLE_FIRST_TURN_INCOMPLETE', '尚无法确定首轮会话的结束位置。')
  const end = events.find(event => event.seq >= origin && event.type === 'turn/end'
    && event.data?.turn === start.data?.turn)
  if (!end || (throughSeq !== undefined && end.seq > throughSeq)) {
    throw inputError('TITLE_FIRST_TURN_INCOMPLETE', '首轮回复尚未结束。')
  }
  return { turn: start.data.turn, endSeq: end.seq }
}

function validRoute(value) {
  if (typeof value?.provider !== 'string' || !value.provider || typeof value.model !== 'string' || !value.model) {
    return undefined
  }
  return { provider: value.provider, model: value.model }
}

function lastRoute(events, throughSeq) {
  let requestRoute
  let selectedRoute
  for (const event of events) {
    if (event.seq > throughSeq) break
    if (event.type === 'request/header') requestRoute = validRoute(event.data?.header?.config) ?? requestRoute
    else if (event.type === 'model/selection') selectedRoute = validRoute(event.data) ?? selectedRoute
  }
  return requestRoute ?? selectedRoute
}

function liveRoute(ctx, session) {
  const agent = optionalService(ctx, 'agents')?.get?.(session.id)
  // model.current() is public in 0.2.2-alpha.2; rc.2 instead exposes the
  // session's AgentOptions directly, which its request loop uses as its route.
  const selection = typeof agent?.model?.current === 'function' ? agent.model.current() : agent?.options
  return validRoute(selection)
}

/**
 * Collect a stable cut of the effective surface. `throughSeq`, when supplied,
 * is an inclusive log boundary. First-turn input requires its matching
 * `turn/end`; conversation input represents the current visible branch.
 *
 * Returned `messageSeqs` identify precisely the included human messages, and
 * `messages` retain all visible text and image blocks in surface order.
 */
export async function collectTitleInput(ctx, session, { scope = 'first-turn', throughSeq } = {}) {
  if (!session || typeof session.id !== 'string' || !Array.isArray(session.surface?.nodes)) {
    throw inputError('TITLE_SURFACE_UNAVAILABLE', '会话消息不可用。')
  }
  if (scope !== 'first-turn' && scope !== 'conversation') throw new TypeError('invalid title input scope')
  if (throughSeq !== undefined && (!Number.isSafeInteger(throughSeq) || throughSeq < 0)) {
    throw new TypeError('throughSeq must be a non-negative integer')
  }

  // The public reader is async: retry if a write changed the live surface or
  // log between the read and projection instead of mixing two observations.
  for (let attempt = 0; attempt < 3; attempt++) {
    const seq = session.seq
    const generation = session.surface.contentGeneration
    const events = await readLog(ctx, session)
    if (session.seq !== seq || session.surface.contentGeneration !== generation) continue
    if (!Number.isSafeInteger(seq) || events.length !== seq || events.some((event, index) => event.seq !== index)) continue
    const bySeq = new Map(events.map(event => [event.seq, event]))
    const nodes = [...session.surface.nodes]
    if (nodes.some(node => !bySeq.has(node))) continue
    const capturedThroughSeq = events.at(-1)?.seq ?? -1
    const upper = Math.min(throughSeq ?? capturedThroughSeq, capturedThroughSeq)
    const candidates = nodes.map(node => bySeq.get(node)).filter(event => event.seq <= upper)
    const firstIndex = candidates.findIndex(event => {
      if (event.type !== 'user/message') return false
      const message = eventMessage(session, event)
      return message?.role === 'user' && message.source?.kind === 'user' && hasVisibleContent(visibleContent(message))
    })
    if (firstIndex < 0) throw inputError('TITLE_EMPTY_INPUT', '会话中没有可用于命名的用户消息。')

    const first = candidates[firstIndex]
    const boundary = scope === 'first-turn' ? firstTurn(events, first, bySeq, throughSeq) : undefined
    const selected = []
    for (const event of candidates.slice(firstIndex)) {
      const message = eventMessage(session, event)
      if (event.type === 'user/message' && message?.role === 'user' && message.source?.kind === 'user') {
        if (boundary && originalPosition(event, bySeq) > boundary.endSeq) continue
        const content = visibleContent(message)
        if (hasVisibleContent(content)) {
          selected.push({ seq: event.seq, role: 'user', content })
        }
      } else if (event.type === 'assistant/message' && message?.role === 'assistant') {
        if (boundary && (event.data?.turn !== boundary.turn || originalPosition(event, bySeq) > boundary.endSeq)) continue
        const content = visibleContent(message)
        if (hasVisibleContent(content)) selected.push({ seq: event.seq, role: 'assistant', content })
      }
    }
    const messageSeqs = selected.filter(message => message.role === 'user').map(message => message.seq)
    if (!messageSeqs.length) throw inputError('TITLE_EMPTY_INPUT', '会话中没有可用于命名的用户消息。')
    const routeBoundary = boundary ? Math.min(upper, boundary.endSeq) : upper
    const route = lastRoute(events, routeBoundary) ?? liveRoute(ctx, session)
    return {
      messages: structuredClone(selected),
      messageSeqs,
      ...(route ? { route } : {}),
      hasImages: selected.some(message => message.content.some(block => block.type === 'image')),
      capturedThroughSeq,
      throughSeq: routeBoundary,
      surfaceGeneration: generation,
      ...(boundary ? { firstTurn: boundary.turn, firstTurnEndSeq: boundary.endSeq } : {}),
    }
  }
  throw inputError('TITLE_SURFACE_CHANGED', '读取会话时内容发生变化，请重试。')
}
