/**
 * The only module in web/ that performs network I/O. Every endpoint in
 * docs/API.md has exactly one function here, typed against src/types.ts.
 * Views never construct a URL and never call fetch.
 */
import type {
  Brief,
  BriefRecord,
  ComprehendAcceptedResponse,
  ComprehensionCompleteEvent,
  ComprehensionProgressEvent,
  ComprehensionStreamHandlers,
  HealthResponse,
  InputRow,
  RecordingSummary,
  RecordingsResponse,
  RunAcceptedResponse,
  RunDetail,
  RunResultsResponse,
  RunStatusEvent,
  RunStepEvent,
  RunStreamHandlers,
  RunWorkerEvent,
  StreamErrorEvent,
  StreamSubscription,
} from './types'

/** Loopback only. The server has no auth by design and is never exposed. */
export const API_BASE = 'http://127.0.0.1:8000'

/**
 * Every failure reaching a view is one of these: a code for branching and a
 * message written for a person. A stack trace never gets this far.
 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

const UNREACHABLE_MESSAGE =
  'Cannot reach the Owari server on 127.0.0.1:8000. Start it and try again.'

interface ErrorBody {
  error: { code: string; message: string }
}

function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false
  }
  const detail = (body as { error: unknown }).error
  return (
    typeof detail === 'object' &&
    detail !== null &&
    typeof (detail as { code?: unknown }).code === 'string' &&
    typeof (detail as { message?: unknown }).message === 'string'
  )
}

async function readError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null)
  if (isErrorBody(body)) {
    return new ApiError(body.error.code, body.error.message, response.status)
  }
  return new ApiError(
    'unexpected_response',
    `The server returned ${response.status} without an error message.`,
    response.status,
  )
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  body?: unknown
  signal?: AbortSignal
}

async function request<T>({ method, path, body, signal }: RequestOptions): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause
    }
    throw new ApiError('server_unreachable', UNREACHABLE_MESSAGE, 0)
  }

  if (!response.ok) {
    throw await readError(response)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(
      'malformed_response',
      'The server returned a response that could not be read as JSON.',
      response.status,
    )
  }
}

/* -- Health ------------------------------------------------------------- */

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>({ method: 'GET', path: '/health', signal })
}

/* -- Recordings --------------------------------------------------------- */

export async function listRecordings(signal?: AbortSignal): Promise<RecordingSummary[]> {
  const body = await request<RecordingsResponse>({ method: 'GET', path: '/recordings', signal })
  return body.recordings
}

/** The `<video>` src for the speedrun view. Served with byte-range support. */
export function recordingVideoUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${encodeURIComponent(recordingId)}/video`
}

export function startComprehension(
  recordingId: string,
  signal?: AbortSignal,
): Promise<ComprehendAcceptedResponse> {
  return request<ComprehendAcceptedResponse>({
    method: 'POST',
    path: `/recordings/${encodeURIComponent(recordingId)}/comprehend`,
    signal,
  })
}

/* -- Briefs ------------------------------------------------------------- */

export function getBrief(briefId: string, signal?: AbortSignal): Promise<BriefRecord> {
  return request<BriefRecord>({
    method: 'GET',
    path: `/briefs/${encodeURIComponent(briefId)}`,
    signal,
  })
}

/** PATCH replaces `content` wholesale — always send the complete Brief. */
export function saveBrief(
  briefId: string,
  content: Brief,
  signal?: AbortSignal,
): Promise<BriefRecord> {
  return request<BriefRecord>({
    method: 'PATCH',
    path: `/briefs/${encodeURIComponent(briefId)}`,
    body: { content },
    signal,
  })
}

/* -- Runs --------------------------------------------------------------- */

export function createRun(
  briefId: string,
  rows: InputRow[],
  signal?: AbortSignal,
): Promise<RunAcceptedResponse> {
  return request<RunAcceptedResponse>({
    method: 'POST',
    path: '/runs',
    body: { brief_id: briefId, rows },
    signal,
  })
}

export function getRun(runId: string, signal?: AbortSignal): Promise<RunDetail> {
  return request<RunDetail>({ method: 'GET', path: `/runs/${encodeURIComponent(runId)}`, signal })
}

export function getRunResults(runId: string, signal?: AbortSignal): Promise<RunResultsResponse> {
  return request<RunResultsResponse>({
    method: 'GET',
    path: `/runs/${encodeURIComponent(runId)}/results`,
    signal,
  })
}

/* -- Streams ------------------------------------------------------------ */

/**
 * EventSource reconnects on its own when a connection drops, so there is no
 * retry loop here. What we do own is closing the stream once the server has
 * said its last word — otherwise the browser would reconnect to a finished
 * stream forever.
 */
function parseEvent<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function subscribeToComprehension(
  recordingId: string,
  handlers: ComprehensionStreamHandlers,
): StreamSubscription {
  const source = new EventSource(`${API_BASE}/recordings/${encodeURIComponent(recordingId)}/events`)
  const close = (): void => source.close()

  source.addEventListener('progress', (event: MessageEvent<string>) => {
    const parsed = parseEvent<ComprehensionProgressEvent>(event.data)
    if (parsed !== null) {
      handlers.onProgress(parsed)
    }
  })

  source.addEventListener('complete', (event: MessageEvent<string>) => {
    const parsed = parseEvent<ComprehensionCompleteEvent>(event.data)
    close()
    if (parsed !== null) {
      handlers.onComplete(parsed)
    }
  })

  source.addEventListener('error', (event: Event) => {
    // A named `error` event carries a payload; a bare one is a dropped
    // connection, which EventSource retries by itself.
    if (!(event instanceof MessageEvent)) {
      return
    }
    const parsed = parseEvent<StreamErrorEvent>(event.data as string)
    close()
    handlers.onError(
      parsed ?? {
        code: 'stream_failed',
        message: 'Comprehension stopped reporting progress. Try starting it again.',
      },
    )
  })

  return { close }
}

export function subscribeToRun(runId: string, handlers: RunStreamHandlers): StreamSubscription {
  const source = new EventSource(`${API_BASE}/runs/${encodeURIComponent(runId)}/events`)
  const close = (): void => source.close()
  let connected = false

  source.addEventListener('open', () => {
    if (connected) {
      handlers.onReconnect()
    }
    connected = true
  })

  source.addEventListener('worker', (event: MessageEvent<string>) => {
    const parsed = parseEvent<RunWorkerEvent>(event.data)
    if (parsed !== null) {
      handlers.onWorker(parsed)
    }
  })

  source.addEventListener('step', (event: MessageEvent<string>) => {
    const parsed = parseEvent<RunStepEvent>(event.data)
    if (parsed !== null) {
      handlers.onStep(parsed)
    }
  })

  source.addEventListener('run', (event: MessageEvent<string>) => {
    const parsed = parseEvent<RunStatusEvent>(event.data)
    if (parsed === null) {
      return
    }
    if (parsed.status !== 'running') {
      close()
    }
    handlers.onRun(parsed)
  })

  source.addEventListener('error', () => {
    if (source.readyState === EventSource.CLOSED) {
      return
    }
    handlers.onDisconnect()
  })

  return { close }
}
