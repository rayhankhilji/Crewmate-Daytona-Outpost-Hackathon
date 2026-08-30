import { formatOffset } from '../lib/format'
import type { PrunedSegment } from '../types'

/**
 * A segment Crewmate decided not to keep, shown permanently.
 *
 * It arrives with the same entrance as a step and then stays. Crewmate discarding
 * a dead end is evidence that it understood the intent rather than recording
 * keystrokes, so the reason has to remain readable — a card that erased itself
 * would take the evidence with it.
 *
 * It reads as secondary rather than deleted: a sunken ground and a label, not a
 * strikethrough.
 */
export function PrunedEntryRow({ segment }: { segment: PrunedSegment }) {
  return (
    <article className="motion-materialise flex flex-col gap-2 rounded-md border border-border bg-surface-sunken px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-text-faint">
          {formatOffset(segment.at_seconds)}
        </span>
        <span className="rounded-sm border border-border bg-surface px-2 py-1 font-mono text-xs text-text-muted">
          pruned
        </span>
      </div>
      <p className="text-sm text-text-muted">{segment.reason}</p>
    </article>
  )
}
