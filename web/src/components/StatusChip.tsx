/**
 * The status vocabulary, rendered identically everywhere. The colour mapping
 * is fixed by DESIGN.md: complete → accent, running → text, skipped → info,
 * failed → danger, pending → text-faint.
 */
export type StatusTone = 'complete' | 'running' | 'skipped' | 'failed' | 'pending'

const DOT: Record<StatusTone, string> = {
  complete: 'bg-status-complete',
  running: 'bg-status-running',
  skipped: 'bg-status-skipped',
  failed: 'bg-status-failed',
  pending: 'bg-status-pending',
}

const LABEL: Record<StatusTone, string> = {
  complete: 'text-status-complete',
  running: 'text-status-running',
  skipped: 'text-status-skipped',
  failed: 'text-status-failed',
  pending: 'text-status-pending',
}

export function StatusDot({ tone }: { tone: StatusTone }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
}

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone={tone} />
      <span className={`font-mono text-xs ${LABEL[tone]}`}>{label}</span>
    </span>
  )
}
