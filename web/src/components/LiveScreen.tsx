import { useCallback, useEffect, useRef, useState } from 'react'

import { SANDBOX_HEIGHT, SANDBOX_WIDTH } from '../types'

/**
 * A worker's sandbox desktop, live, over noVNC.
 *
 * The iframe renders at the sandbox's true 1280x800 and is scaled down to
 * whatever box it is given, so it stays sharp and correctly proportioned in a
 * 340px tile and in a full-width focused view without the server needing to
 * know either size. It is presentation only: pointer and keyboard events are
 * blocked, because a person clicking into a running worker's desktop would
 * fight the executor for control of it.
 */
export function LiveScreen({ url, label }: { url: string; label: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 0, left: 0, top: 0 })

  const measure = useCallback(() => {
    const box = boxRef.current
    if (box === null) {
      return
    }
    // Fit inside the box in both dimensions, and never above 1:1 — upscaling a
    // remote desktop only blurs it. Centred, so a box of any shape letterboxes
    // the desktop instead of cropping or stretching it.
    const scale = Math.min(box.clientWidth / SANDBOX_WIDTH, box.clientHeight / SANDBOX_HEIGHT, 1)
    setFit({
      scale,
      left: Math.round((box.clientWidth - SANDBOX_WIDTH * scale) / 2),
      top: Math.round((box.clientHeight - SANDBOX_HEIGHT * scale) / 2),
    })
  }, [])

  useEffect(() => {
    measure()
    const box = boxRef.current
    if (box === null) {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden bg-screen">
      {fit.scale === 0 ? null : (
        <iframe
          src={url}
          title={label}
          tabIndex={-1}
          sandbox="allow-scripts allow-same-origin"
          className="pointer-events-none absolute origin-top-left border-0"
          style={{
            width: `${SANDBOX_WIDTH}px`,
            height: `${SANDBOX_HEIGHT}px`,
            left: `${fit.left}px`,
            top: `${fit.top}px`,
            transform: `scale(${fit.scale})`,
          }}
        />
      )}
    </div>
  )
}

/** Marks a screen as genuinely live rather than a periodic screenshot. */
export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-sm bg-scrim px-2 py-1 font-mono text-xs text-on-screen">
      <span className="h-2 w-2 rounded-full bg-accent-tint" />
      live
    </span>
  )
}
