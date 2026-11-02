const INITIAL = Object.freeze({ phase: 'connecting', groups: [], failures: [], error: '' })

/** Read the native model catalog without selecting a model for any conversation. */
export function createTitleCatalog(readCatalog) {
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
