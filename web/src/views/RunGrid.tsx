import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '../components/Button'
import { LiveBadge, LiveScreen } from '../components/LiveScreen'
import { StatusChip, type StatusTone } from '../components/StatusChip'
import { EmptyState, ErrorState, SkeletonRows } from '../components/states'
import { ViewHeader } from '../components/ViewHeader'
import { WorkerTile } from '../components/WorkerTile'
import { ApiError } from '../api'
import { createRun, getBrief, getRun, getRunResults, subscribeToRun } from '../data'
import { exampleRows, parseRows } from '../lib/rows'
import { hrefFor, useNavigate } from '../lib/router'
import { messageFor, useAsync } from '../lib/useAsync'
import { SANDBOX_HEIGHT, SANDBOX_WIDTH } from '../types'
import type {
  BriefRecord,
  InputRow,
  RunDetail,
  RunResultRow,
  RunStatus,
  WorkerState,
  WorkerStatus,
} from '../types'

interface RunGridProps {
  runId: string | null
  briefId: string | null
}

export function RunGrid({ runId, briefId }: RunGridProps) {
  if (runId !== null) {
    return <RunMonitor runId={runId} />
  }
  if (briefId === null) {
    return (
      <EmptyState
        message="A run gives every input row its own sandbox and its own tile. Open a Brief, paste your rows, and launch them in parallel."
        action={{ label: 'Go to recordings', href: hrefFor({ view: 'recordings' }) }}
      />
    )
  }
  return <LaunchPanel briefId={briefId} />
}

/* -- Launch --------------------------------------------------------------- */

/**
 * The server's message is authoritative, but a bare HTTP reason is not
 * actionable on its own, so a launch failure says what was being attempted.
 */
function launchFailure(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 404) {
    return `The server could not start this run: ${cause.message}. Confirm the Brief still exists and that the server is running its runs routes.`
  }
  return messageFor(cause)
}

/** A run that cannot be loaded is almost always one that no longer exists. */
function monitorFailure(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.status === 404) {
    return `This run is not on the server any more: ${cause.message}. Launch it again from the Brief.`
  }
  return fallback
}

function LaunchPanel({ briefId }: { briefId: string }) {
  const navigate = useNavigate()
  const { state, reload } = useAsync<BriefRecord>((signal) => getBrief(briefId, signal), [briefId])
  const [text, setText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  const brief = state.status === 'ready' ? state.data.content : null
  // A workflow with no variables takes no input data — answering a mailbox,
  // clearing a queue. It runs once, against a single empty row.
  const takesInput = brief !== null && brief.variables.length > 0
  const parsed = useMemo(
    () => (brief === null || !takesInput ? null : parseRows(text, brief)),
    [brief, takesInput, text],
  )
  const rows = useMemo<InputRow[] | null>(() => {
    if (!takesInput) {
      return [{}]
    }
    return parsed !== null && parsed.ok ? parsed.rows : null
  }, [parsed, takesInput])

  const launch = useCallback(() => {
    setSubmitted(true)
    setLaunchError(null)
    if (rows === null) {
      return
    }
    setLaunching(true)
    createRun(briefId, rows)
      .then((accepted) => navigate({ view: 'run', runId: accepted.id }))
      .catch((cause: unknown) => setLaunchError(launchFailure(cause)))
      .finally(() => setLaunching(false))
  }, [briefId, navigate, rows])

  if (state.status === 'loading') {
    return (
      <>
        <ViewHeader title="Launch a run" meta="loading the Brief" />
        <SkeletonRows count={3} className="h-16" />
      </>
    )
  }

  if (state.status === 'error') {
    return (
      <>
        <ViewHeader title="Launch a run" meta={briefId} />
        <ErrorState message={state.message} onRetry={reload} />
      </>
    )
  }

  const content = state.data.content
  const columns = content.variables.map((variable) => variable.source_column)

  return (
    <>
      <ViewHeader
        title="Launch a run"
        meta={`${content.task_name} · v${state.data.version} · ${content.steps.length} steps`}
        action={
          <Button
            variant="primary"
            size="launch"
            onClick={launch}
            disabled={launching || (takesInput && text.trim() === '')}
          >
            {launching
              ? 'Launching…'
              : !takesInput
                ? 'Run once'
                : rows !== null
                  ? `Launch ${rows.length} ${rows.length === 1 ? 'worker' : 'workers'}`
                  : 'Launch'}
          </Button>
        }
      />

      {launchError !== null ? (
        <div className="mb-4">
          <ErrorState message={launchError} onRetry={launch} />
        </div>
      ) : null}

      <section className="mb-6 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-text-faint">environment</span>
        {content.environment.map((requirement) => (
          <span
            key={requirement}
            className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-text-muted"
          >
            {requirement}
          </span>
        ))}
      </section>

      {takesInput ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 shadow-card">
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor="rows" className="font-mono text-xs text-text-faint">
              input rows — one worker per row, tab or comma separated
            </label>
            {/*
              Seeds the header and one observed row. It deliberately does not
              choose a worker count: MAX_PARALLEL_WORKERS lives on the server
              and /health does not report it, so any number here would be a
              guess that a 409 would correct.
            */}
            <Button onClick={() => setText(exampleRows(content, 1))}>
              Fill a row from the recording
            </Button>
          </div>

          <textarea
            id="rows"
            value={text}
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            placeholder={columns.join('\t')}
            className={`w-full resize-y rounded-sm border bg-surface-raised p-3 font-mono text-xs text-text transition-colors duration-fast ease-owari placeholder:text-text-faint focus:border-border-strong ${
              submitted && parsed !== null && !parsed.ok ? 'border-danger' : 'border-border'
            }`}
            rows={10}
          />

          <p className="font-mono text-xs text-text-muted">
            the Brief reads from {columns.join(', ')}
          </p>

          {submitted && parsed !== null && !parsed.ok ? (
            <p className="text-xs text-danger">{parsed.message}</p>
          ) : null}

          {parsed !== null && parsed.ok ? (
            <p className="font-mono text-xs text-accent">
              {parsed.rows.length} rows · {parsed.columns.join(', ')}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-6 shadow-card">
          <p className="max-w-prose text-sm text-text-muted">
            This workflow takes no input data — Owari found no values in the recording that came
            from a spreadsheet. It runs once, doing the same thing it watched you do.
          </p>
          <p className="font-mono text-xs text-text-faint">1 worker · no input columns</p>
        </div>
      )}
    </>
  )
}

/* -- Monitor -------------------------------------------------------------- */

const TILE_TONE: Record<WorkerStatus, StatusTone> = {
  pending: 'pending',
  running: 'running',
  complete: 'complete',
  failed: 'failed',
  skipped: 'skipped',
}

/** Tile track width and grid gap, used to size the grid to its worker count. */
const TILE_WIDTH = 340
const TILE_GAP = 16

/**
 * Seconds since the run was launched, while it is still going. Provisioning a
 * sandbox per row takes real time, and every tile sits `pending` with no
 * screenshot until its sandbox exists — without a clock that reads as a hang
 * rather than as work.
 */
function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }
    const started = Date.now()
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [active])

  return seconds
}

const STATUS_TONE: Record<RunStatus, StatusTone> = {
  pending: 'pending',
  running: 'running',
  complete: 'complete',
  failed: 'failed',
}

interface LiveWorker extends WorkerState {
  screenshot: string | null
}

function RunMonitor({ runId }: { runId: string }) {
  const { state, reload } = useAsync<RunDetail>((signal) => getRun(runId, signal), [runId])

  const [workers, setWorkers] = useState<Map<string, LiveWorker>>(new Map())
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null)
  const [disconnected, setDisconnected] = useState(false)
  const [results, setResults] = useState<RunResultRow[] | null>(null)
  const [resultsError, setResultsError] = useState<string | null>(null)
  const [stepTotal, setStepTotal] = useState(0)
  const [focused, setFocused] = useState<string | null>(null)
  const seeded = useRef<string | null>(null)

  // Seed from GET /runs/{id} so a reload or a reconnection starts from truth.
  useEffect(() => {
    if (state.status !== 'ready' || seeded.current === runId) {
      return
    }
    seeded.current = runId
    setWorkers(
      new Map(
        state.data.workers.map((worker) => [
          worker.id,
          { ...worker, screenshot: null, preview_url: worker.preview_url ?? null },
        ]),
      ),
    )
    setRunStatus(state.data.status)
  }, [state, runId])

  useEffect(() => {
    if (state.status !== 'ready') {
      return
    }
    getBrief(state.data.brief_id)
      .then((record) => setStepTotal(record.content.steps.length))
      .catch(() => setStepTotal(0))
  }, [state])

  const terminal = runStatus === 'complete' || runStatus === 'failed'
  const elapsed = useElapsed(runStatus !== null && !terminal)

  useEffect(() => {
    if (state.status !== 'ready' || terminal) {
      return
    }
    const subscription = subscribeToRun(runId, {
      onWorker: (event) =>
        setWorkers((current) => {
          const next = new Map(current)
          const existing = next.get(event.worker_id)
          next.set(event.worker_id, {
            id: event.worker_id,
            row_index: event.row_index,
            row_data: existing?.row_data ?? {},
            status: event.status,
            current_step_id: event.current_step_id,
            error: event.error,
            screenshot: event.screenshot ?? existing?.screenshot ?? null,
            // Normalised at the boundary: servers that do not send a live URL
            // yet leave the field absent rather than null.
            preview_url: event.preview_url ?? existing?.preview_url ?? null,
          })
          return next
        }),
      onStep: () => undefined,
      onRun: (event) => setRunStatus(event.status),
      onDisconnect: () => setDisconnected(true),
      onReconnect: () => setDisconnected(false),
    })
    return () => subscription.close()
    // `terminal` gates the subscription; state.status gates the seed.
  }, [runId, state.status, terminal])

  useEffect(() => {
    if (!terminal) {
      return
    }
    getRunResults(runId)
      .then((response) => {
        setResults(response.results)
        setResultsError(null)
      })
      .catch((cause: unknown) => setResultsError(messageFor(cause)))
  }, [terminal, runId])

  if (state.status === 'loading') {
    return (
      <>
        <ViewHeader title="Run" meta="loading" />
        <SkeletonRows count={4} className="h-48" />
      </>
    )
  }

  if (state.status === 'error') {
    return (
      <>
        <ViewHeader title="Run" meta={runId} />
        <ErrorState message={monitorFailure(state.cause, state.message)} onRetry={reload} />
      </>
    )
  }

  const ordered = [...workers.values()].sort((left, right) => left.row_index - right.row_index)
  const tally = (status: WorkerStatus): number =>
    ordered.filter((worker) => worker.status === status).length

  return (
    <>
      <ViewHeader
        title="Run"
        meta={`${ordered.length} workers · snapshot ${state.data.snapshot_name}${
          terminal ? '' : ` · ${elapsed}s elapsed`
        }`}
        action={
          runStatus !== null ? <StatusChip tone={STATUS_TONE[runStatus]} label={runStatus} /> : null
        }
      />

      {disconnected ? (
        <p className="mb-4 rounded-sm border border-warning bg-warning-tint px-3 py-2 text-sm text-warning">
          Lost the event stream. Reconnecting — the tiles below may be a few seconds behind.
        </p>
      ) : null}

      {/*
        Provisioning is the slowest part of a run — one create-from-snapshot per
        row — and until the first worker starts, nothing on screen moves except
        the clock. Say what is happening so a long wait reads as work.
      */}
      {runStatus === 'running' && tally('pending') === ordered.length && ordered.length > 0 ? (
        <p className="mb-4 max-w-prose text-sm text-text-muted">
          Creating one sandbox per row from the snapshot. This is the slowest part of a run — each
          tile shows a screen as soon as its sandbox is up.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-6 font-mono text-xs text-text-muted">
        <span>{tally('complete')} complete</span>
        <span>{tally('running')} running</span>
        <span>{tally('skipped')} skipped</span>
        <span>{tally('failed')} failed</span>
        <span>{tally('pending')} pending</span>
      </div>

      <div
        className="mb-6 grid gap-4"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          // DESIGN.md fixes the track sizing. Capping the container to the
          // natural width of this many tiles stops a small run — the tier
          // limit here is 2 — from stranding two tiles in a wide empty row,
          // while a full run still fills the content width.
          maxWidth: `min(100%, ${ordered.length * TILE_WIDTH + (ordered.length - 1) * TILE_GAP}px)`,
        }}
      >
        {ordered.map((worker) => (
          <WorkerTile
            key={worker.id}
            rowIndex={worker.row_index}
            status={worker.status}
            currentStepId={worker.current_step_id}
            stepTotal={stepTotal}
            screenshot={worker.screenshot}
            error={worker.error}
            previewUrl={worker.preview_url}
            onFocus={() => setFocused(worker.id)}
          />
        ))}
      </div>

      {focused !== null ? (
        <FocusedWorker
          worker={ordered.find((w) => w.id === focused) ?? null}
          stepTotal={stepTotal}
          onClose={() => setFocused(null)}
        />
      ) : null}

      {resultsError !== null ? <ErrorState message={resultsError} /> : null}
      {results !== null ? <ResultsTable results={results} /> : null}
    </>
  )
}

/* -- Focused worker ------------------------------------------------------- */

/**
 * One worker's screen at a size you can actually read, over the grid. The only
 * modal in the app, and the only place --shadow-modal is used, per DESIGN.md.
 */
function FocusedWorker({
  worker,
  stepTotal,
  onClose,
}: {
  worker: LiveWorker | null
  stepTotal: number
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (worker === null) {
    return null
  }

  const live = worker.preview_url !== null && worker.status !== 'pending'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Worker ${worker.row_index}`}
      className="fixed inset-0 z-10 flex items-center justify-center bg-scrim p-8"
      onClick={onClose}
    >
      <div
        style={{ maxWidth: `${SANDBOX_WIDTH}px` }}
        className="flex max-h-full w-full flex-col overflow-hidden rounded-md border border-border bg-surface shadow-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-3">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold text-text">
              Row {String(worker.row_index).padStart(2, '0')}
            </h2>
            <span className="font-mono text-xs text-text-muted">
              {worker.current_step_id === null
                ? 'not started'
                : stepTotal === 0
                  ? `step ${worker.current_step_id}`
                  : `step ${worker.current_step_id}/${stepTotal}`}
            </span>
            <StatusChip tone={TILE_TONE[worker.status]} label={worker.status} />
            {live ? <LiveBadge /> : null}
          </div>
          <Button onClick={onClose} aria-label="Close">
            Close
          </Button>
        </header>

        <div
          className="min-h-0 flex-1 bg-screen"
          style={{ aspectRatio: `${SANDBOX_WIDTH} / ${SANDBOX_HEIGHT}` }}
        >
          {live && worker.preview_url !== null ? (
            <LiveScreen url={worker.preview_url} label={`Worker ${worker.row_index} live screen`} />
          ) : worker.screenshot !== null ? (
            <img
              src={`data:image/jpeg;base64,${worker.screenshot}`}
              alt={`Worker ${worker.row_index} screen`}
              className="h-full w-full object-contain"
            />
          ) : (
            <p className="flex h-full items-center justify-center font-mono text-xs text-text-faint">
              {worker.status === 'pending' ? 'waiting for its sandbox' : 'no screen captured'}
            </p>
          )}
        </div>

        {worker.error !== null ? (
          <p className="shrink-0 border-t border-border px-6 py-3 text-sm text-danger">
            {worker.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/* -- Results -------------------------------------------------------------- */

const RESULT_TONE: Record<RunResultRow['status'], StatusTone> = {
  complete: 'complete',
  skipped: 'skipped',
  failed: 'failed',
}

function ResultsTable({ results }: { results: RunResultRow[] }) {
  const columns = results.length === 0 ? [] : Object.keys(results[0].row_data)

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-text">Results</h2>
      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-mono text-xs font-medium text-text-faint">row</th>
              {columns.map((column) => (
                <th
                  key={column}
                  className="px-4 py-3 font-mono text-xs font-medium text-text-faint"
                >
                  {column}
                </th>
              ))}
              <th className="px-4 py-3 font-mono text-xs font-medium text-text-faint">outcome</th>
              <th className="px-4 py-3 font-mono text-xs font-medium text-text-faint">steps</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.row_index} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-text-faint">
                  {String(result.row_index).padStart(2, '0')}
                </td>
                {columns.map((column) => (
                  <td key={column} className="px-4 py-3 text-sm text-text">
                    {result.row_data[column]}
                  </td>
                ))}
                <td className="px-4 py-3">
                  <StatusChip tone={RESULT_TONE[result.status]} label={result.status} />
                  {result.error !== null ? (
                    <p className="mt-1 text-xs text-danger">{result.error}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums text-text-muted">
                  {result.steps_completed}/{result.steps_total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
