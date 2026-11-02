const GENERATE_PATH = 'api/dsh-useful-tools/session-titles'
const STATUS_PATH = `${GENERATE_PATH}/status`

/** A generation may have committed even when its response was lost. */
export class TitleTransportError extends Error {
  constructor(message, { uncertain = false, status } = {}) {
    super(message)
    this.name = 'TitleTransportError'
    this.uncertain = uncertain
    this.status = status
  }
}

function messageOf(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : fallback
}

function invalidResponseMessage(response, writing) {
  if (response.status === 401 || response.status === 403) return `会话命名服务拒绝访问（HTTP ${response.status}），请检查登录状态与访问权限。`
  if (writing) return `会话命名服务返回了无效结果（HTTP ${response.status}），命名结果尚未确认。请关闭窗口并检查会话标题。`
  if (response.status === 404) return '找不到会话命名状态接口（HTTP 404），请检查插件是否已加载并刷新页面。'
  return `读取会话命名状态失败（HTTP ${response.status}）：服务未返回有效的状态数据。`
}

/** Same-origin transport for the Host's session-title component. */
export function createTitleTransport({ fetchImpl = (...args) => globalThis.fetch(...args), baseURI, origin } = {}) {
  async function request(method, body, { signal, timeoutMs = 15000 } = {}) {
    const base = baseURI ?? globalThis.document?.baseURI ?? globalThis.location?.href
    if (!base) throw new TitleTransportError('无法确定当前服务地址。')
    const url = new URL(method === 'POST' ? GENERATE_PATH : STATUS_PATH, base)
    const expectedOrigin = origin ?? globalThis.location?.origin
    if (expectedOrigin && url.origin !== expectedOrigin) throw new TitleTransportError('会话命名服务地址与当前页面不一致。')
    const controller = new AbortController()
    const writing = method === 'POST'
    let timedOut = false
    let rejectTimeout
    const timeout = new Promise((_, reject) => { rejectTimeout = reject })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      rejectTimeout(new TitleTransportError(writing ? '命名请求超时，结果尚未确认。请关闭窗口并检查会话标题。' : '读取会话命名状态超时。',
        { uncertain: writing }))
    }, timeoutMs)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      const perform = async () => {
        let response
        try {
          response = await fetchImpl(url, {
            method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
          })
        } catch (error) {
          if (signal?.aborted && !timedOut) throw error
          throw new TitleTransportError(writing ? '连接中断，命名结果尚未确认。请关闭窗口并检查会话标题。' : '无法读取会话命名状态，请检查连接。',
            { uncertain: writing })
        }
        let value
        try { value = await response.json() } catch {
          throw new TitleTransportError(invalidResponseMessage(response, writing),
            { uncertain: writing && ![401, 403].includes(response.status), status: response.status })
        }
        if (!response.ok) {
          throw new TitleTransportError(messageOf(value?.error, writing ? '生成会话名称失败。' : '读取会话命名状态失败。'),
            { uncertain: writing && response.status >= 500, status: response.status })
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new TitleTransportError(invalidResponseMessage(response, writing),
            { uncertain: writing, status: response.status })
        }
        return value
      }
      return await Promise.race([perform(), timeout])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  return {
    async status(options) {
      const value = await request('GET', undefined, options)
      if (typeof value.enabled !== 'boolean' || !['default', 'custom', 'switching', 'error'].includes(value.state)
          || (value.error !== undefined && typeof value.error !== 'string')) {
        throw new TitleTransportError('会话命名服务返回了无效状态。')
      }
      return { enabled: value.enabled, state: value.state, error: value.error ?? '' }
    },
    async generate(sessionId, options) {
      if (typeof sessionId !== 'string' || !sessionId) throw new TitleTransportError('无法确定要命名的会话。')
      const value = await request('POST', { action: 'generate', sessionId }, options)
      if (typeof value.title !== 'string' || !value.title.trim()) {
        throw new TitleTransportError('服务返回无效标题，命名结果尚未确认。请关闭窗口并检查会话标题。', { uncertain: true })
      }
      return value.title
    },
  }
}
