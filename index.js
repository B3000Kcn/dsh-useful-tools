import z from '@deepseek-ai/schemastery'
import * as OfficialTitles from '@deepseek-ai/dsh-session-title-first-prompt-llm'
import { usefulToolsSchema, readTitleConfig } from './src/host/config.js'
import { createTitleControl } from './src/host/title-control.js'
import { createTitleEngine } from './src/host/session-titles/engine.js'
import { installTitleRoutes } from './src/host/routes.js'

export const name = 'dsh-useful-tools'
export const Config = usefulToolsSchema(z)
export const inject = ['loader', 'settings', 'connection', 'sessions', 'sessionTitle', 'llm', 'typert']

/** Assemble component lifetimes and the shared configuration page's host. */
export function apply(ctx, config) {
  readTitleConfig(config)
  const defaults = [...ctx.loader.entries()].filter(entry =>
    entry.options.id === 'session-title-llm'
    && entry.options.name === '@deepseek-ai/dsh-session-title-first-prompt-llm')
  if (defaults.length !== 1 || !defaults[0].disabled) {
    throw new Error('默认会话命名插件未被唯一接管，请检查是否有更高优先级配置覆盖。')
  }
  const service = { engine: undefined, titleControl: undefined }
  const control = createTitleControl({
    startDefault() {
      const fiber = ctx.plugin(OfficialTitles, structuredClone(defaults[0].options.config))
      return { dispose: () => fiber.dispose(), ready: fiber.await() }
    },
    startCustom() {
      const engine = createTitleEngine({ ctx, readConfig: () => readTitleConfig(config) })
      service.engine = engine
      return () => {
        if (service.engine === engine) service.engine = undefined
        return engine.dispose()
      }
    },
    onError(error) { ctx.logger.error(`会话命名交接失败：${error.message}`) },
  })
  service.titleControl = control
  ctx.provide('usefulTools', service)
  ctx.effect(() => () => control.dispose(), 'dsh-useful-tools: component lifetimes')
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  ctx.effect(() => installTitleRoutes(ctx, service))
  return control.start()
}
