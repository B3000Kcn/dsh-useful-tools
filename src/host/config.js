/** Schema defaults are applied by DSH and remain editable in the native form. */
export function usefulToolsSchema(z) {
  return z.object({
    sessionTitles: z.object({
      provider: z.string().default(''),
      model: z.string().default(''),
      maxInputBytes: z.number().step(1).min(1).default(65536),
      maxOutputTokens: z.number().step(1).min(1).default(1024),
      timeoutMs: z.number().step(1).min(1).max(2147483647).default(60000),
      maxTitleBytes: z.number().step(1).min(1).default(80),
    }).default({}).volatile(),
  })
}

/** Capture one complete policy; a settings edit never changes an in-flight call. */
export function readTitleConfig(config) {
  const value = config.sessionTitles.get()
  const provider = value.provider.trim(), model = value.model.trim()
  if (Boolean(provider) !== Boolean(model)) {
    throw Object.assign(new Error('命名的提供方和模型必须一起选择。'), { code: 'TITLE_ROUTE_INVALID' })
  }
  return { ...value, provider: provider || undefined, model: model || undefined }
}
