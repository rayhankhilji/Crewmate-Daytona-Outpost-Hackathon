import { useEffect, useState } from 'react'

import { getHealth } from '../data'
import type { HealthResponse } from '../types'

/**
 * The shell's readiness signal. Polled rather than fetched once, because the
 * server is started and restarted by hand during a demo and the shell has to
 * recover on its own — killing and restarting uvicorn must not need a reload.
 */
const POLL_MS = 5000

export type Health =
  { status: 'unknown' } | { status: 'unreachable' } | { status: 'ready'; detail: HealthResponse }

export function useHealth(): Health {
  const [health, setHealth] = useState<Health>({ status: 'unknown' })

  useEffect(() => {
    const controller = new AbortController()

    const check = (): void => {
      getHealth(controller.signal)
        .then((detail) => setHealth({ status: 'ready', detail }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setHealth({ status: 'unreachable' })
          }
        })
    }

    check()
    const timer = window.setInterval(check, POLL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  return health
}
