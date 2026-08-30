import { Button } from './Button'
import { LiveBadge, LiveScreen } from './LiveScreen'
import { StatusChip, type StatusTone } from './StatusChip'
import type { WorkerStatus } from '../types'

/**
 * Per DESIGN.md: --surface with a hairline border, a 2px top border carrying
 * the status colour, the screenshot at 16:10 with object-fit cover, and the
 * row index and current step over a 60% black scrim at bottom-left.
 *
 * The status also appears as a labelled chip beneath the frame. Colour alone
 * would leave `skipped` and `failed` distinguishable only by hue, and the two
 * meaning opposite things is the point of the grid.
 */

const TONE: Record<WorkerStatus, StatusTone> = {
  pending: 'pending',
  running: 'running',
  complete: 'complete',
  failed: 'failed',
  skipped: 'skipped',
}

const TOP_BORDER: Record<WorkerStatus, string> = {
  pending: 'border-t-status-pending',
  running: 'border-t-status-running',
  complete: 'border-t-status-complete',
  failed: 'border-t-status-failed',
  skipped: 'border-t-status-skipped',
}

/**
 * What stands in for a screenshot. A worker can fail before it ever has a
 * sandbox — quota, or a missing snapshot — going straight from pending to
 * failed with no frame, so a terminal tile must never promise one.
 */
const NO_FRAME: Record<WorkerStatus, string> = {
  pending: 'waiting for its sandbox',
  running: 'waiting for a frame',
  complete: 'no screen captured',
  skipped: 'no screen captured',
  failed: 'no screen captured',
}

const LABEL: Record<WorkerStatus, string> = {
  pending: 'pending',
  running: 'running',
  complete: 'complete',
  skipped: 'skipped — conditional exit',
  failed: 'failed',
}

export interface WorkerTileProps {
  rowIndex: number
  status: WorkerStatus
  currentStepId: number | null
  stepTotal: number
  /** Base64 JPEG from the run stream, or null before the first frame. */
  screenshot: string | null
  error: string | null
  /** Live noVNC URL, once the sandbox exists. Preferred over the screenshot. */
  previewUrl: string | null
  /** Opens this worker's screen full size. */
  onFocus: () => void
  /** Frames captured from the run stream, available to save once finished. */
  frameCount: number
  onSaveVideo: () => void
  savingVideo: boolean
}

export function WorkerTile({
  rowIndex,
  status,
  currentStepId,
  stepTotal,
  screenshot,
  error,
  previewUrl,
  onFocus,
  frameCount,
  onSaveVideo,
  savingVideo,
}: WorkerTileProps) {
  const active = status === 'running'
  const finished = status === 'complete' || status === 'failed' || status === 'skipped'
  // A live screen beats a three-second-old screenshot whenever one exists.
  const live = previewUrl !== null && status !== 'pending'

  return (
    <article
      className={`overflow-hidden rounded-md border border-t-2 bg-surface shadow-card transition-colors duration-fast ease-crewmate ${
        TOP_BORDER[status]
      } ${active ? 'border-border-strong' : 'border-border'}`}
    >
      <button
        type="button"
        onClick={onFocus}
        aria-label={`Watch worker ${rowIndex} full size`}
        className="relative block aspect-tile w-full cursor-zoom-in bg-screen"
      >
        {live && previewUrl !== null ? (
          <LiveScreen url={previewUrl} label={`Worker ${rowIndex} live screen`} />
        ) : screenshot === null ? (
          <>
            {/*
              A pending worker is creating its sandbox, which takes a while, so
              it pulses like every other loading surface in the app rather than
              sitting inert for a minute.
            */}
            {status === 'pending' ? (
              <div className="motion-skeleton absolute inset-0 bg-surface" />
            ) : null}
            <p className="absolute inset-0 flex items-center justify-center font-mono text-xs text-text-faint">
              {NO_FRAME[status]}
            </p>
          </>
        ) : (
          <img
            src={`data:image/jpeg;base64,${screenshot}`}
            alt={`Worker ${rowIndex} screen`}
            className="h-full w-full object-cover"
          />
        )}

        {live ? (
          <span className="absolute right-2 top-2">
            <LiveBadge />
          </span>
        ) : null}

        <p className="absolute bottom-0 left-0 bg-scrim px-2 py-1 font-mono text-xs text-on-screen">
          row {String(rowIndex).padStart(2, '0')} ·{' '}
          {currentStepId === null
            ? 'not started'
            : stepTotal === 0
              ? `step ${currentStepId}`
              : `step ${currentStepId}/${stepTotal}`}
        </p>
      </button>

      <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <StatusChip tone={TONE[status]} label={LABEL[status]} />
          {finished && frameCount > 0 ? (
            <Button onClick={onSaveVideo} disabled={savingVideo}>
              {savingVideo ? 'Saving…' : `Save video · ${frameCount} frames`}
            </Button>
          ) : null}
        </div>
        {error !== null ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </article>
  )
}
