import type { RefObject } from 'react'

import type { TimelineEntry } from '../lib/timeline'

interface ScrubberProps {
  duration: number
  entries: readonly TimelineEntry[]
  /** Mutated directly on every animation frame — never through React state. */
  trackRef: RefObject<HTMLDivElement>
  fillRef: RefObject<HTMLDivElement>
  headRef: RefObject<HTMLDivElement>
  /** Read on demand for keyboard seeking; never rendered. */
  getCurrentTime: () => number
  onSeek: (seconds: number) => void
}

/**
 * Pruned segments as --text-faint bands, comprehended steps as --accent ticks.
 * The contract gives a pruned segment a point in time rather than a range, so
 * a band is drawn as a fixed short window centred on that point.
 */
const BAND_SECONDS = 0.9

export function Scrubber({
  duration,
  entries,
  trackRef,
  fillRef,
  headRef,
  getCurrentTime,
  onSeek,
}: ScrubberProps) {
  const percent = (seconds: number): number => (seconds / duration) * 100

  const seekFromPointer = (event: React.MouseEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / bounds.width
    onSeek(Math.min(Math.max(ratio, 0), 1) * duration)
  }

  const seekByKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onSeek(Math.max(getCurrentTime() - 1, 0))
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onSeek(Math.min(getCurrentTime() + 1, duration))
    }
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Recording position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={0}
      onClick={seekFromPointer}
      onKeyDown={seekByKey}
      className="relative h-4 w-full cursor-pointer overflow-hidden rounded-sm border border-border bg-surface"
    >
      <div
        ref={fillRef}
        className="absolute inset-y-0 left-0 bg-surface-sunken"
        style={{ width: 0 }}
      />

      {entries.map((entry, index) =>
        entry.kind === 'pruned' ? (
          <div
            key={`band-${index}`}
            className="absolute inset-y-0 bg-text-faint"
            style={{
              left: `${percent(Math.max(entry.at - BAND_SECONDS / 2, 0))}%`,
              width: `${percent(BAND_SECONDS)}%`,
            }}
          />
        ) : (
          <div
            key={`tick-${index}`}
            className="absolute inset-y-0 w-px bg-accent"
            style={{ left: `${percent(entry.at)}%` }}
          />
        ),
      )}

      <div ref={headRef} className="absolute inset-y-0 w-px bg-text" style={{ left: 0 }} />
    </div>
  )
}
