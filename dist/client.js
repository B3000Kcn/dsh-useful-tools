/* Generated from src/. */
window.__ModuleLoader__.load({id:'dsh-useful-tools',factory(require){
const factories={"src/client/index.js":function(local) {
const { createTitleTransport } = local("src/client/session-titles/transport.js");

const { createTitleStatus } = local("src/client/session-titles/status.js");

const { createTitleCatalog } = local("src/client/session-titles/catalog.js");

const { installRenameOverlay } = local("src/client/session-titles/overlay.js");

const { installSettings } = local("src/settings/index.js");

function createNotice() {
  let value = ''
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { if (next !== value) { value = next; for (const listener of [...listeners]) listener() } },
    dispose() { listeners.clear() },
  }
}

/** Browser entry; CSS is supplied by the bundle's in-memory build. */
function makePlugin(require, cssText = '') {
  const React = require('react')
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  return {
    inject: ['slots', 'configForms', 'connection', 'remote', 'remote.session'],
    apply(ctx) {
      const form = ctx.configForms.get('dsh-useful-tools')
      const transport = createTitleTransport()
      const status = createTitleStatus(transport)
      const catalog = createTitleCatalog(() => ctx.remote.session.modelCatalog())
      const notice = createNotice()
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = cssText
        document.head.append(style)
        return () => style.remove()
      })
      ctx.effect(() => {
        const sync = () => {
          const state = ctx.connection.state.getSnapshot()
          status.setConnection(state)
          catalog.setConnection(state)
          if (state === 'connected') void status.refresh()
        }
        const disposers = [ctx.connection.state.subscribe(sync), ctx.on('connection/reset', () => {
          sync()
          catalog.invalidate()
        })]
        disposers.push(ctx.remote.$on('plugin-manager/changed', () => { void status.refresh() }))
        disposers.push(ctx.remote.$on('settings/document-updated', () => { void status.refresh(); catalog.invalidate() }))
        for (const event of ['llm/adapters-updated', 'credentials/record-updated', 'credentials/reference-updated']) {
          disposers.push(ctx.remote.$on(event, () => { catalog.invalidate() }))
        }
        sync()
        return () => {
          for (const dispose of disposers) dispose()
          status.dispose()
          catalog.dispose()
          notice.dispose()
        }
      })
      installSettings({ ctx, React, form, status, catalog, notice })
      ctx.effect(() => installRenameOverlay({ ctx, React, primitives, transport, form, status, report: message => notice.set(message) }))
    },
  }
}

return {makePlugin};
},
"src/client/session-titles/transport.js":function(local) {
const GENERATE_PATH = 'api/dsh-useful-tools/session-titles'
const STATUS_PATH = `${GENERATE_PATH}/status`

/** A generation may have committed even when its response was lost. */
class TitleTransportError extends Error {
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
function createTitleTransport({ fetchImpl = (...args) => globalThis.fetch(...args), baseURI, origin } = {}) {
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

return {TitleTransportError,createTitleTransport};
},
"src/client/session-titles/status.js":function(local) {
const INITIAL = Object.freeze({ phase: 'connecting', enabled: false, state: 'default', error: '' })

/** Observe the Host's settled component status without background polling. */
function createTitleStatus(transport) {
  let snapshot = INITIAL
  let connected = false
  let disposed = false
  let generation = 0
  let controller
  const listeners = new Set()
  const publish = next => {
    if (disposed || (snapshot.phase === next.phase && snapshot.enabled === next.enabled
      && snapshot.state === next.state && snapshot.error === next.error)) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    setConnection(state) {
      const next = state === 'connected'
      if (connected === next && (next || snapshot.phase === 'offline')) return
      connected = next
      if (!next) {
        generation++
        controller?.abort()
        publish({ phase: state === 'disconnected' ? 'offline' : 'connecting', enabled: false, state: 'default', error: '' })
      }
    },
    async refresh() {
      if (!connected || disposed) return
      const current = ++generation
      controller?.abort()
      controller = new AbortController()
      if (snapshot.phase !== 'ready') publish({ phase: 'loading', enabled: false, state: 'default', error: '' })
      try {
        const result = await transport.status({ signal: controller.signal })
        if (!disposed && current === generation) publish({ phase: 'ready', ...result })
      } catch (error) {
        if (!disposed && current === generation) publish({ phase: 'error', enabled: false, state: 'error',
          error: error instanceof Error ? error.message : String(error) })
      }
    },
    dispose() { disposed = true; generation++; controller?.abort(); listeners.clear() },
  }
}

return {createTitleStatus};
},
"src/client/session-titles/catalog.js":function(local) {
const INITIAL = Object.freeze({ phase: 'connecting', groups: [], failures: [], error: '' })

/** Read the native model catalog without selecting a model for any conversation. */
function createTitleCatalog(readCatalog) {
  let snapshot = INITIAL
  let connected = false
  let disposed = false
  let generation = 0
  const listeners = new Set()
  const publish = next => {
    if (disposed) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    setConnection(state) {
      connected = state === 'connected'
      if (!connected) {
        generation++
        publish({ phase: state === 'disconnected' ? 'offline' : 'connecting', groups: [], failures: [], error: '' })
      } else if (snapshot.phase === 'offline' || snapshot.phase === 'connecting') {
        publish({ phase: 'idle', groups: [], failures: [], error: '' })
      }
    },
    invalidate() {
      if (!connected || disposed) return
      generation++
      publish({ ...snapshot, phase: 'idle', error: '' })
    },
    async refresh() {
      if (!connected || disposed || snapshot.phase === 'loading') return
      const current = ++generation
      publish({ ...snapshot, phase: 'loading', error: '' })
      try {
        const response = await readCatalog()
        if (!response?.ok || !Array.isArray(response.value?.groups) || !Array.isArray(response.value?.failures)) {
          throw new Error('读取模型列表失败。')
        }
        const groups = response.value.groups.map(group => {
          if (typeof group?.id !== 'string' || !group.id || !Array.isArray(group.models)) throw new Error('模型列表格式无效。')
          return { id: group.id, name: typeof group.name === 'string' && group.name ? group.name : group.id,
            models: group.models.map(model => {
              if (typeof model?.id !== 'string' || !model.id) throw new Error('模型列表格式无效。')
              return { id: model.id, name: typeof model.name === 'string' && model.name ? model.name : model.id }
            }) }
        })
        const failures = response.value.failures.map(item => ({ id: item?.id, name: item?.name, message: item?.message }))
        if (!disposed && current === generation) publish({ phase: 'ready', groups, failures, error: '' })
      } catch (error) {
        if (!disposed && current === generation) publish({ ...snapshot, phase: 'error',
          error: error instanceof Error ? error.message : String(error) })
      }
    },
    dispose() { disposed = true; generation++; listeners.clear() },
  }
}

return {createTitleCatalog};
},
"src/client/session-titles/overlay.js":function(local) {
const { createRenameDialog } = local("src/client/session-titles/dialog.js");

const SLOT = 'shell.overlay'
const ID = 'workspace.session-rename'

function validFace(face) {
  return typeof face?.hooks?.renameRequest?.getSnapshot === 'function'
    && typeof face.hooks.renameRequest.subscribe === 'function'
    && typeof face.settleSessionRename === 'function' && typeof face.renameSession === 'function'
}

/** Shadow only the native rename entry, retaining its exact target and callbacks. */
function installRenameOverlay({ ctx, React, primitives, transport, form, status, report = () => {} }) {
  const Dialog = createRenameDialog({ React, primitives, transport, form })
  return ctx.slots.inject(SLOT, () => {
    let source, sourceFace, own, unregister, stopRequest
    let stopped = false, scheduled = false, previousRequest = null
    const schedule = () => {
      if (stopped || scheduled) return
      scheduled = true
      queueMicrotask(() => { scheduled = false; if (!stopped) reconcile() })
    }
    const removeOwn = () => {
      const dispose = unregister
      unregister = undefined
      own = undefined
      dispose?.()
    }
    const unwatch = () => { stopRequest?.(); stopRequest = undefined; sourceFace = undefined; previousRequest = null }
    const observeRequest = () => {
      const next = sourceFace?.hooks.renameRequest.getSnapshot() ?? null
      if (next !== null && next !== previousRequest) void status.refresh()
      previousRequest = next
    }
    function reconcile() {
      const entries = ctx.slots.entries(SLOT)
      const candidates = entries.filter(entry => entry !== own && entry.options?.id === ID
        && (entry.options?.priority ?? 0) === 0 && entry.locale === 'workspace' && typeof entry.inject === 'function')
      const nextSource = candidates.length === 1 ? candidates[0] : undefined
      if (source !== nextSource) {
        removeOwn()
        unwatch()
        source = nextSource
        if (source) {
          try {
            const face = source.inject()
            if (!validFace(face)) throw new Error('重命名接口不兼容')
            sourceFace = face
            stopRequest = face.hooks.renameRequest.subscribe(observeRequest)
            observeRequest()
          } catch (error) {
            sourceFace = undefined
            report(`会话命名界面不可用：${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      const current = status.getSnapshot()
      const active = current.phase === 'ready' && current.enabled && current.state === 'custom'
      if (!active) { removeOwn(); report(''); return }
      if (!source || !sourceFace) { removeOwn(); report('未找到兼容的原生重命名界面。'); return }
      const competitors = entries.filter(entry => entry !== source && entry !== own && entry.options?.id === ID)
      if (competitors.length) { removeOwn(); report('会话重命名界面已被其他插件接管。'); return }
      if (!own) {
        const original = source
        unregister = ctx.slots.register({
          name: SLOT, id: ID, priority: -1, locale: source.locale,
          inject: () => {
            const face = original.inject()
            if (!validFace(face)) throw new Error('原生重命名接口已变化')
            return { ...face, isRenameCurrent: request => face.hooks.renameRequest.getSnapshot() === request }
          },
        }, Dialog)
        own = ctx.slots.entries(SLOT).find(entry => entry.options?.id === ID && entry.component === Dialog)
        if (!own) { removeOwn(); report('无法注册会话重命名界面。'); return }
      }
      const winner = ctx.slots.entriesOfSlot(SLOT).find(entry => entry.options?.id === ID)
      report(winner === own ? '' : '会话重命名界面已被其他插件接管。')
    }
    const stopSlots = ctx.slots.subscribe(SLOT, schedule)
    const stopStatus = status.subscribe(schedule)
    try { reconcile() } catch (error) { stopStatus(); stopSlots(); unwatch(); removeOwn(); throw error }
    return () => { stopped = true; stopStatus(); stopSlots(); unwatch(); removeOwn(); report('') }
  })
}

return {installRenameOverlay};
},
"src/client/session-titles/dialog.js":function(local) {
/** Build the native rename dialog with one additional whole-session action. */
function createRenameDialog({ React, primitives, transport, form }) {
  const h = React.createElement
  const { Modal, Button, IconSparkleRegular } = primitives

  function RenameForm({ request, renameSession, settleSessionRename, isRenameCurrent, t }) {
    const [draft, setDraft] = React.useState(request.currentTitle)
    const [busy, setBusy] = React.useState('')
    const [error, setError] = React.useState('')
    const [uncertain, setUncertain] = React.useState(false)
    const composing = React.useRef(false)
    const alive = React.useRef(true)
    const operation = React.useRef(null)
    React.useEffect(() => {
      alive.current = true
      return () => { alive.current = false; operation.current?.abort() }
    }, [])
    const trimmed = draft.trim()
    const blocked = Boolean(busy) || !trimmed
    const close = () => { if (!busy && isRenameCurrent(request)) settleSessionRename() }
    const confirm = async () => {
      if (blocked || !isRenameCurrent(request)) return
      setBusy('rename')
      setError('')
      try {
        await renameSession(request.sessionId, trimmed)
        if (alive.current && isRenameCurrent(request)) settleSessionRename()
      } catch (reason) {
        if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
      } finally { if (alive.current) setBusy('') }
    }
    const generate = async () => {
      if (busy || uncertain || !isRenameCurrent(request)) return
      const controller = new AbortController()
      operation.current = controller
      setBusy('generate')
      setError('')
      const configured = form.getSnapshot()?.value?.sessionTitles?.timeoutMs
      const timeoutMs = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
        ? Math.min(2147483647, Math.max(15000, configured + 15000)) : 75000
      try {
        await transport.generate(request.sessionId, { signal: controller.signal, timeoutMs })
        // The Host has already committed the title; a second rename would pin or overwrite it.
        if (alive.current && isRenameCurrent(request)) settleSessionRename()
      } catch (reason) {
        if (alive.current && !controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setUncertain(reason?.uncertain === true)
        }
      } finally {
        if (operation.current === controller) operation.current = null
        if (alive.current) setBusy('')
      }
    }
    return h(Modal, {
      open: true, onClose: close, closeLabel: t('close'), title: t('rename.session.title'),
      footer: h(React.Fragment, null,
        h(Button, { variant: 'outline', disabled: Boolean(busy), onClick: close }, t('cancel')),
        h(Button, { variant: 'primary', disabled: blocked, onClick: confirm }, t('rename'))),
    },
    h('div', { className: 'dsh-useful-tools-rename-field' },
      h('input', {
        className: 'dsh-useful-tools-rename-input', value: draft, 'aria-label': t('field.sessionName'),
        'data-modal-autofocus': true, disabled: Boolean(busy),
        onFocus: event => { event.target.select() },
        onChange: event => { setDraft(event.target.value); setError('') },
        onCompositionStart: () => { composing.current = true },
        onCompositionEnd: () => { composing.current = false },
        onKeyDown: event => {
          if (event.key === 'Enter' && !composing.current) { event.preventDefault(); void confirm() }
        },
      }),
      h('button', {
        className: 'dsh-useful-tools-rename-generate', type: 'button', disabled: Boolean(busy) || uncertain,
        'aria-label': '根据完整会话生成名称', title: '根据完整会话生成名称', onClick: () => { void generate() },
      }, IconSparkleRegular ? h(IconSparkleRegular, { size: 16 }) : '✦')),
    busy === 'generate' && h('div', { className: 'dsh-useful-tools-rename-status', role: 'status' }, '正在生成会话名称…'),
    error && h('div', { className: 'dsh-useful-tools-rename-error', role: 'alert' }, error))
  }

  return function SessionRenameDialog({ useRenameRequest, settleSessionRename, renameSession, isRenameCurrent, t }) {
    const request = useRenameRequest(pending => pending)
    if (request === null) return null
    return h(RenameForm, { key: request.sessionId, request, settleSessionRename, renameSession, isRenameCurrent, t })
  }
}

return {createRenameDialog};
},
"src/settings/index.js":function(local) {
const { createSessionTitlesSettings } = local("src/settings/session-titles.js");

/** One settings section with a page for each component. */
function installSettings({ ctx, React, form, status, catalog, notice }) {
  const h = React.createElement
  const SessionTitlesSettings = createSessionTitlesSettings({ React, form, status, catalog, notice })
  function SettingsSection() {
    const [page, setPage] = React.useState('index')
    if (page === 'session-titles') return h(SessionTitlesSettings, { onBack: () => setPage('index') })
    return h('section', { className: 'dsh-useful-tools-page' },
      h('h3', null, '实用工具'),
      h('p', null, '选择要设置的组件。组件的启用和关闭可在插件管理中操作。'),
      h('button', { type: 'button', className: 'dsh-useful-tools-component', onClick: () => setPage('session-titles') },
        h('span', null, h('strong', null, '会话命名'), h('small', null, '自动命名与命名模型设置')),
        h('span', { 'aria-hidden': true }, '›')))
  }
  return ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-useful-tools', order: 56, label: '实用工具',
  }, SettingsSection))
}

return {installSettings};
},
"src/settings/session-titles.js":function(local) {
/** Settings for the independent session-title model route. */
function createSessionTitlesSettings({ React, form, status, catalog, notice }) {
  const h = React.createElement
  const subscribeForm = listener => form.subscribe(listener)
  const getForm = () => form.getSnapshot()
  return function SessionTitlesSettings({ onBack }) {
    const config = React.useSyncExternalStore(subscribeForm, getForm, getForm)
    const component = React.useSyncExternalStore(status.subscribe, status.getSnapshot, status.getSnapshot)
    const models = React.useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot)
    const warning = React.useSyncExternalStore(notice.subscribe, notice.getSnapshot, notice.getSnapshot)
    const [edit, setEdit] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const mounted = React.useRef(true)
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    React.useEffect(() => { void status.refresh() }, [])
    React.useEffect(() => { if (models.phase === 'idle') void catalog.refresh() }, [models.phase])
    const value = config.status === 'ready' && config.value?.sessionTitles
    const valid = value && typeof value.provider === 'string' && typeof value.model === 'string'
    const provider = edit?.provider ?? value?.provider ?? ''
    const model = edit?.model ?? value?.model ?? ''
    const changed = Boolean(valid && (provider !== value.provider || model !== value.model))
    const conflict = edit !== null && edit.revision !== config.revision
    const group = models.groups.find(item => item.id === provider)
    const missingProvider = Boolean(provider && !group)
    const missingModel = Boolean(model && !group?.models.some(item => item.id === model))
    const complete = (!provider && !model)
      || Boolean(models.phase === 'ready' && provider && model && !missingProvider && !missingModel)
    const begin = patch => {
      setError('')
      setEdit(current => ({ provider: current?.provider ?? value?.provider ?? '', model: current?.model ?? value?.model ?? '',
        revision: current?.revision ?? config.revision, ...patch }))
    }
    const save = async () => {
      if (!valid || !config.writable || !changed || conflict || !complete || busy) return
      setBusy(true)
      setError('')
      try {
        const ok = await form.mutate([
          { op: 'set', path: ['sessionTitles', 'provider'], value: provider },
          { op: 'set', path: ['sessionTitles', 'model'], value: model },
        ], edit?.revision)
        if (!mounted.current) return
        if (ok) setEdit(null)
        else setError('配置未保存，请检查连接或重新读取最新配置。')
      } catch (reason) {
        if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
      } finally { if (mounted.current) setBusy(false) }
    }
    const statusText = component.phase === 'ready'
      ? component.state === 'error' ? (component.error || '会话命名组件不可用。')
        : component.state === 'switching' ? '正在切换会话命名组件…'
          : component.enabled ? '会话命名组件已启用。' : '会话命名组件已关闭，可在插件管理中启用。'
      : component.phase === 'offline' ? '连接已断开。'
        : component.phase === 'error' ? component.error : '正在读取组件状态…'
    return h('div', { className: 'dsh-useful-tools-page' },
      h('button', { type: 'button', className: 'dsh-useful-tools-back', onClick: onBack }, '← 返回实用工具'),
      h('h3', null, '会话命名'),
      h('p', null, '首轮用户消息和 AI 回复（包括图片）用于自动生成名称；在会话重命名框中可根据完整会话重新生成。'),
      h('p', { role: component.phase === 'error' || component.state === 'error' ? 'alert' : 'status' }, statusText),
      warning && h('p', { role: 'alert' }, warning),
      (component.phase === 'error' || component.state === 'error')
        && h('button', { type: 'button', onClick: () => { void status.refresh() } }, '重新读取状态'),
      h('h4', null, '命名模型'),
      h('p', null, '默认跟随该会话使用的模型，也可以为命名单独选择模型。'),
      !valid && h('p', { role: 'status' }, config.status === 'unavailable' ? '配置暂不可用。' : '正在读取配置…'),
      valid && !config.writable && h('p', { role: 'status' }, '当前配置为只读。'),
      h('fieldset', { disabled: !valid || !config.writable || busy },
        h('label', { className: 'dsh-useful-tools-setting' }, h('span', null, '服务商'),
          h('select', { value: provider, onChange: event => begin({ provider: event.target.value, model: '' }) },
            h('option', { value: '' }, '跟随当前会话模型'),
            missingProvider && h('option', { value: provider }, `${provider}（当前不可用）`),
            ...models.groups.map(item => h('option', { value: item.id, key: item.id }, item.name)))),
        provider && h('label', { className: 'dsh-useful-tools-setting' }, h('span', null, '模型'),
          h('select', { value: model, disabled: models.phase !== 'ready', onChange: event => begin({ model: event.target.value }) },
            h('option', { value: '' }, '请选择模型'),
            missingModel && h('option', { value: model }, `${model}（当前不可用）`),
            ...(group?.models ?? []).map(item => h('option', { value: item.id, key: item.id }, item.name)))),
        h('div', { className: 'dsh-useful-tools-setting-actions' },
          h('button', { type: 'button', disabled: !changed || conflict || !complete || busy, onClick: () => { void save() } }, busy ? '保存中…' : '保存'),
          edit && h('button', { type: 'button', disabled: busy, onClick: () => { setEdit(null); setError('') } }, '恢复当前设置'))),
      conflict && h('p', { role: 'alert' }, '配置已在其他位置更改，请恢复当前设置后重新选择。'),
      models.phase === 'error' && h('p', { role: 'alert' }, models.error || '读取模型列表失败。'),
      models.phase !== 'ready' && h('p', { role: 'status' }, models.phase === 'offline' ? '连接已断开，模型列表不可用。'
        : models.phase === 'error' ? '请重试读取模型列表。' : '正在读取模型列表…'),
      models.phase === 'error' && h('button', { type: 'button', onClick: () => { void catalog.refresh() } }, '重新读取模型'),
      models.phase === 'ready' && models.failures.length > 0
        && h('p', { role: 'status' }, `部分服务商的模型列表不可用：${models.failures.map(item => item.name || item.id || '未知服务商').join('、')}`),
      error && h('p', { role: 'alert' }, error))
  }
}

return {createSessionTitlesSettings};
}};
const cache=Object.create(null);
const local=id=>cache[id]??(cache[id]=factories[id](local));
return local("src/client/index.js").makePlugin(require,".dsh-useful-tools-page { color: var(--dsw-alias-label-primary); }\n.dsh-useful-tools-page p { color: var(--dsw-alias-label-secondary); line-height: 1.5; }\n.dsh-useful-tools-page fieldset { display: grid; gap: 14px; border: 0; padding: 0; margin: 16px 0; }\n.dsh-useful-tools-page button, .dsh-useful-tools-page select {\n  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-fill-layer-2, transparent);\n  border: 1px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-lg, 8px); padding: 8px 12px;\n}\n.dsh-useful-tools-page button:disabled, .dsh-useful-tools-page fieldset:disabled { opacity: .55; }\n.dsh-useful-tools-component { display: flex; width: 100%; align-items: center; justify-content: space-between; text-align: left; cursor: pointer; }\n.dsh-useful-tools-component strong, .dsh-useful-tools-component small { display: block; }\n.dsh-useful-tools-component small { margin-top: 4px; color: var(--dsw-alias-label-secondary); }\n.dsh-useful-tools-setting { display: grid; gap: 7px; }\n.dsh-useful-tools-setting select { width: 100%; }\n.dsh-useful-tools-setting-actions { display: flex; gap: 8px; }\n.dsh-useful-tools-back { cursor: pointer; }\n.dsh-useful-tools-rename-field { position: relative; }\n.dsh-useful-tools-rename-input {\n  box-sizing: border-box; width: 100%; height: 44px; padding: 7px 45px 7px 14px;\n  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-lg);\n  outline: none; background: transparent; color: var(--dsw-alias-label-primary);\n  font-size: 14px; font-weight: 400; line-height: 22px;\n}\n.dsh-useful-tools-rename-input:disabled { color: var(--dsw-alias-label-dimmed); }\n.dsh-useful-tools-rename-generate {\n  position: absolute; right: 7px; top: 50%; transform: translateY(-50%); display: grid; place-items: center;\n  width: 32px; height: 32px; border: 0; border-radius: 7px; cursor: pointer; background: transparent;\n  color: var(--dsw-alias-label-secondary);\n}\n.dsh-useful-tools-rename-generate:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }\n.dsh-useful-tools-rename-generate:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: 1px; }\n.dsh-useful-tools-rename-generate:disabled { opacity: .5; cursor: default; }\n.dsh-useful-tools-rename-status, .dsh-useful-tools-rename-error { margin-top: 8px; font-size: 12px; line-height: 18px; }\n.dsh-useful-tools-rename-status { color: var(--dsw-alias-label-secondary); }\n.dsh-useful-tools-rename-error { color: var(--dsw-alias-state-error-primary); }\n");
}});
