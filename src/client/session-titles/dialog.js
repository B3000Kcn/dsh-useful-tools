/** Build the native rename dialog with one additional whole-session action. */
export function createRenameDialog({ React, primitives, transport, form }) {
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
