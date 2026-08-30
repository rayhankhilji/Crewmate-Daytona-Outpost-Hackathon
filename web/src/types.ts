/**
 * Hand-written from docs/DATA_MODEL.md (the Brief contract and the tables) and
 * docs/API.md (the response shapes). Nothing here is inferred from the server
 * implementation — this file and the frozen contract are the agreement.
 */

/* -- The Brief contract ------------------------------------------------- */

export type ActionVerb =
  'invoke_node' | 'set_node_value' | 'focus_node' | 'press_key' | 'hotkey' | 'wait_for'

export const ACTION_VERBS: readonly ActionVerb[] = [
  'invoke_node',
  'set_node_value',
  'focus_node',
  'press_key',
  'hotkey',
  'wait_for',
]

export type NameMatch = 'exact' | 'substring'

export const NAME_MATCHES: readonly NameMatch[] = ['exact', 'substring']

/** Semantic only. A coordinate here is a contract violation. */
export interface StepTarget {
  role: string
  name: string
  name_match: NameMatch
}

export type ConditionElse = 'skip_step' | 'end_workflow'

export interface StepCondition {
  if: string
  else: ConditionElse
}

export interface BriefStep {
  id: number
  intent: string
  action: ActionVerb
  target: StepTarget
  /** Null for actions taking no value. May contain {{variable}} references. */
  value: string | null
  /** Omitted entirely on unconditional steps. */
  condition?: StepCondition
  confidence: number
}

export interface BriefVariable {
  name: string
  source_column: string
  example: string
}

export interface PrunedSegment {
  at_seconds: number
  reason: string
}

export interface Brief {
  task_name: string
  environment: string[]
  variables: BriefVariable[]
  steps: BriefStep[]
  pruned: PrunedSegment[]
}

/** Confidence at or above this renders no marker. See DESIGN.md. */
export const CONFIDENCE_THRESHOLD = 0.7

/* -- Recordings --------------------------------------------------------- */

export type RecordingStatus = 'uploaded' | 'comprehending' | 'comprehended' | 'failed'

export interface RecordingSummary {
  id: string
  task_name: string
  duration_seconds: number
  status: RecordingStatus
  brief_id: string | null
  created_at: string
}

export interface RecordingsResponse {
  recordings: RecordingSummary[]
}

export interface ComprehendAcceptedResponse {
  recording_id: string
  status: 'comprehending'
}

/* -- Briefs ------------------------------------------------------------- */

export interface BriefRecord {
  id: string
  recording_id: string
  version: number
  content: Brief
  created_at: string
  updated_at: string
}

/* -- Runs --------------------------------------------------------------- */

export type RunStatus = 'pending' | 'running' | 'complete' | 'failed'

/**
 * `skipped` is a designed conditional exit, never a failure. DECISIONS.md D8.
 */
export type WorkerStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped'

export type StepResultStatus = 'ok' | 'retried' | 'failed' | 'skipped'

/** One flat row of input data. One row becomes one worker. */
export type InputRow = Record<string, string>

/**
 * The sandbox desktop is baked at this size (ARCHITECTURE.md: VNC_RESOLUTION is
 * fixed at 1280x800 and can only be set at creation). Live screens are scaled
 * from it rather than measured, because the source size is a known constant.
 */
export const SANDBOX_WIDTH = 1280
export const SANDBOX_HEIGHT = 800

export interface WorkerState {
  id: string
  row_index: number
  row_data: InputRow
  status: WorkerStatus
  current_step_id: number | null
  error: string | null
  /**
   * PROPOSED CONTRACT ADDITION — not yet in API.md.
   *
   * The sandbox's live noVNC URL, for watching the worker work in real time
   * rather than through a screenshot every three seconds. Null until the
   * sandbox exists, and null on every server that does not send it yet.
   * The server owns the whole URL including any query parameters; the
   * dashboard never constructs or appends to it.
   */
  preview_url: string | null
}

export interface RunDetail {
  id: string
  brief_id: string
  snapshot_name: string
  status: RunStatus
  started_at: string | null
  finished_at: string | null
  workers: WorkerState[]
}

export interface RunAcceptedResponse {
  id: string
  brief_id: string
  status: 'pending'
  worker_count: number
  created_at: string
}

export type RunResultStatus = 'complete' | 'failed' | 'skipped'

export interface RunResultRow {
  row_index: number
  row_data: InputRow
  status: RunResultStatus
  steps_completed: number
  steps_total: number
  error: string | null
}

export interface RunResultsResponse {
  run_id: string
  results: RunResultRow[]
}

/* -- Health ------------------------------------------------------------- */

export interface HealthResponse {
  ok: boolean
  daytona: boolean
  snapshot: string
  vision_model: string
}

/* -- Server-sent events ------------------------------------------------- */

export type ComprehensionStage = 'sampling' | 'analysing' | 'validating'

export interface ComprehensionProgressEvent {
  stage: ComprehensionStage
  detail: string
}

export interface ComprehensionCompleteEvent {
  brief_id: string
}

export interface StreamErrorEvent {
  code: string
  message: string
}

export interface RunWorkerEvent {
  worker_id: string
  row_index: number
  status: WorkerStatus
  current_step_id: number | null
  /** Base64 JPEG, compressed at scale 0.4 quality 60. Never full resolution. */
  screenshot: string | null
  error: string | null
  /** PROPOSED: live noVNC URL for this worker's sandbox. See WorkerState. */
  preview_url?: string | null
}

export interface RunStepEvent {
  worker_id: string
  step_id: number
  status: StepResultStatus
  duration_ms: number
}

export interface RunStatusEvent {
  status: 'running' | 'complete' | 'failed'
  finished_at: string | null
}

/** Handlers for GET /recordings/{id}/events. */
export interface ComprehensionStreamHandlers {
  onProgress: (event: ComprehensionProgressEvent) => void
  onComplete: (event: ComprehensionCompleteEvent) => void
  onError: (event: StreamErrorEvent) => void
}

/** Handlers for GET /runs/{id}/events. */
export interface RunStreamHandlers {
  onWorker: (event: RunWorkerEvent) => void
  onStep: (event: RunStepEvent) => void
  onRun: (event: RunStatusEvent) => void
  /** Connection dropped; the shell shows a degraded state while reconnecting. */
  onDisconnect: () => void
  onReconnect: () => void
}

/** Every stream returns one of these; calling it detaches all listeners. */
export interface StreamSubscription {
  close: () => void
}
