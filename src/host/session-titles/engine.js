import { collectTitleInput } from './input.js'
import { generateTitle, TITLE_PROVIDER } from './generator.js'

function failure(code, message) { return Object.assign(new Error(message), { code }) }

/** Own automatic first-turn naming and explicit conversation-wide renames. */
export function createTitleEngine({ ctx, readConfig, collect = collectTitleInput, generate = generateTitle }) {
  const lifetime = new AbortController()
  const work = new Map()
  const pending = new Set()
  let stopped = false

  function titleSeq(session) { return ctx.sessionTitle.get(session)?.eventSeq ?? null }
  function ensureCurrent(session, operation, input) {
    operation.signal.throwIfAborted()
    if (stopped || ctx.sessions.get(session.id) !== session || work.get(session.id) !== operation) {
      throw failure('TITLE_STALE', '会话或命名组件已变化，本次标题未保存。')
    }
    const current = ctx.sessionTitle.get(session)
    // The native fallback may settle after turn/end. It is a placeholder,
    // so adopting it once must not cancel the first generated title.
    if (operation.titleSeq === null && current?.source.kind === 'fallback') {
      operation.titleSeq = current.eventSeq
    }
    if ((current?.eventSeq ?? null) !== operation.titleSeq
      || session.surface.contentGeneration !== input.surfaceGeneration) {
      throw failure('TITLE_STALE', '会话内容、分支或标题已变化，请重新命名。')
    }
  }

  async function run(session, scope, signal, endEvent) {
    if (stopped) throw failure('TITLE_DISABLED', '会话命名组件已关闭。')
    work.get(session.id)?.controller.abort(failure('TITLE_SUPERSEDED', '已启动较新的命名操作。'))
    const controller = new AbortController()
    const combined = AbortSignal.any([lifetime.signal, controller.signal, ...(signal ? [signal] : [])])
    const operation = { controller, signal: combined, titleSeq: titleSeq(session) }
    work.set(session.id, operation)
    try {
      const input = await collect(ctx, session, { scope, ...(endEvent ? { throughSeq: endEvent.seq } : {}) })
      if (scope === 'first-turn' && (input.firstTurn !== endEvent?.data.turn
        || input.firstTurnEndSeq !== endEvent.seq)) return undefined
      ensureCurrent(session, operation, input)
      const result = await generate(ctx, session, input, readConfig(), combined)
      ensureCurrent(session, operation, input)
      if (scope === 'conversation') {
        const accepted = ctx.sessionTitle.rename(session, result.title)
        return { title: accepted.title }
      }
      session.append('session/title', {
        title: result.title,
        messageSeqs: [...result.messageSeqs],
        source: { kind: 'provider', provider: TITLE_PROVIDER, model: result.model },
      })
      return { title: result.title }
    } finally {
      if (work.get(session.id) === operation) work.delete(session.id)
    }
  }

  function track(task) {
    pending.add(task)
    task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }

  const stopEvents = ctx.on('session/event', (session, event) => {
    if (event.type === 'session/title' && event.data.source.kind === 'user') {
      work.get(session.id)?.controller.abort(failure('TITLE_SUPERSEDED', '手动改名已取消自动命名。'))
    }
    if (event.type !== 'turn/end'
      || session.header.origin === 'subagent' || session.header.isSeeded || stopped) return
    const title = ctx.sessionTitle.get(session)
    if (title && title.source.kind !== 'fallback') return
    const task = track(run(session, 'first-turn', undefined, event))
    task.catch(error => {
      if (lifetime.signal.aborted || ['TITLE_SUPERSEDED', 'TITLE_STALE', 'TITLE_EMPTY_INPUT'].includes(error?.code)) return
      ctx.logger.warn(`会话自动命名失败（${error?.code ?? 'TITLE_FAILED'}）：${error.message}`)
    })
  }, { global: true })
  const stopDisposed = ctx.on('session/disposed', session => {
    work.get(session.id)?.controller.abort(failure('TITLE_STALE', '会话已卸载。'))
  }, { global: true })

  return {
    generate(session, signal) { return track(run(session, 'conversation', signal)) },
    dispose() {
      if (!stopped) {
        stopped = true
        stopEvents()
        stopDisposed()
        lifetime.abort(failure('TITLE_DISABLED', '会话命名组件已关闭。'))
      }
      return Promise.allSettled([...pending]).then(() => {})
    },
  }
}
