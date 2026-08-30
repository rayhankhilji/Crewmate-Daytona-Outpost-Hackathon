import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { formatOffset } from '../lib/format'
import { durationToken } from '../lib/tokens'
import type { PrunedSegment } from '../types'

/**
 * Motion 2. The segment arrives at full opacity, holds, then greys to
 * --text-faint, strikes its reason through and collapses to zero height.
 *
 * This is the product's argument that it understood intent rather than
 * recording keystrokes, so it is deliberately legible: the reason is readable
 * for the full hold before anything moves.
 */
export function PrunedEntryRow({ segment }: { segment: PrunedSegment }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useLayoutEffect(() => {
    if (contentRef.current !== null) {
      setHeight(contentRef.current.offsetHeight)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(
      () => setCollapsed(true),
      durationToken('--duration-prune-hold'),
    )
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      className={`prune-entry border-b border-border bg-surface ${
        collapsed ? 'text-text-faint' : 'text-text'
      }`}
      style={{
        maxHeight: collapsed ? 0 : (height ?? undefined),
        opacity: collapsed ? 0 : 1,
      }}
    >
      <div ref={contentRef} className="flex items-baseline gap-4 px-4 py-3">
        <span className="font-mono text-xs tabular-nums text-text-faint">
          {formatOffset(segment.at_seconds)}
        </span>
        <span className="rounded-sm bg-surface-sunken px-1 font-mono text-xs text-text-faint">
          pruned
        </span>
        <span className={`text-sm ${collapsed ? 'line-through' : ''}`}>{segment.reason}</span>
      </div>
    </div>
  )
}
