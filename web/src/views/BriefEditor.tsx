import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button, ButtonLink } from '../components/Button'
import { Input } from '../components/Input'
import { EmptyState, ErrorState, SkeletonRows } from '../components/states'
import { ViewHeader } from '../components/ViewHeader'
import { getBrief, saveBrief } from '../data'
import { errorFor, targetCaution, validateBrief, type FieldError } from '../lib/briefRules'
import { formatOffset } from '../lib/format'
import { hrefFor } from '../lib/router'
import { messageFor, useAsync } from '../lib/useAsync'
import { CONFIDENCE_THRESHOLD, type Brief, type BriefRecord, type BriefStep } from '../types'

export function BriefEditor({ briefId }: { briefId: string | null }) {
  const { state, reload } = useAsync<BriefRecord | null>(
    (signal) => (briefId === null ? Promise.resolve(null) : getBrief(briefId, signal)),
    [briefId],
  )

  if (briefId === null) {
    return (
      <EmptyState
        message="A Brief is what Owari understood from a recording. Open one to change its steps, targets and variables before launching."
        action={{ label: 'Go to recordings', href: hrefFor({ view: 'recordings' }) }}
      />
    )
  }

  if (state.status === 'loading') {
    return (
      <>
        <ViewHeader title="Brief" meta="loading" />
        <SkeletonRows count={6} className="h-16" />
      </>
    )
  }

  if (state.status === 'error') {
    return (
      <>
        <ViewHeader title="Brief" meta={briefId} />
        <ErrorState message={state.message} onRetry={reload} />
      </>
    )
  }

  if (state.data === null) {
    return (
      <EmptyState
        message="That Brief no longer exists. Pick a recording and open the Brief it produced."
        action={{ label: 'Go to recordings', href: hrefFor({ view: 'recordings' }) }}
      />
    )
  }

  return <BriefForm record={state.data} />
}

function BriefForm({ record }: { record: BriefRecord }) {
  const [draft, setDraft] = useState<Brief>(() => structuredClone(record.content))
  const [saved, setSaved] = useState<BriefRecord>(record)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setDraft(structuredClone(record.content))
    setSaved(record)
  }, [record])

  const errors = useMemo<FieldError[]>(() => validateBrief(draft), [draft])
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved.content),
    [draft, saved],
  )
  // Errors stay quiet until a save is attempted, then follow the fields live.
  const shown: readonly FieldError[] = submitted ? errors : []

  const patchStep = useCallback((index: number, change: Partial<BriefStep>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, position) =>
        position === index ? { ...step, ...change } : step,
      ),
    }))
  }, [])

  const patchTarget = useCallback((index: number, change: Partial<BriefStep['target']>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, position) =>
        position === index ? { ...step, target: { ...step.target, ...change } } : step,
      ),
    }))
  }, [])

  const moveStep = useCallback((index: number, delta: number) => {
    setDraft((current) => {
      const target = index + delta
      if (target < 0 || target >= current.steps.length) {
        return current
      }
      const steps = [...current.steps]
      const [moved] = steps.splice(index, 1)
      steps.splice(target, 0, moved)
      // Order changes; ids do not.
      return { ...current, steps }
    })
  }, [])

  const deleteStep = useCallback((index: number) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, position) => position !== index),
    }))
  }, [])

  const patchVariable = useCallback(
    (index: number, change: Partial<Brief['variables'][number]>) => {
      setDraft((current) => ({
        ...current,
        variables: current.variables.map((variable, position) =>
          position === index ? { ...variable, ...change } : variable,
        ),
      }))
    },
    [],
  )

  const save = useCallback(() => {
    setSubmitted(true)
    setSaveError(null)
    if (validateBrief(draft).length > 0) {
      return
    }
    setSaving(true)
    saveBrief(saved.id, draft)
      .then((updated) => {
        setSaved(updated)
        setDraft(structuredClone(updated.content))
        setSubmitted(false)
      })
      .catch((cause: unknown) => setSaveError(messageFor(cause)))
      .finally(() => setSaving(false))
  }, [draft, saved.id])

  const discard = useCallback(() => {
    setDraft(structuredClone(saved.content))
    setSubmitted(false)
    setSaveError(null)
  }, [saved])

  return (
    <>
      <ViewHeader
        title={saved.content.task_name}
        meta={`v${saved.version} · ${draft.steps.length} steps · ${draft.variables.length} variables · ${draft.pruned.length} pruned${dirty ? ' · unsaved changes' : ''}`}
        action={
          <>
            <ButtonLink href={hrefFor({ view: 'speedrun', briefId: saved.id })}>
              Speedrun
            </ButtonLink>
            <Button onClick={discard} disabled={!dirty || saving}>
              Discard
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      />

      {saveError !== null ? (
        <div className="mb-4">
          <ErrorState message={saveError} onRetry={save} />
        </div>
      ) : null}

      {submitted && errors.length > 0 ? (
        <div className="mb-4">
          <ErrorState
            message={`This Brief cannot be saved yet: ${errors.length} ${
              errors.length === 1 ? 'field needs' : 'fields need'
            } fixing below.`}
          />
        </div>
      ) : null}

      <section className="mb-6 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-text-faint">environment</span>
        {draft.environment.map((requirement) => (
          <span
            key={requirement}
            className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-text-muted"
          >
            {requirement}
          </span>
        ))}
      </section>

      <h2 className="mb-2 text-base font-semibold text-text">Variables</h2>
      <div className="mb-6 overflow-hidden rounded-md border border-border bg-surface shadow-card">
        {draft.variables.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-muted">
            Owari found no input data in this recording — every worker will run identical steps.
          </p>
        ) : (
          draft.variables.map((variable, index) => (
            <div
              key={index}
              className="flex items-start gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <Input
                label="name"
                mono
                value={variable.name}
                onChange={(event) => patchVariable(index, { name: event.target.value })}
                error={errorFor(shown, `variables.${index}.name`)}
              />
              <Input
                label="input column"
                mono
                value={variable.source_column}
                onChange={(event) => patchVariable(index, { source_column: event.target.value })}
                error={errorFor(shown, `variables.${index}.source_column`)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-mono text-xs text-text-faint">observed</span>
                <span className="truncate pt-2 font-mono text-xs text-text-muted">
                  {variable.example}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <h2 className="mb-2 text-base font-semibold text-text">Steps</h2>
      {errorFor(shown, 'steps') !== undefined ? (
        <p className="mb-2 text-xs text-danger">{errorFor(shown, 'steps')}</p>
      ) : null}
      <div className="mb-6 flex flex-col gap-2">
        {draft.steps.map((step, index) => (
          <StepEditor
            key={index}
            step={step}
            index={index}
            first={index === 0}
            last={index === draft.steps.length - 1}
            errors={shown}
            onPatch={patchStep}
            onPatchTarget={patchTarget}
            onMove={moveStep}
            onDelete={deleteStep}
          />
        ))}
      </div>

      <h2 className="mb-2 text-base font-semibold text-text">Pruned</h2>
      <div className="overflow-hidden rounded-md border border-border bg-surface shadow-card">
        {draft.pruned.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-muted">
            Owari found no dead ends in this recording.
          </p>
        ) : (
          draft.pruned.map((segment) => (
            <div
              key={`${segment.at_seconds}-${segment.reason}`}
              className="flex items-baseline gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="font-mono text-xs tabular-nums text-text-faint">
                {formatOffset(segment.at_seconds)}
              </span>
              <span className="text-sm text-text-faint line-through">{segment.reason}</span>
            </div>
          ))
        )}
      </div>
    </>
  )
}

interface StepEditorProps {
  step: BriefStep
  index: number
  first: boolean
  last: boolean
  errors: readonly FieldError[]
  onPatch: (index: number, change: Partial<BriefStep>) => void
  onPatchTarget: (index: number, change: Partial<BriefStep['target']>) => void
  onMove: (index: number, delta: number) => void
  onDelete: (index: number) => void
}

function StepEditor({
  step,
  index,
  first,
  last,
  errors,
  onPatch,
  onPatchTarget,
  onMove,
  onDelete,
}: StepEditorProps) {
  const conditional = step.condition !== undefined

  return (
    <div
      className={`flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card ${
        conditional ? 'border-l-2 border-l-info' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-text-faint">
          {String(step.id).padStart(2, '0')}
        </span>
        <span className="rounded-sm bg-surface-sunken px-1 font-mono text-xs text-text-muted">
          {step.action}
        </span>
        {step.confidence < CONFIDENCE_THRESHOLD ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-warning" />
            <span className="font-mono text-xs text-warning">{step.confidence.toFixed(2)}</span>
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => onMove(index, -1)} disabled={first} aria-label="Move step earlier">
            ↑
          </Button>
          <Button onClick={() => onMove(index, 1)} disabled={last} aria-label="Move step later">
            ↓
          </Button>
          <Button
            variant="danger"
            onClick={() => onDelete(index)}
            aria-label={`Delete step ${step.id}`}
            title="Delete this step"
          >
            ✕
          </Button>
        </div>
      </div>

      <Input
        label="intent"
        value={step.intent}
        onChange={(event) => onPatch(index, { intent: event.target.value })}
        error={errorFor(errors, `steps.${index}.intent`)}
      />

      <div className="flex items-start gap-3">
        <Input
          label="target role"
          mono
          value={step.target.role}
          onChange={(event) => onPatchTarget(index, { role: event.target.value })}
          error={errorFor(errors, `steps.${index}.target.role`)}
        />
        <Input
          label="target name"
          mono
          value={step.target.name}
          onChange={(event) => onPatchTarget(index, { name: event.target.value })}
          error={errorFor(errors, `steps.${index}.target.name`)}
        />
        <Input
          label="value"
          mono
          placeholder={step.value === null ? 'no value for this action' : ''}
          value={step.value ?? ''}
          onChange={(event) =>
            onPatch(index, { value: event.target.value === '' ? null : event.target.value })
          }
        />
      </div>

      {targetCaution(step) !== undefined ? (
        <p className="flex items-center gap-2 text-xs text-warning">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
          {targetCaution(step)}
        </p>
      ) : null}

      {step.condition !== undefined ? (
        <p className="text-xs text-info">
          {`if ${step.condition.if} — ${
            step.condition.else === 'skip_step'
              ? 'otherwise skip this step'
              : 'otherwise end the workflow'
          }`}
        </p>
      ) : null}
    </div>
  )
}
