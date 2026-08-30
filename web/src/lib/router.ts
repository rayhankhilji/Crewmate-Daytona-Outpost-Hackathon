import { useCallback, useSyncExternalStore } from 'react'

/**
 * Hash routing, hand-rolled. The app has four views and one live data source;
 * a routing library would be more surface than the whole navigation model.
 */

export type ViewName = 'recordings' | 'speedrun' | 'brief' | 'launch' | 'run'

export type Route =
  | { view: 'recordings' }
  | { view: 'speedrun'; briefId: string | null }
  | { view: 'brief'; briefId: string | null }
  /** Composing a run from a Brief. Distinct from watching one execute. */
  | { view: 'launch'; briefId: string | null }
  | { view: 'run'; runId: string | null }

export const DEFAULT_ROUTE: Route = { view: 'recordings' }

export function hrefFor(route: Route): string {
  switch (route.view) {
    case 'recordings':
      return '#/recordings'
    case 'speedrun':
      return route.briefId === null
        ? '#/speedrun'
        : `#/speedrun/${encodeURIComponent(route.briefId)}`
    case 'brief':
      return route.briefId === null ? '#/brief' : `#/brief/${encodeURIComponent(route.briefId)}`
    case 'launch':
      return route.briefId === null ? '#/launch' : `#/launch/${encodeURIComponent(route.briefId)}`
    case 'run':
      return route.runId === null ? '#/run' : `#/run/${encodeURIComponent(route.runId)}`
  }
}

export function parseHash(hash: string): Route {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [view, id] = segments
  const resolved = id === undefined ? null : decodeURIComponent(id)

  switch (view) {
    case 'speedrun':
      return { view: 'speedrun', briefId: resolved }
    case 'brief':
      return { view: 'brief', briefId: resolved }
    case 'launch':
      return { view: 'launch', briefId: resolved }
    case 'run':
      return { view: 'run', runId: resolved }
    default:
      return DEFAULT_ROUTE
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function readHash(): string {
  return window.location.hash
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash, readHash)
  return parseHash(hash)
}

export function useNavigate(): (route: Route) => void {
  return useCallback((route: Route) => {
    window.location.hash = hrefFor(route)
  }, [])
}
