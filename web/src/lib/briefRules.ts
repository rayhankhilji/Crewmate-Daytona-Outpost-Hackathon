import type { Brief, BriefStep } from '../types'
import { ACTION_VERBS, NAME_MATCHES } from '../types'

/**
 * A client-side mirror of contract/brief.schema.json, so an edit that the
 * server would reject is caught at the field that caused it rather than as a
 * 400 after the fact. The server remains the single authority — every save is
 * still validated there, and its message is surfaced verbatim if it disagrees.
 *
 * These rules enforce only what the schema enforces, so this mirror can never
 * refuse a save the server would have accepted. Anything else the server
 * rejects arrives as its own message and is shown verbatim.
 */

export interface FieldError {
  /** Dotted path, e.g. `steps.2.intent`. Matches the input it belongs to. */
  path: string
  message: string
}

const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/
const TASK_NAME_MAX = 200

function targetlessAction(action: string): boolean {
  return action === 'press_key' || action === 'hotkey'
}

export function validateBrief(brief: Brief): FieldError[] {
  const errors: FieldError[] = []

  if (brief.task_name.trim() === '') {
    errors.push({ path: 'task_name', message: 'A Brief needs a task name.' })
  } else if (brief.task_name.length > TASK_NAME_MAX) {
    errors.push({
      path: 'task_name',
      message: `The task name is ${brief.task_name.length} characters; the limit is ${TASK_NAME_MAX}.`,
    })
  }

  brief.environment.forEach((requirement, index) => {
    if (requirement.trim() === '') {
      errors.push({
        path: `environment.${index}`,
        message: 'An environment requirement cannot be blank.',
      })
    }
  })

  const seenNames = new Set<string>()
  brief.variables.forEach((variable, index) => {
    if (!VARIABLE_NAME.test(variable.name)) {
      errors.push({
        path: `variables.${index}.name`,
        message:
          'A variable name must be snake_case: lower-case letters, digits and underscores, starting with a letter.',
      })
    } else if (seenNames.has(variable.name)) {
      errors.push({
        path: `variables.${index}.name`,
        message: `Two variables are both called ${variable.name}.`,
      })
    }
    seenNames.add(variable.name)

    if (variable.source_column.trim() === '') {
      errors.push({
        path: `variables.${index}.source_column`,
        message: 'Name the input column this variable reads from.',
      })
    }
  })

  if (brief.steps.length === 0) {
    errors.push({ path: 'steps', message: 'A Brief needs at least one step.' })
  }

  brief.steps.forEach((step, index) => {
    if (step.intent.trim() === '') {
      errors.push({
        path: `steps.${index}.intent`,
        message: 'Say what this step accomplishes — the intent is shown to the user.',
      })
    }
    if (!ACTION_VERBS.includes(step.action)) {
      errors.push({ path: `steps.${index}.action`, message: `${step.action} is not an action.` })
    }
    if (!NAME_MATCHES.includes(step.target.name_match)) {
      errors.push({
        path: `steps.${index}.target.name_match`,
        message: 'Match must be exact or substring.',
      })
    }
    if (step.confidence < 0 || step.confidence > 1) {
      errors.push({
        path: `steps.${index}.confidence`,
        message: 'Confidence runs from 0 to 1.',
      })
    }
  })

  brief.pruned.forEach((segment, index) => {
    if (segment.reason.trim() === '') {
      errors.push({ path: `pruned.${index}.reason`, message: 'A pruned segment needs a reason.' })
    }
  })

  return errors
}

export function errorFor(errors: readonly FieldError[], path: string): string | undefined {
  return errors.find((error) => error.path === path)?.message
}

/**
 * A caution, not an error. The schema permits an empty role and name on any
 * action, but only press_key and hotkey have a reason to leave them blank —
 * anything else will fail at grounding. Shown so it invites an edit, never
 * blocking a save, because the server is the authority on what is valid.
 */
export function targetCaution(step: BriefStep): string | undefined {
  if (targetlessAction(step.action)) {
    return undefined
  }
  if (step.target.role.trim() === '' || step.target.name.trim() === '') {
    return `${step.action} needs a role and a name to find its target at runtime, or it will fail when the run reaches it.`
  }
  return undefined
}

/**
 * Step ids are stable identity, not position. They are unique but NOT
 * necessarily sequential: deleting a step leaves a gap like [1,2,3,4,6,7] and
 * that is valid. Ids are never rewritten here — reordering and deleting carry
 * each step's id with it, because `step_results.step_id` and
 * `workers.current_step_id` from earlier runs point at them.
 *
 * Sequentiality is deliberately not validated. The server owns Brief
 * validation and does not enforce it.
 */
