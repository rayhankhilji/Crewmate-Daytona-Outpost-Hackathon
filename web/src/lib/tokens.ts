/**
 * Reads a duration token from DESIGN.md's custom properties so timings live in
 * exactly one place. A component never restates a number the tokens declare.
 */
const cache = new Map<string, number>()

export function durationToken(name: string): number {
  const cached = cache.get(name)
  if (cached !== undefined) {
    return cached
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const parsed = Number.parseFloat(raw)
  if (Number.isNaN(parsed)) {
    throw new Error(`Owari: duration token ${name} is not declared in tokens.css.`)
  }
  const ms = raw.endsWith('ms') ? parsed : parsed * 1000
  cache.set(name, ms)
  return ms
}
