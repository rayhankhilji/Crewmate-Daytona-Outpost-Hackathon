import type { Brief, BriefStep, PrunedSegment } from '../types'
import { variablesInStep } from './variables'

/**
 * The replay timeline for the speedrun view.
 *
 * DESIGN.md asks for each step to materialise "as playback passes each step's
 * source timestamp", but the frozen Brief contract carries a timestamp only on
 * `pruned[].at_seconds` — a step has no `at_seconds` field, and adding one
 * would mean editing contract/. Steps are therefore spread evenly across the
 * recording, in Brief order, and pruned segments sit at their real timestamps.
 * Ordering is always faithful; step spacing is even rather than observed.
 * Raised with Rayhan — if the contract later carries step timestamps, this is
 * the one function that changes.
 */

export interface StepEntry {
  kind: 'step'
  at: number
  step: BriefStep
  /** Variables this step is the first to reference, highlighted on arrival. */
  newVariables: ReadonlySet<string>
}

export interface PrunedEntry {
  kind: 'pruned'
  at: number
  segment: PrunedSegment
}

export type TimelineEntry = StepEntry | PrunedEntry

/** Evenly spaced inside the recording, never at 0 and never at the very end. */
export function stepTimestamp(index: number, stepCount: number, duration: number): number {
  return (duration * (index + 1)) / (stepCount + 1)
}

export function buildTimeline(brief: Brief, duration: number): TimelineEntry[] {
  const seen = new Set<string>()

  const steps: StepEntry[] = brief.steps.map((step, index) => {
    const fresh = new Set<string>()
    for (const name of variablesInStep(step)) {
      if (!seen.has(name)) {
        seen.add(name)
        fresh.add(name)
      }
    }
    return {
      kind: 'step',
      at: stepTimestamp(index, brief.steps.length, duration),
      step,
      newVariables: fresh,
    }
  })

  const pruned: PrunedEntry[] = brief.pruned.map((segment) => ({
    kind: 'pruned',
    at: Math.min(segment.at_seconds, duration),
    segment,
  }))

  return [...steps, ...pruned].sort((left, right) => left.at - right.at)
}

/** Entries whose timestamp the playhead has passed. Derived, never accumulated. */
export function revealedCount(entries: readonly TimelineEntry[], currentTime: number): number {
  let count = 0
  while (count < entries.length && entries[count].at <= currentTime) {
    count += 1
  }
  return count
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
