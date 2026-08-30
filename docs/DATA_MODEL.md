# Data Model: Owari

> Single source of truth for all persisted data **and** for the Brief contract.
> Schema derives from this file only. Referenced (not restated) by ARCHITECTURE.md and API.md.

## Conventions

- Store: SQLite, single file at `server/owari.db`. No ORM — plain `sqlite3` with a thin repository layer in `server/db.py`.
- Primary keys: `TEXT`, a UUID4 string generated in Python. Never integer autoincrement — ids appear in URLs and logs.
- Timestamps: `TEXT`, ISO-8601 UTC. Every table has `created_at`. Mutable tables also have `updated_at`.
- Naming: snake_case, plural table names.
- Delete policy: hard delete. Nothing in this system is worth a tombstone.
- JSON columns are `TEXT` containing serialised JSON, validated on write.

## Tables

### recordings

| Field | Type | Constraints |
|-------|------|-------------|
| id | TEXT | PK, uuid4 |
| task_name | TEXT | NOT NULL — what the user typed in the overlay before recording |
| video_path | TEXT | NOT NULL — path on disk under `server/storage/recordings/` |
| duration_seconds | REAL | NOT NULL |
| status | TEXT | NOT NULL, one of: `uploaded`, `comprehending`, `comprehended`, `failed` |
| error | TEXT | NULL — populated only when status is `failed` |
| created_at | TEXT | NOT NULL |

### briefs

| Field | Type | Constraints |
|-------|------|-------------|
| id | TEXT | PK, uuid4 |
| recording_id | TEXT | NOT NULL, FK → recordings.id, on delete cascade |
| content | TEXT | NOT NULL — the full Brief JSON, validated against the schema below on every write |
| version | INTEGER | NOT NULL, default 1 — incremented on each edit |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |

### runs

| Field | Type | Constraints |
|-------|------|-------------|
| id | TEXT | PK, uuid4 |
| brief_id | TEXT | NOT NULL, FK → briefs.id, on delete restrict |
| snapshot_name | TEXT | NOT NULL — the Daytona snapshot forked for this run |
| rows | TEXT | NOT NULL — JSON array of input row objects, one per worker |
| status | TEXT | NOT NULL, one of: `pending`, `running`, `complete`, `failed` |
| started_at | TEXT | NULL |
| finished_at | TEXT | NULL |
| created_at | TEXT | NOT NULL |

### workers

One per input row. The unit the live grid renders.

| Field | Type | Constraints |
|-------|------|-------------|
| id | TEXT | PK, uuid4 |
| run_id | TEXT | NOT NULL, FK → runs.id, on delete cascade |
| row_index | INTEGER | NOT NULL — position in the run's `rows` array |
| row_data | TEXT | NOT NULL — JSON object, this worker's input row |
| sandbox_id | TEXT | NULL — Daytona sandbox id, set once the fork exists |
| status | TEXT | NOT NULL, one of: `pending`, `running`, `complete`, `failed`, `skipped` |
| current_step_id | INTEGER | NULL — the step currently executing |
| last_screenshot | TEXT | NULL — base64 JPEG, most recent frame; overwritten each poll |
| error | TEXT | NULL |
| created_at | TEXT | NOT NULL |

`skipped` is distinct from `complete` and `failed`: it means the worker took a conditional branch that ended the workflow early by design. The grid must render it differently from a failure.

### step_results

| Field | Type | Constraints |
|-------|------|-------------|
| id | TEXT | PK, uuid4 |
| worker_id | TEXT | NOT NULL, FK → workers.id, on delete cascade |
| step_id | INTEGER | NOT NULL — the `id` of the step within the Brief |
| status | TEXT | NOT NULL, one of: `ok`, `retried`, `failed`, `skipped` |
| resolved_target | TEXT | NULL — JSON of the accessibility node actually matched at runtime |
| error | TEXT | NULL |
| duration_ms | INTEGER | NOT NULL |
| created_at | TEXT | NOT NULL |

## Relationships

- recordings → briefs: one-to-many. On delete: cascade.
- briefs → runs: one-to-many. On delete: restrict — a brief with run history cannot be deleted.
- runs → workers: one-to-many. On delete: cascade.
- workers → step_results: one-to-many. On delete: cascade.

## Indexes

- `workers(run_id)` — the live grid queries every worker for a run on each SSE tick. The only hot read path in the system.
- `step_results(worker_id)` — the results table expands a worker into its step history.

No other indexes. Every other table is read by primary key.

## Access policies

Single-user local application. No authentication, no row-level security. The server binds to `127.0.0.1` only — see ARCHITECTURE.md. Do not add an auth layer; it is explicitly out of scope in PRD.md.

---

## The Brief contract

**This is the most important definition in the project.** All three agents build against it. It is frozen — no agent may change it. A machine-readable copy is committed at `contract/brief.schema.json` and an example at `contract/example-brief.json`; both are generated verbatim from this section, and this section wins any disagreement.

### Rules

1. **Targets are semantic, never spatial.** A target is an accessibility `role` plus `name`. Any `x` or `y` field is a defect. The recording is made at one resolution and executed at another; coordinates cannot survive that.
2. **`intent` is user-facing prose.** It is what the speedrun view renders. Plain English, imperative, no jargon.
3. **`pruned` is required, not decorative.** It is how the product demonstrates that it understood intent rather than recording keystrokes. An empty `pruned` array is valid but the comprehension prompt must explicitly hunt for dead-ends.
4. **Variables are referenced as `{{name}}`** inside a step's `value`. Never inline a literal that came from input data.

### Schema

```json
{
  "task_name": "string — what the user typed in the overlay",
  "environment": ["string — human-readable requirement, e.g. 'browser', 'CRM (logged in)'"],
  "variables": [
    {
      "name": "string — snake_case identifier used as {{name}}",
      "source_column": "string — column in the input rows this maps to",
      "example": "string — the literal value observed in the recording"
    }
  ],
  "steps": [
    {
      "id": "integer — 1-based, unique, sequential",
      "intent": "string — plain English, what this step accomplishes",
      "action": "string — one of: invoke_node | set_node_value | focus_node | press_key | hotkey | wait_for",
      "target": {
        "role": "string — accessibility role, e.g. button, entry, menu item",
        "name": "string — accessible name to match",
        "name_match": "string — exact | substring"
      },
      "value": "string | null — text to enter; may contain {{variable}} references",
      "condition": {
        "if": "string — plain English predicate evaluated against the current screen",
        "else": "string — one of: skip_step | end_workflow"
      },
      "confidence": "number — 0.0 to 1.0, the model's certainty about this step"
    }
  ],
  "pruned": [
    {
      "at_seconds": "number — timestamp in the recording",
      "reason": "string — why this segment was excluded, in plain English"
    }
  ]
}
```

### Field rules

- `steps[].condition` is optional and omitted entirely on unconditional steps. When present, `else` decides what happens when the predicate is false.
- `steps[].value` is `null` for actions that take no value (`invoke_node`, `focus_node`).
- `press_key` and `hotkey` carry their key in `value` (e.g. `"enter"`, `"ctrl+s"`) and use an empty `target`.
- `wait_for` polls for the target to appear and takes no `value`. It exists so the executor can wait on page loads without sleeping blindly.
- `confidence` below 0.7 renders with a visible uncertainty marker in the dashboard — see DESIGN.md.
- Validation is enforced in exactly one place: `server/brief_schema.py`. Every write path calls it. No module validates a Brief independently.
