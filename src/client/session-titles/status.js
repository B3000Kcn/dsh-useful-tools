const INITIAL = Object.freeze({ phase: 'connecting', enabled: false, state: 'default', error: '' })

/** Observe the Host's settled component status without background polling. */
export function createTitleStatus(transport) {
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
