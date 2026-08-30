import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, ButtonLink } from '../components/Button'
import { ComprehensionProgress } from '../components/ComprehensionProgress'
import { StatusChip, type StatusTone } from '../components/StatusChip'
import { EmptyState, ErrorState, SkeletonRows } from '../components/states'
import { ViewHeader } from '../components/ViewHeader'
import { listRecordings, startComprehension, subscribeToComprehension } from '../data'
import { formatDuration, formatTimestamp, shortId } from '../lib/format'
import { hrefFor, useNavigate } from '../lib/router'
import { messageFor, useAsync } from '../lib/useAsync'
import type { ComprehensionStage, RecordingStatus, RecordingSummary } from '../types'

const STATUS_TONE: Record<RecordingStatus, StatusTone> = {
  uploaded: 'pending',
  comprehending: 'running',
  comprehended: 'complete',
  failed: 'failed',
}

/** Server-driven status changes land within this long. */
const POLL_MS = 4000

interface Progress {
  stage: ComprehensionStage | null
  detail: string | null
}

export function RecordingsList() {
  const navigate = useNavigate()
  const { state, reload } = useAsync<RecordingSummary[]>((signal) => listRecordings(signal), [])

  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [failures, setFailures] = useState<Record<string, string>>({})

  // A recording is only ever comprehended once from here. The list polls and
  // re-renders constantly, and a second POST answers 409, so the guard is a ref
  // that survives every render rather than state that could lag behind one.
  const requested = useRef<Set<string>>(new Set())

  const comprehend = useCallback(
    (recordingId: string) => {
      requested.current.add(recordingId)
      setFailures((current) => {
        const next = { ...current }
        delete next[recordingId]
        return next
      })
      startComprehension(recordingId)
        .then(() => reload())
        .catch((cause: unknown) => {
          // Let a genuine failure be retried; a 409 means it is already going.
          requested.current.delete(recordingId)
          setFailures((current) => ({ ...current, [recordingId]: messageFor(cause) }))
        })
    },
    [reload],
  )

  // The list reflects server-side status changes without a reload.
  useEffect(() => {
    const timer = window.setInterval(reload, POLL_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  // Anything uploaded and not yet comprehended starts on its own.
  useEffect(() => {
    if (state.status !== 'ready') {
      return
    }
    for (const recording of state.data) {
      if (
        recording.status === 'uploaded' &&
        recording.brief_id === null &&
        !requested.current.has(recording.id)
      ) {
        comprehend(recording.id)
      }
    }
  }, [state, comprehend])

  const comprehending =
    state.status === 'ready'
      ? state.data
          .filter((recording) => recording.status === 'comprehending')
          .map((recording) => recording.id)
      : []
  const comprehendingKey = comprehending.join(',')

  useEffect(() => {
    if (comprehendingKey === '') {
      return
    }
    const subscriptions = comprehendingKey.split(',').map((recordingId) =>
      subscribeToComprehension(recordingId, {
        onProgress: (event) =>
          setProgress((current) => ({
            ...current,
            [recordingId]: { stage: event.stage, detail: event.detail },
          })),
        onComplete: (event) => {
          setProgress((current) => {
            const next = { ...current }
            delete next[recordingId]
            return next
          })
          reload()
          // The Brief exists — go straight to watching it assemble.
          navigate({ view: 'speedrun', briefId: event.brief_id })
        },
        onError: (event) => {
          setProgress((current) => {
            const next = { ...current }
            delete next[recordingId]
            return next
          })
          requested.current.delete(recordingId)
          setFailures((current) => ({ ...current, [recordingId]: event.message }))
          reload()
        },
      }),
    )
    return () => subscriptions.forEach((subscription) => subscription.close())
  }, [comprehendingKey, reload, navigate])

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

      {state.status === 'loading' ? (
        <div className="rounded-md border border-border bg-surface p-2 shadow-card">
          <SkeletonRows count={4} className="h-16" />
        </div>
      ) : null}

      {state.status === 'error' ? <ErrorState message={state.message} onRetry={reload} /> : null}

      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState
          message="No recordings yet. Open the Crewmate overlay, type what you are about to do, and press record — it appears here as soon as the upload finishes, and Crewmate starts understanding it on its own."
          hint="cd overlay && npm start"
        />
      ) : null}

      {state.status === 'ready' && state.data.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {state.data.map((recording) => (
            <RecordingRow
              key={recording.id}
              recording={recording}
              progress={progress[recording.id]}
              failure={failures[recording.id]}
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
  progress: Progress | undefined
  failure: string | undefined
  onComprehend: () => void
}

function RecordingRow({ recording, progress, failure, onComprehend }: RecordingRowProps) {
  const working = recording.status === 'comprehending'
  const needsComprehension = recording.status === 'uploaded' || recording.status === 'failed'

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3 shadow-card transition-colors duration-fast ease-crewmate hover:bg-surface-raised">
      <div className="flex items-center gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium text-text">{recording.task_name}</span>
          <span className="font-mono text-xs text-text-faint">
            {shortId(recording.id)} · {formatDuration(recording.duration_seconds)} ·{' '}
            {formatTimestamp(recording.created_at)}
          </span>
        </div>

        <StatusChip tone={STATUS_TONE[recording.status]} label={recording.status} />

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

          {needsComprehension ? (
            <Button variant="primary" onClick={onComprehend}>
              {recording.status === 'failed' ? 'Try again' : 'Comprehend'}
            </Button>
          ) : null}
        </div>
      </div>

      {working ? (
        <ComprehensionProgress stage={progress?.stage ?? null} detail={progress?.detail ?? null} />
      ) : null}

      {failure !== undefined ? <p className="text-sm text-danger">{failure}</p> : null}
    </li>
  )
}
