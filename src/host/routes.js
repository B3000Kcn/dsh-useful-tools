const PATH = '/api/dsh-useful-tools/session-titles'
const MAX_BODY = 8192

async function readRequest(request) {
  const reader = request.body?.getReader()
  if (!reader) throw Object.assign(new Error('请求内容不能为空。'), { status: 400 })
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY) {
        await reader.cancel()
        throw Object.assign(new Error('命名请求过大。'), { status: 413 })
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('命名请求必须是 JSON 对象。'), { status: 400 }) }
  if (!value || Array.isArray(value) || value.action !== 'generate'
    || typeof value.sessionId !== 'string' || !value.sessionId.trim() || value.sessionId.length > 256
    || Object.keys(value).some(key => !['action', 'sessionId'].includes(key))) {
    throw Object.assign(new Error('命名请求的会话或操作无效。'), { status: 400 })
  }
  return value
}

/** Connection enforces owner authentication and same-origin access for this route. */
export function installTitleRoutes(ctx, service) {
  // DSH's streaming bridge always attaches a body, which Fetch forbids for GET.
  // Keep status separate so generation retains the bounded streaming reader.
  const read = ctx.connection.fetch.register({
    path: `${PATH}/status`, methods: ['GET'], requestBody: 'buffered',
    async fetch() {
      try {
        await service.titleControl.whenIdle()
        return Response.json(service.titleControl.getSnapshot())
      } catch {
        return Response.json({ code: 'TITLE_STATUS_FAILED', error: '读取会话命名状态失败。' }, { status: 500 })
      }
    },
  })
  let write
  try {
    write = ctx.connection.fetch.register({
      path: PATH, methods: ['POST'], requestBody: 'streaming',
      async fetch(request) {
        let committed = false
        try {
          await service.titleControl.whenIdle()
          const input = await readRequest(request)
          const state = service.titleControl.getSnapshot()
          if (!state.enabled || state.state !== 'custom' || !service.engine) {
            return Response.json({ code: 'TITLE_DISABLED', error: '会话命名组件未启用或尚未就绪。' }, { status: 409 })
          }
          // The native lookup enforces subagent ownership for live sessions too.
          const session = await ctx.typert.lookups.get('session')?.resolve(input.sessionId)
          if (!session) return Response.json({ code: 'TITLE_NOT_FOUND', error: '找不到此会话。' }, { status: 404 })
          const result = await service.engine.generate(session, request.signal)
          committed = true
          const flushed = await ctx.sessions.flush(session)
          if (!flushed) {
            return Response.json({ code: 'TITLE_SAVE_UNCONFIRMED', error: '标题已更新，但持久保存尚未确认。请核对标题后再操作。' }, { status: 500 })
          }
          return Response.json(result)
        } catch (error) {
          if (committed) {
            return Response.json({ code: 'TITLE_SAVE_UNCONFIRMED', error: '标题已更新，但持久保存尚未确认。请核对标题后再操作。' }, { status: 500 })
          }
          const status = error.status ?? (['TITLE_DISABLED', 'TITLE_STALE', 'TITLE_SUPERSEDED'].includes(error.code) ? 409 : 422)
          return Response.json({ code: error.code ?? 'TITLE_FAILED', error: error.message || '会话命名失败，原有标题已保留。' }, { status })
        }
      },
    })
  } catch (error) {
    read()
    throw error
  }
  return async () => { await write(); await read() }
}
