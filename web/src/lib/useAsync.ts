import { useCallback, useEffect, useState } from 'react'

import { ApiError } from '../api'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; cause: unknown }
  | { status: 'ready'; data: T }

/** Turns any thrown value into a sentence. A stack trace never reaches a view. */
export function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    return cause.message
  }
  if (cause instanceof Error && cause.message !== '') {
    return cause.message
  }
  return 'Something failed that Owari could not describe. Try again.'
}

export interface AsyncResult<T> {
  state: AsyncState<T>
  reload: () => void
}

/**
 * Loads once per change in `deps` and on demand via `reload`. `load` is
 * deliberately not a dependency — callers pass inline closures, and `deps`
 * states what the load actually varies with.
 */
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })

    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ status: 'ready', data })
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        setState({ status: 'error', message: messageFor(cause), cause })
      })

    return () => controller.abort()
  }, [...deps, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { state, reload }
}
