/** Settings for the independent session-title model route. */
export function createSessionTitlesSettings({ React, form, status, catalog, notice }) {
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
