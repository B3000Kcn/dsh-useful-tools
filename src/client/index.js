import { createTitleTransport } from './session-titles/transport.js'
import { createTitleStatus } from './session-titles/status.js'
import { createTitleCatalog } from './session-titles/catalog.js'
import { installRenameOverlay } from './session-titles/overlay.js'
import { installSettings } from '../settings/index.js'

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
export function makePlugin(require, cssText = '') {
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
