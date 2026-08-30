import type { ComprehensionStage } from '../types'

/**
 * The three stages of comprehension, from GET /recordings/{id}/events.
 *
 * This is the user watching the machine understand, so it shows which stage is
 * running and what it is doing — never a spinner. It is the same argument the
 * speedrun makes, made earlier and in miniature.
 */
const STAGES: readonly { stage: ComprehensionStage; label: string }[] = [
  { stage: 'sampling', label: 'Sampling frames' },
  { stage: 'analysing', label: 'Reading intent' },
  { stage: 'validating', label: 'Checking the Brief' },
]

interface ComprehensionProgressProps {
  /** Null before the first progress event arrives. */
  stage: ComprehensionStage | null
  detail: string | null
}

export function ComprehensionProgress({ stage, detail }: ComprehensionProgressProps) {
  const current = stage === null ? -1 : STAGES.findIndex((entry) => entry.stage === stage)

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex items-center gap-2">
        {STAGES.map((entry, index) => {
          const done = index < current
          const active = index === current
          return (
            <li key={entry.stage} className="flex items-center gap-2">
              <span
                className={
                  active
                    ? 'motion-skeleton h-2 w-2 rounded-full bg-accent'
                    : done
                      ? 'h-2 w-2 rounded-full bg-accent'
                      : 'h-2 w-2 rounded-full bg-border-strong'
                }
              />
              <span
                className={
                  active
                    ? 'font-mono text-xs text-text'
                    : done
                      ? 'font-mono text-xs text-text-muted'
                      : 'font-mono text-xs text-text-faint'
                }
              >
                {entry.label}
              </span>
              {index < STAGES.length - 1 ? (
                <span className="font-mono text-xs text-text-faint">·</span>
              ) : null}
            </li>
          )
        })}
      </ol>
      {detail !== null ? <p className="font-mono text-xs text-text-muted">{detail}</p> : null}
    </div>
  )
}
