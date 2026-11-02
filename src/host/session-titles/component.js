/** Independent native plugin-manager switch for automatic session naming. */
export const name = 'dsh-useful-tools-session-titles'
export const inject = ['usefulTools', 'settings']

export function apply(ctx) {
  ctx.effect(() => ctx.usefulTools.titleControl.activate(), 'useful-tools: session titles')
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
}
