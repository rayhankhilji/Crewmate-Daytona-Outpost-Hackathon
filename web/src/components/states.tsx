import type { ReactNode } from 'react'

import { Button, ButtonLink } from './Button'

/**
 * The four required UI states from DESIGN.md. Every data view uses these so
 * loading, empty and error read identically across the app.
 */

interface SkeletonRowsProps {
  count: number
  /** Row height, from the spacing scale. */
  className?: string
}

/** Loading: skeleton rows at --surface. No spinner — the wait is determinate. */
export function SkeletonRows({ count, className }: SkeletonRowsProps) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={`motion-skeleton rounded-md bg-surface-raised ${className ?? 'h-12'}`}
          style={{ animationDelay: `${index * 60}ms` }}
        />
      ))}
    </div>
  )
}

interface EmptyStateProps {
  /** One line explaining what will appear here. */
  message: string
  /** The single action that produces the missing content. */
  action?: { label: string; href: string }
  /** Shown under the message in mono when the action is outside the app. */
  hint?: ReactNode
}

/** Empty: designed, never blank. */
export function EmptyState({ message, action, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-md border border-border bg-surface px-8 py-16 text-center shadow-card">
      <p className="max-w-prose text-sm text-text-muted">{message}</p>
      {hint !== undefined ? <p className="font-mono text-xs text-text-faint">{hint}</p> : null}
      {action !== undefined ? <ButtonLink href={action.href}>{action.label}</ButtonLink> : null}
    </div>
  )
}

interface ErrorStateProps {
  /** Human-readable. Never a code, never a stack trace. */
  message: string
  /** Omitted when retrying cannot help. */
  onRetry?: () => void
}

/** Error: actionable, in --danger, with a retry where retrying means something. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-4 rounded-md border border-danger bg-danger-tint p-6 shadow-card"
    >
      <p className="text-sm text-danger">{message}</p>
      {onRetry !== undefined ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
