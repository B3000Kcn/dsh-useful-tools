/**
 * Serial ownership of the single session-title provider.
 *
 * A factory must either return a disposer immediately, or return
 * { dispose, ready }. `ready` may be a promise; keeping dispose synchronous
 * lets a closing host fiber cancel a provider that is still starting. A
 * promise for either shape is accepted for less capable adapters, although
 * cancellation cannot start until that promise yields its disposer.
 */
export function createTitleControl({ startDefault, startCustom, onError = () => {} }) {
  if (typeof startDefault !== 'function' || typeof startCustom !== 'function') {
    throw new TypeError('title provider factories must be functions')
  }

  const leases = new Set()
  let started = false
  let closed = false
  let revision = 0
  let active
  let task
  let failure
  let failedRevision = -1
  let fallbackAfterCustomFailure = false

  function requested() {
    if (closed || !started) return undefined
    if (failedRevision === revision) return fallbackAfterCustomFailure ? 'default' : undefined
    return leases.size ? 'custom' : 'default'
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error)
  }

  function report(error, fallback) {
    failure = error
    failedRevision = revision
    fallbackAfterCustomFailure = fallback
    try { onError(error) } catch { /* reporting cannot interrupt provider cleanup */ }
  }

  function asProvider(value, kind) {
    const dispose = typeof value === 'function' ? value : value?.dispose
    if (typeof dispose !== 'function') throw new TypeError(`${kind} title provider did not supply a disposer`)
    let cancelReady
    const cancelled = new Promise(resolve => { cancelReady = resolve })
    const readyValue = typeof value === 'function' ? undefined : value.ready
    const ready = readyValue === undefined ? undefined : Promise.resolve(readyValue).then(
      () => ({ ok: true }), error => ({ ok: false, error }),
    )
    return { kind, dispose: () => dispose.call(value), ready, readyDone: !ready, cancelled, cancelReady, stop: undefined }
  }

  // This must initiate disposal synchronously: Loader may enable its official
  // row during the same profile reload that removes this bundle.
  function stop(provider) {
    if (!provider.stop) {
      try { provider.stop = Promise.resolve(provider.dispose()) }
      catch (error) { provider.stop = Promise.reject(error) }
      provider.cancelReady()
    }
    return provider.stop
  }

  function interruptChangedProvider() {
    if (active && active.kind !== requested()) stop(active)
  }

  async function reconcile() {
    while (true) {
      const desired = requested()
      const provider = active
      if (provider && (provider.kind !== desired || provider.stop)) {
        try { await stop(provider) }
        catch (error) {
          // An unsuccessful disposer may still own the registration. Starting
          // another provider would risk two writers and hide the real error.
          report(error, false)
          return
        }
        if (active === provider) active = undefined
        continue
      }
      if (provider) {
        if (provider.readyDone) return
        const result = await Promise.race([provider.ready, provider.cancelled])
        if (provider.stop || active !== provider || provider.kind !== requested()) continue
        if (result?.ok === false) {
          report(result.error, provider.kind === 'custom')
          stop(provider)
          continue
        }
        provider.readyDone = true
        continue
      }
      if (!desired) return
      try {
        let value = (desired === 'custom' ? startCustom : startDefault)()
        if (value && typeof value.then === 'function') value = await value
        active = asProvider(value, desired)
        // The desired state can change while an asynchronous factory starts.
        interruptChangedProvider()
      } catch (error) {
        // A stale startup need not be retried; its owner has already left.
        if (desired !== requested()) continue
        report(error, desired === 'custom')
      }
    }
  }

  function schedule() {
    interruptChangedProvider()
    if (task) return task
    const startRevision = revision
    // reconcile() runs synchronously until its first asynchronous boundary.
    const pending = reconcile()
    task = pending
    pending.then(() => {
      if (task !== pending) return
      task = undefined
      // A request arriving after the last check, but before the promise settled,
      // must not be lost. Do not loop retrying a failed factory.
      if (revision !== startRevision) schedule()
    }, error => {
      if (task !== pending) return
      task = undefined
      report(error, false)
      if (revision !== startRevision) schedule()
    })
    return pending
  }

  function change() {
    revision++
    failure = undefined
    failedRevision = -1
    fallbackAfterCustomFailure = false
    schedule()
  }

  async function whenIdle() {
    // A completed transition can schedule a follow-up before its callback
    // returns, so keep observing until the current operation is stable.
    while (task) {
      const observed = task
      await observed.catch(() => {})
      if (task === observed) await Promise.resolve()
    }
  }

  return {
    start() {
      if (closed) throw new Error('会话命名服务已经关闭。')
      if (!started) { started = true; change() }
      return whenIdle()
    },
    activate() {
      if (closed) throw new Error('会话命名服务已经关闭。')
      const lease = Symbol('session-titles')
      leases.add(lease)
      change()
      let released = false
      return () => {
        if (released) return whenIdle()
        released = true
        leases.delete(lease)
        if (!closed) change()
        return whenIdle()
      }
    },
    dispose() {
      if (!closed) {
        closed = true
        leases.clear()
        change()
      }
      return whenIdle()
    },
    whenIdle,
    getSnapshot() {
      const enabled = !closed && leases.size > 0 && active?.kind === 'custom'
        && active.readyDone && !active.stop && failedRevision !== revision
      const switching = Boolean(task && (!active?.readyDone || active?.stop || active?.kind !== requested()))
      const state = closed ? (switching ? 'switching' : 'closed')
        : switching ? 'switching'
          : failedRevision === revision ? 'error'
            : active?.kind ?? 'switching'
      return { enabled, state, ...(failedRevision === revision ? { error: errorMessage(failure) } : {}) }
    },
  }
}
