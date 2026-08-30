/** Presentation helpers. Everything here renders in mono. */

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}

/** Clock position inside a recording, e.g. 0:08.4. */
export function formatOffset(seconds: number): string {
  const clamped = Math.max(seconds, 0)
  const minutes = Math.floor(clamped / 60)
  const rest = clamped - minutes * 60
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}

const TIMESTAMP = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return iso
  }
  return TIMESTAMP.format(parsed)
}

/** Short form of a uuid, for rows where the full id is noise. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
