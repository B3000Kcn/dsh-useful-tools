import { createRenameDialog } from './dialog.js'

const SLOT = 'shell.overlay'
const ID = 'workspace.session-rename'

function validFace(face) {
  return typeof face?.hooks?.renameRequest?.getSnapshot === 'function'
    && typeof face.hooks.renameRequest.subscribe === 'function'
    && typeof face.settleSessionRename === 'function' && typeof face.renameSession === 'function'
}

/** Shadow only the native rename entry, retaining its exact target and callbacks. */
export function installRenameOverlay({ ctx, React, primitives, transport, form, status, report = () => {} }) {
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
