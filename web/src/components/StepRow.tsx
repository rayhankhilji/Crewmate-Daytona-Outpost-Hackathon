import { CONFIDENCE_THRESHOLD, type ActionVerb, type BriefStep } from '../types'
import { tokenizeValue } from '../lib/variables'

/**
 * The core component. Used read-only in the speedrun view and as the row body
 * in the editor. Layout is fixed by DESIGN.md: step id, action chip, intent,
 * mono target, right-aligned confidence marker, and a left border in --info
 * with the predicate on a second line when the step is conditional.
 */

const ELSE_LABEL = {
  skip_step: 'otherwise skip this step',
  end_workflow: 'otherwise end the workflow',
} as const

/** press_key and hotkey carry their key in `value` and have an empty target. */
function hasTarget(step: BriefStep): boolean {
  return step.target.role !== '' || step.target.name !== ''
}

function valueLabel(action: ActionVerb): string {
  return action === 'press_key' || action === 'hotkey' ? 'key' : 'value'
}

function ConfidenceMarker({ confidence }: { confidence: number }) {
  // At or above the threshold the step shows nothing — certainty is quiet.
  if (confidence >= CONFIDENCE_THRESHOLD) {
    return null
  }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2"
      title="Owari is unsure about this step. Check it before launching."
    >
      <span className="h-2 w-2 rounded-full bg-warning" />
      <span className="font-mono text-xs text-warning">{confidence.toFixed(2)}</span>
    </span>
  )
}

interface StepValueProps {
  value: string
  /** Variables to animate in as they are detected during the speedrun. */
  detecting: ReadonlySet<string>
}

function StepValue({ value, detecting }: StepValueProps) {
  return (
    <>
      {tokenizeValue(value).map((token, index) =>
        token.kind === 'text' ? (
          <span key={index} className="font-mono text-xs text-text-muted">
            {token.text}
          </span>
        ) : (
          <span
            key={index}
            className={`rounded-sm bg-info-tint px-1 font-mono text-xs text-info ${
              detecting.has(token.name) ? 'motion-detect' : ''
            }`}
          >
            {`{{${token.name}}}`}
          </span>
        ),
      )}
    </>
  )
}

const NO_VARIABLES: ReadonlySet<string> = new Set<string>()

export interface StepRowProps {
  step: BriefStep
  /** Variables highlighted because the replay just reached them. */
  detecting?: ReadonlySet<string>
  /** Row-level status marker, used by the run views. */
  trailing?: React.ReactNode
  /** Standalone card instead of a row in a divided list. */
  card?: boolean
  className?: string
}

export function StepRow({
  step,
  detecting = NO_VARIABLES,
  trailing,
  card = false,
  className,
}: StepRowProps) {
  const conditional = step.condition !== undefined

  return (
    <div
      className={[
        'flex gap-4 bg-surface px-4 py-3 transition-colors duration-fast ease-owari hover:bg-surface-raised',
        card
          ? 'rounded-md border border-border shadow-card'
          : 'border-b border-border last:border-b-0',
        conditional ? 'border-l-2 border-l-info' : '',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <span className="pt-px font-mono text-xs tabular-nums text-text-faint">
        {String(step.id).padStart(2, '0')}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="rounded-sm bg-surface-sunken px-1 font-mono text-xs text-text-muted">
            {step.action}
          </span>
          <span className="text-sm text-text">{step.intent}</span>
        </div>

        {hasTarget(step) ? (
          <p className="truncate font-mono text-xs text-text-muted">
            {`role=${step.target.role} name="${step.target.name}" ${step.target.name_match}`}
          </p>
        ) : null}

        {step.value !== null ? (
          <p className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-xs text-text-faint">{valueLabel(step.action)}=</span>
            <StepValue value={step.value} detecting={detecting} />
          </p>
        ) : null}

        {step.condition !== undefined ? (
          <p className="text-xs text-info">
            {`if ${step.condition.if} — ${ELSE_LABEL[step.condition.else]}`}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-start gap-4 pt-px">
        <ConfidenceMarker confidence={step.confidence} />
        {trailing}
      </div>
    </div>
  )
}
