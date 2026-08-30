import type { ReactNode } from 'react'

import { hrefFor, type Route, type ViewName } from '../lib/router'
import type { Health } from '../lib/useHealth'

interface AppShellProps {
  route: Route
  briefId: string | null
  runId: string | null
  /** The speedrun view owns the full viewport; every other view is padded. */
  bleed: boolean
  health: Health
  children: ReactNode
}

interface NavItem {
  view: ViewName
  /** Views this rail entry stands for — launching and monitoring share one. */
  matches: readonly ViewName[]
  index: string
  label: string
  href: string
}

function navItems(briefId: string | null, runId: string | null): NavItem[] {
  return [
    {
      view: 'recordings',
      matches: ['recordings'],
      index: '01',
      label: 'Recordings',
      href: hrefFor({ view: 'recordings' }),
    },
    {
      view: 'speedrun',
      matches: ['speedrun'],
      index: '02',
      label: 'Speedrun',
      href: hrefFor({ view: 'speedrun', briefId }),
    },
    {
      view: 'brief',
      matches: ['brief'],
      index: '03',
      label: 'Brief',
      href: hrefFor({ view: 'brief', briefId }),
    },
    {
      view: 'run',
      matches: ['run', 'launch'],
      index: '04',
      label: 'Run',
      // A live run wins; otherwise the rail opens the launch screen.
      href: runId !== null ? hrefFor({ view: 'run', runId }) : hrefFor({ view: 'launch', briefId }),
    },
  ]
}

/**
 * Degraded states are shown in the shell, not in a view, because they are true
 * of the whole application. Recording, comprehension and editing all keep
 * working without Daytona — only launching a run does not.
 */
function DegradedBar({ health }: { health: Health }) {
  if (health.status === 'unreachable') {
    return (
      <p
        role="status"
        className="shrink-0 border-b border-danger bg-danger-tint px-6 py-2 text-sm text-danger"
      >
        Cannot reach the Crewmate server on 127.0.0.1:8000. Start it and this bar will clear on its
        own.
      </p>
    )
  }
  if (health.status === 'ready' && !health.detail.daytona) {
    return (
      <p
        role="status"
        className="shrink-0 border-b border-warning bg-warning-tint px-6 py-2 text-sm text-warning"
      >
        Daytona is unavailable, so runs cannot be launched. Recording, comprehension and editing are
        unaffected.
      </p>
    )
  }
  return null
}

export function AppShell({ route, briefId, runId, bleed, health, children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <aside className="flex w-rail shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex flex-col gap-1 px-4 py-6">
          <span className="text-base font-semibold tracking-tight text-text">Crewmate</span>
          <span className="font-mono text-xs text-text-faint">watch once, run everywhere</span>
        </div>

        <nav aria-label="Views" className="flex flex-col gap-1 px-2">
          {navItems(briefId, runId).map((item) => {
            const active = item.matches.includes(route.view)
            return (
              <a
                key={item.view}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'flex h-control items-center gap-3 rounded-sm bg-surface-sunken px-3 text-sm font-medium text-text'
                    : 'flex h-control items-center gap-3 rounded-sm px-3 text-sm font-normal text-text-muted transition-colors duration-fast ease-crewmate hover:bg-surface-raised hover:text-text'
                }
              >
                <span className="font-mono text-xs text-text-faint">{item.index}</span>
                {item.label}
              </a>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-border px-4 py-4">
          <p className="font-mono text-xs text-text-faint">127.0.0.1:8000</p>
          {health.status === 'ready' && health.detail.snapshot !== '' ? (
            <p className="truncate font-mono text-xs text-text-faint">{health.detail.snapshot}</p>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DegradedBar health={health} />
        <main
          className={bleed ? 'min-w-0 flex-1 overflow-hidden' : 'min-w-0 flex-1 overflow-y-auto'}
        >
          {bleed ? children : <div className="mx-auto max-w-content px-8 py-8">{children}</div>}
        </main>
      </div>
    </div>
  )
}
