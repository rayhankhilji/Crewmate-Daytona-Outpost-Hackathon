import type { Brief, BriefStep } from '../types'

/** `{{name}}` references inside a step value. Matches the contract's pattern. */
const REFERENCE = /\{\{([a-z][a-z0-9_]*)\}\}/g

export type ValueToken = { kind: 'text'; text: string } | { kind: 'variable'; name: string }

/** Splits a step value into literal text and the variables it references. */
export function tokenizeValue(value: string): ValueToken[] {
  const tokens: ValueToken[] = []
  let cursor = 0

  for (const match of value.matchAll(REFERENCE)) {
    const start = match.index
    if (start > cursor) {
      tokens.push({ kind: 'text', text: value.slice(cursor, start) })
    }
    tokens.push({ kind: 'variable', name: match[1] })
    cursor = start + match[0].length
  }

  if (cursor < value.length) {
    tokens.push({ kind: 'text', text: value.slice(cursor) })
  }
  return tokens
}

export function variablesInStep(step: BriefStep): string[] {
  if (step.value === null) {
    return []
  }
  return tokenizeValue(step.value)
    .filter((token): token is { kind: 'variable'; name: string } => token.kind === 'variable')
    .map((token) => token.name)
}

/** Variable names the Brief declares, in declaration order. */
export function declaredVariables(brief: Brief): string[] {
  return brief.variables.map((variable) => variable.name)
}
