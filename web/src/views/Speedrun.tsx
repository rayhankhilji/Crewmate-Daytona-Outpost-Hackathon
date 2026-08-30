import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, ButtonLink } from '../components/Button'
import { PrunedEntryRow } from '../components/PrunedEntryRow'
import { Scrubber } from '../components/Scrubber'
import { StepRow } from '../components/StepRow'
import { EmptyState, ErrorState, SkeletonRows } from '../components/states'
import { getBrief, recordingVideoUrl } from '../data'
import { formatDuration, formatOffset } from '../lib/format'
import { hrefFor } from '../lib/router'
import {
  buildTimeline,
  prefersReducedMotion,
  revealedCount,
  type TimelineEntry,
} from '../lib/timeline'
import { useAsync } from '../lib/useAsync'
import type { BriefRecord } from '../types'

/** Defaults to 8× per DESIGN.md; adjustable across the whole 1×–16× range. */
const DEFAULT_SPEED = 8

/** Roughly how long a smooth scroll takes to settle. Below this, jump. */
const SMOOTH_SCROLL_BUDGET_MS = 250
const SPEEDS = [1, 2, 4, 8, 16] as const

type Phase = 'idle' | 'playing' | 'paused' | 'finished'

export function Speedrun({ briefId }: { briefId: string | null }) {
  const { state, reload } = useAsync<BriefRecord | null>(
    (signal) => (briefId === null ? Promise.resolve(null) : getBrief(briefId, signal)),
    [briefId],
  )

  if (briefId === null) {
    return (
      <div className="mx-auto max-w-content p-8">
        <EmptyState
          message="The speedrun replays a recording at speed while its Brief assembles against it. Open a comprehended recording to watch."
          action={{ label: 'Go to recordings', href: hrefFor({ view: 'recordings' }) }}
        />
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="mx-auto max-w-content p-8">
        <SkeletonRows count={6} className="h-16" />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-content p-8">
        <ErrorState message={state.message} onRetry={reload} />
      </div>
    )
  }

  if (state.data === null) {
    return (
      <div className="mx-auto max-w-content p-8">
        <EmptyState
          message="That Brief no longer exists. Pick a recording and replay the Brief it produced."
          action={{ label: 'Go to recordings', href: hrefFor({ view: 'recordings' }) }}
        />
      </div>
    )
  }

  return <SpeedrunStage record={state.data} />
}

function SpeedrunStage({ record }: { record: BriefRecord }) {
  const brief = record.content

  const videoRef = useRef<HTMLVideoElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const frameRef = useRef<number>(0)

  const [duration, setDuration] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED)
  const [revealed, setRevealed] = useState(0)
  const [run, setRun] = useState(0)
  const [videoError, setVideoError] = useState<string | null>(null)
  // Hides the step list so the recording gets the full width. The <video>
  // element is never remounted, so toggling never interrupts playback.
  const [theatre, setTheatre] = useState(false)

  const entries = useMemo<TimelineEntry[]>(
    () => (duration === null ? [] : buildTimeline(brief, duration)),
    [brief, duration],
  )

  // The animation frame reads these rather than closing over render state, so
  // the loop survives restarts without being torn down and rebuilt.
  const entriesRef = useRef<TimelineEntry[]>(entries)
  const durationRef = useRef<number | null>(duration)
  entriesRef.current = entries
  durationRef.current = duration

  /** Writes the playhead straight to the DOM — no state changes per frame. */
  const paint = useCallback(() => {
    const video = videoRef.current
    const total = durationRef.current
    if (video === null || total === null || total === 0) {
      return
    }
    const seconds = video.currentTime
    const percent = `${Math.min(seconds / total, 1) * 100}%`

    if (fillRef.current !== null) {
      fillRef.current.style.width = percent
    }
    if (headRef.current !== null) {
      headRef.current.style.left = percent
    }
    if (trackRef.current !== null) {
      trackRef.current.setAttribute('aria-valuenow', String(Math.round(seconds)))
    }
    if (clockRef.current !== null) {
      clockRef.current.textContent = formatOffset(seconds)
    }

    const count = revealedCount(entriesRef.current, seconds)
    setRevealed((current) => (current === count ? current : count))
  }, [])

  useEffect(() => {
    if (phase !== 'playing') {
      return
    }
    const tick = (): void => {
      paint()
      frameRef.current = window.requestAnimationFrame(tick)
    }
    frameRef.current = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [phase, paint])

  useEffect(() => {
    if (videoRef.current !== null) {
      videoRef.current.playbackRate = speed
    }
  }, [speed, duration])

  // The list follows the newest entry. Entries only ever append, so pinning to
  // the bottom keeps whatever just materialised in view.
  //
  // Smooth scrolling takes longer to animate than entries take to arrive at
  // high speeds — at 16x, or on a short recording, reveals land every ~70ms and
  // a queued smooth scroll never catches up, leaving the newest step below the
  // fold. When arrivals are that fast, jump instead: being in view matters more
  // than the easing.
  const lastRevealAt = useRef(0)
  useEffect(() => {
    const list = listRef.current
    if (list === null || revealed === 0) {
      return
    }
    const now = performance.now()
    const rapid = now - lastRevealAt.current < SMOOTH_SCROLL_BUDGET_MS
    lastRevealAt.current = now
    list.scrollTo({
      top: list.scrollHeight,
      behavior: prefersReducedMotion() || rapid ? 'auto' : 'smooth',
    })
  }, [revealed])

  const play = useCallback(() => {
    const video = videoRef.current
    if (video === null) {
      return
    }
    video.playbackRate = speed
    video
      .play()
      .then(() => setPhase('playing'))
      .catch(() =>
        setVideoError('The browser refused to start playback. Click the video and try again.'),
      )
  }, [speed])

  const pause = useCallback(() => {
    videoRef.current?.pause()
    setPhase('paused')
  }, [])

  /**
   * Restart is the control that gets used most during a demo. Everything it
   * touches is reset explicitly — position, revealed entries, error, and the
   * run counter that remounts the list so every motion plays again.
   */
  const restart = useCallback(() => {
    const video = videoRef.current
    if (video === null) {
      return
    }
    video.pause()
    video.currentTime = 0
    video.playbackRate = speed
    setRevealed(0)
    setRun((current) => current + 1)
    setVideoError(null)
    paint()
    video
      .play()
      .then(() => setPhase('playing'))
      .catch(() =>
        setVideoError('The browser refused to start playback. Click the video and try again.'),
      )
  }, [paint, speed])

  const toggle = useCallback(() => {
    if (phase === 'playing') {
      pause()
      return
    }
    if (phase === 'finished') {
      restart()
      return
    }
    play()
  }, [phase, pause, play, restart])

  const seek = useCallback(
    (seconds: number) => {
      const video = videoRef.current
      if (video === null) {
        return
      }
      video.currentTime = seconds
      if (phase === 'finished' && durationRef.current !== null && seconds < durationRef.current) {
        setPhase('paused')
      }
      paint()
    },
    [paint, phase],
  )

  const getCurrentTime = useCallback(() => videoRef.current?.currentTime ?? 0, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        toggle()
        return
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        restart()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle, restart])

  const visible = entries.slice(0, revealed)
  const stepsRevealed = visible.filter((entry) => entry.kind === 'step').length
  const finished = phase === 'finished'

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-text">{brief.task_name}</h1>
          <p className="font-mono text-xs text-text-muted">
            {duration === null ? 'loading recording' : formatDuration(duration)} ·{' '}
            {brief.steps.length} {brief.steps.length === 1 ? 'step' : 'steps'} · {speed}× replay
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {brief.environment.map((requirement) => (
            <span
              key={requirement}
              className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-text-muted"
            >
              {requirement}
            </span>
          ))}
        </div>
      </header>

      <div className={`grid min-h-0 flex-1 gap-6 ${theatre ? 'grid-cols-1' : 'lg:grid-cols-2'}`}>
        <section className="flex min-h-0 flex-col gap-4">
          {/* Top-aligned so the recording lines up with the step list beside
              it, rather than sinking to the bottom of a tall column. */}
          <div className="flex shrink-0 items-start justify-center">
            <div
              className="relative flex max-h-full w-full items-center justify-center overflow-hidden rounded-md border border-border bg-screen shadow-card"
              style={{ aspectRatio: '8 / 5' }}
            >
              <video
                ref={videoRef}
                src={recordingVideoUrl(record.recording_id)}
                className="h-full w-full object-contain"
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  video.playbackRate = speed
                  setDuration(video.duration)
                }}
                onEnded={() => {
                  setPhase('finished')
                  setRevealed(entriesRef.current.length)
                }}
                onError={() =>
                  setVideoError(
                    'The recording could not be loaded. Check the server is serving it.',
                  )
                }
              />
              {videoError !== null ? (
                <p className="absolute inset-x-6 bottom-6 rounded-sm border border-danger bg-surface px-3 py-2 text-sm text-danger">
                  {videoError}
                </p>
              ) : null}
            </div>
          </div>

          {duration === null ? (
            <div className="h-4 w-full rounded-sm border border-border bg-surface" />
          ) : (
            <Scrubber
              duration={duration}
              entries={entries}
              trackRef={trackRef}
              fillRef={fillRef}
              headRef={headRef}
              getCurrentTime={getCurrentTime}
              onSeek={seek}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant={finished ? 'secondary' : 'primary'}
                onClick={toggle}
                disabled={duration === null}
              >
                {phase === 'playing' ? 'Pause' : finished ? 'Replay' : `Play at ${speed}×`}
              </Button>
              <Button onClick={restart} disabled={duration === null}>
                Restart
              </Button>
              <Button onClick={() => setTheatre((current) => !current)}>
                {theatre ? 'Show steps' : 'Full width'}
              </Button>
              <span className="whitespace-nowrap font-mono text-xs text-text-faint">space · r</span>
            </div>

            <div className="flex items-center gap-4">
              <span className="whitespace-nowrap font-mono text-xs tabular-nums text-text-muted">
                <span ref={clockRef}>0:00.0</span>
                {duration === null ? '' : ` / ${formatOffset(duration)}`}
              </span>
              <span className="whitespace-nowrap font-mono text-xs text-text-faint">speed</span>
              <div className="flex items-center gap-1 rounded-sm border border-border p-1">
                {SPEEDS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={option === speed}
                    onClick={() => setSpeed(option)}
                    className={
                      option === speed
                        ? 'rounded-sm bg-surface-raised px-2 py-1 font-mono text-xs text-text'
                        : 'rounded-sm px-2 py-1 font-mono text-xs text-text-muted transition-colors duration-fast ease-crewmate hover:text-text'
                    }
                  >
                    {option}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          hidden={theatre}
          className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-card"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-text">What Crewmate understood</h2>
            <span className="font-mono text-xs tabular-nums text-text-muted">
              {stepsRevealed}/{brief.steps.length} steps
            </span>
          </header>

          <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {revealed === 0 ? (
              <p className="px-4 py-6 text-sm text-text-muted">
                Nothing yet. Press play — each step Crewmate understood is added here as the replay
                reaches it, alongside the dead ends it chose to discard.
              </p>
            ) : (
              visible.map((entry, index) =>
                entry.kind === 'step' ? (
                  <StepRow
                    key={`${run}-step-${entry.step.id}`}
                    step={entry.step}
                    detecting={entry.newVariables}
                    card
                    className="motion-materialise"
                  />
                ) : (
                  <PrunedEntryRow key={`${run}-pruned-${index}`} segment={entry.segment} />
                ),
              )
            )}
          </div>
        </section>
      </div>

      {finished ? (
        <footer className="flex shrink-0 items-center justify-between gap-6 rounded-md border border-border bg-surface px-6 py-4 shadow-card">
          <div className="flex items-center gap-6 font-mono text-xs text-text-muted">
            <span>{brief.steps.length} steps</span>
            <span>{brief.variables.length} variables</span>
            <span>{brief.pruned.length} pruned</span>
          </div>
          <ButtonLink
            href={hrefFor({ view: 'brief', briefId: record.id })}
            variant="primary"
            size="launch"
          >
            Open the Brief
          </ButtonLink>
        </footer>
      ) : null}
    </div>
  )
}
