import { createSessionTitlesSettings } from './session-titles.js'

/** One settings section with a page for each component. */
export function installSettings({ ctx, React, form, status, catalog, notice }) {
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
