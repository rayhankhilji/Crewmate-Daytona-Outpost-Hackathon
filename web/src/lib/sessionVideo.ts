/**
 * Builds a downloadable video of a worker's session from the frames that
 * arrived over the run stream.
 *
 * The dashboard never receives a real screen recording — the run stream
 * carries compressed JPEG stills roughly every three seconds — so this is
 * honestly a timelapse of those stills, not continuous video. It is assembled
 * in the browser with MediaRecorder over a canvas, so nothing is uploaded and
 * no server endpoint is required.
 *
 * It lives only as long as the tab does. Persisting it so it can be downloaded
 * again later needs the server to store it; see the note in RunGrid.
 */

export interface SessionFrame {
  /** Milliseconds since the run started, used only for ordering. */
  at: number
  /** Base64 JPEG, exactly as it arrived on the worker event. */
  jpeg: string
}

/** How long each captured still is held on screen in the finished file. */
const HOLD_MS = 500

function loadImage(jpeg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('A captured frame could not be decoded.'))
    image.src = `data:image/jpeg;base64,${jpeg}`
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function canRenderSessionVideo(): boolean {
  return (
    typeof window.MediaRecorder === 'function' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

/**
 * Renders the frames to a webm blob. Takes roughly `frames.length * HOLD_MS`
 * of real time, because MediaRecorder records a live canvas.
 */
export async function renderSessionVideo(frames: readonly SessionFrame[]): Promise<Blob> {
  if (frames.length === 0) {
    throw new Error('This worker never sent a frame, so there is nothing to save.')
  }
  if (!canRenderSessionVideo()) {
    throw new Error('This browser cannot assemble a video from the captured frames.')
  }

  const ordered = [...frames].sort((left, right) => left.at - right.at)
  const images = await Promise.all(ordered.map((frame) => loadImage(frame.jpeg)))

  const canvas = document.createElement('canvas')
  canvas.width = images[0].naturalWidth
  canvas.height = images[0].naturalHeight
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('This browser did not provide a canvas to draw the frames on.')
  }

  // A manual stream: one frame is emitted per requestFrame, so each still is
  // held for exactly as long as we wait before asking for the next one.
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start()
  for (const image of images) {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    track.requestFrame()
    await wait(HOLD_MS)
  }
  recorder.stop()
  await finished
  stream.getTracks().forEach((each) => each.stop())

  return new Blob(chunks, { type: 'video/webm' })
}

/** Hands the finished file to the browser's downloads. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on the next tick so the download has taken the reference.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
