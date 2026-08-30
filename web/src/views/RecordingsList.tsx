import { useCallback, useEffect, useState } from 'react'

import { Button, ButtonLink } from '../components/Button'
import { StatusChip, type StatusTone } from '../components/StatusChip'
import { EmptyState, ErrorState, SkeletonRows } from '../components/states'
import { ViewHeader } from '../components/ViewHeader'
import { listRecordings, startComprehension, subscribeToComprehension } from '../data'
import { formatDuration, formatTimestamp, shortId } from '../lib/format'
import { hrefFor } from '../lib/router'
import { messageFor, useAsync } from '../lib/useAsync'
import type { ComprehensionStage, RecordingStatus, RecordingSummary } from '../types'

const STATUS_TONE: Record<RecordingStatus, StatusTone> = {
  uploaded: 'pending',
  comprehending: 'running',
  comprehended: 'complete',
  failed: 'failed',
}

const STATUS_LABEL: Record<RecordingStatus, string> = {
  uploaded: 'uploaded',
  comprehending: 'comprehending',
  comprehended: 'comprehended',
  failed: 'failed',
}

const STAGE_LABEL: Record<ComprehensionStage, string> = {
  sampling: 'Sampling frames',
  analysing: 'Reading the recording',
  validating: 'Checking the Brief',
}

export function RecordingsList() {
  const { state, reload } = useAsync<RecordingSummary[]>((signal) => listRecordings(signal), [])

  // Stage text for recordings the server is comprehending right now, so the
  // row shows real work rather than a spinner.
  const [stages, setStages] = useState<Record<string, ComprehensionStage>>({})
  const [starting, setStarting] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const comprehending =
    state.status === 'ready'
      ? state.data.filter((recording) => recording.status === 'comprehending').map((r) => r.id)
      : []
  const comprehendingKey = comprehending.join(',')

  useEffect(() => {
    if (comprehendingKey === '') {
      return
    }
    const subscriptions = comprehendingKey.split(',').map((recordingId) =>
      subscribeToComprehension(recordingId, {
        onProgress: (event) => setStages((current) => ({ ...current, [recordingId]: event.stage })),
        onComplete: () => {
          setStages((current) => {
            const next = { ...current }
            delete next[recordingId]
            return next
          })
          reload()
        },
        onError: (event) => {
          setStages((current) => {
            const next = { ...current }
            delete next[recordingId]
            return next
          })
          setActionError(event.message)
        },
      }),
    )
    return () => subscriptions.forEach((subscription) => subscription.close())
  }, [comprehendingKey, reload])

  const comprehend = useCallback(
    (recordingId: string) => {
      setActionError(null)
      setStarting(recordingId)
      startComprehension(recordingId)
        .then(() => reload())
        .catch((cause: unknown) => setActionError(messageFor(cause)))
        .finally(() => setStarting(null))
    },
    [reload],
  )

  return (
    <>
      <ViewHeader
        title="Recordings"
        meta={
          state.status === 'ready'
            ? `${state.data.length} ${state.data.length === 1 ? 'recording' : 'recordings'}`
            : '—'
        }
      />

      {actionError !== null ? (
        <div className="mb-4">
          <ErrorState message={actionError} onRetry={() => setActionError(null)} />
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <div className="rounded-md border border-border bg-surface p-2 shadow-card">
          <SkeletonRows count={4} className="h-16" />
        </div>
      ) : null}

      {state.status === 'error' ? <ErrorState message={state.message} onRetry={reload} /> : null}

      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState
          message="No recordings yet. Open the Owari overlay, type what you are about to do, and press record — it appears here as soon as the upload finishes."
          hint="cd overlay && npm start"
        />
      ) : null}

      {state.status === 'ready' && state.data.length > 0 ? (
        <ul className="overflow-hidden rounded-md border border-border shadow-card">
          {state.data.map((recording) => (
            <RecordingRow
              key={recording.id}
              recording={recording}
              stage={stages[recording.id]}
              starting={starting === recording.id}
              onComprehend={() => comprehend(recording.id)}
            />
          ))}
        </ul>
      ) : null}
    </>
  )
}

interface RecordingRowProps {
  recording: RecordingSummary
  stage: ComprehensionStage | undefined
  starting: boolean
  onComprehend: () => void
}

function RecordingRow({ recording, stage, starting, onComprehend }: RecordingRowProps) {
  return (
    <li className="flex items-center gap-6 border-b border-border bg-surface px-4 py-3 transition-colors duration-fast ease-owari last:border-b-0 hover:bg-surface-raised">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium text-text">{recording.task_name}</span>
        <span className="font-mono text-xs text-text-faint">
          {shortId(recording.id)} · {formatDuration(recording.duration_seconds)} ·{' '}
          {formatTimestamp(recording.created_at)}
        </span>
      </div>

      <div className="flex w-1/4 shrink-0 flex-col items-start gap-1">
        <StatusChip tone={STATUS_TONE[recording.status]} label={STATUS_LABEL[recording.status]} />
        {stage !== undefined ? (
          <span className="font-mono text-xs text-text-muted">{STAGE_LABEL[stage]}</span>
        ) : null}
        {recording.status === 'failed' ? (
          <span className="text-xs text-danger">
            Owari could not read this recording. Run comprehension again.
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {recording.brief_id !== null ? (
          <>
            <ButtonLink href={hrefFor({ view: 'speedrun', briefId: recording.brief_id })}>
              Speedrun
            </ButtonLink>
            <ButtonLink href={hrefFor({ view: 'brief', briefId: recording.brief_id })}>
              Brief
            </ButtonLink>
            <ButtonLink href={hrefFor({ view: 'launch', briefId: recording.brief_id })}>
              Run
            </ButtonLink>
          </>
        ) : null}

        {recording.status === 'uploaded' || recording.status === 'failed' ? (
          <Button onClick={onComprehend} disabled={starting}>
            {starting ? 'Starting…' : 'Comprehend'}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
