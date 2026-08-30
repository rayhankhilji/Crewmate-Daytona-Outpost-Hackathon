# Crewmate

Record yourself doing a task once. Crewmate figures out what the task was, and runs it across multiple cloud machines in parallel — one per row of input data.

Built for the Daytona hackathon.

## What it does

A lot of business software has no API. Internal admin panels, legacy portals, old line-of-business tools. Automating those today means either scripting against pixel coordinates (breaks the moment anything moves) or paying someone to click through it manually, one record at a time.

Crewmate replaces the setup work with a single demonstration:

1. **Record** — a floating overlay captures your screen while you do the task once.
2. **Comprehend** — frames are sampled from the video and sent to a vision model, which returns a structured plan: ordered steps, each with a plain-English description and a semantic target, plus any variables and conditional branches it detected.
3. **Review** — the dashboard replays the recording at 8x while the plan assembles against it, so you can see which part of the video produced which step.
4. **Edit** — change any step, delete steps, remap variables to different input columns.
5. **Run** — one Daytona sandbox per input row, all executing the same plan against different data, with live screenshots and status.

## How it works

### Semantic targets, not coordinates

The recording is made on a Mac at one resolution and executed on Linux at another, so captured coordinates are useless. Steps look like this instead:

```json
{
  "id": 4,
  "intent": "Open the leads section",
  "action": "invoke_node",
  "target": { "role": "link", "name": "Leads", "name_match": "exact" },
  "value": null,
  "confidence": 0.96
}
```

At runtime each worker queries the live accessibility tree (AT-SPI, via Daytona's Computer Use API), finds the control by name, and acts on the node it gets back. The JSON schema uses `additionalProperties: false`, so an `x` or `y` field is a hard validation failure rather than a convention.

Matching is on **name**, with `role` used to rank candidates rather than filter them. This was a change made after testing: a model reading a video can see a control's label but has no way to know whether it was implemented as a `link`, a `push button` or a `table cell`. In our own app the "Open" button resolves as a `table cell`. Requiring an exact role match meant correct plans failed on markup details invisible in the recording. With name-based matching, a plan that guessed several roles wrong still executed every step correctly.

### Compiled plan, not an agent loop

The vision model runs once, during comprehension. It is never called per step during execution.

The alternative — an agent reasoning from a prompt at every click — costs seconds per action, produces different behaviour on every run, and doesn't finish inside a demo when you're running several workers. Compiling to a fixed plan means a 10-step workflow executes in about 13 seconds and does the same thing on the next run.

It also makes the plan inspectable, which is what the review and edit steps depend on.

### Pruning

Comprehension separates what you were trying to do from what you actually did. Dead ends, backtracks and corrections are excluded from `steps` and listed separately with a reason:

```json
"pruned": [
  {
    "at_seconds": 12.5,
    "reason": "Opened Settings looking for a report template, found every control disabled, and went back"
  }
]
```

This is the clearest signal that the output is a model of intent rather than a recorded macro.

### Execution

Workers run from a Daytona snapshot that has already been signed into by hand. Crewmate never handles credentials — you log into the target app once inside a sandbox, snapshot that machine, and every worker boots already authenticated.

Per worker:

- `{{variable}}` references are substituted from that worker's input row. A missing column raises rather than typing a literal `{{company}}` into a live system.
- A target that can't be found is retried once, then that worker fails at that step with a readable error. Other workers are unaffected.
- If a conditional step's target isn't present, the worker takes the `else` branch — skip the step, or end the workflow early and finish as `skipped`. That status is deliberately separate from `failed`.
- Compressed screenshots (JPEG, scale 0.4, quality 60) stream to the dashboard over SSE at least every 3 seconds.
- Sandboxes are destroyed on completion and on every failure path, including partial provisioning failures. They're also created `ephemeral` with `auto_delete_interval=0` so Daytona reaps anything that survives a server crash.

A verified two-worker run: one row completed all 10 steps and saved a research report; the other searched, found no matching record, took the conditional branch and ended `skipped`. Same plan, different data, different outcome, no leaked sandboxes.

## Stack

| Component | Built with |
|---|---|
| `overlay/` | Electron, `desktopCapturer` → MediaRecorder → MP4 via ffmpeg |
| `comprehension/` | Python, ffmpeg frame sampling, OpenAI vision |
| `server/` | FastAPI, SQLite, SSE |
| `executor/` | Python, Daytona SDK |
| `web/` | React, Vite, TypeScript strict, Tailwind |
| `contract/` | JSON Schema — the plan format all three modules build against |

Two boundaries are enforced: `executor/` is the only module that imports the Daytona SDK, and `comprehension/` is the only one that imports `openai`. Schema validation lives in a single file that every write path calls, so there's no second implementation to drift.

## Built by three agents in parallel

Crewmate was built in one day by three coding agents working simultaneously against a frozen interface contract, with strict directory ownership so no two agents could touch the same file.

**Codex** built `overlay/` and `comprehension/` — the Electron capture layer including macOS permission handling and upload retry, and the full comprehension pipeline: frame sampling with source timestamps, the vision prompt, and the validate-then-retry loop that turns ~90 stills into a schema-valid plan. Getting a model to preserve typed text verbatim, identify which values are row data, and find its own dead ends to discard is the hardest part of this project.

**Claude Code** ran two seats: one on `web/`, one on `server/` and `executor/`.

Disjoint ownership plus a frozen `contract/` meant zero merge conflicts across the whole build.

## Running it

Requires Python 3.11+, Node 18+, ffmpeg, and a Daytona account.

```bash
cp env.example .env
python3.11 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" python-multipart daytona openai jsonschema
```

```bash
.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 8000   # server
cd web && npm install && npm run dev                             # dashboard on :5173
cd overlay && npm install && npm start                           # recorder
```

### Environment

| Variable | Notes |
|---|---|
| `DAYTONA_API_KEY` | From app.daytona.io/dashboard/keys |
| `CREWMATE_SNAPSHOT_NAME` | A Daytona snapshot you create by booting a sandbox, signing into your target app by hand, and snapshotting it |
| `OPENAI_API_KEY` | |
| `VISION_MODEL` | A vision-capable model id. No default in code, so a renamed model fails at startup rather than mid-run |
| `MAX_PARALLEL_WORKERS` | Must be at or below your Daytona concurrent sandbox limit |

The server binds to `127.0.0.1` only and has no authentication.

## API

```
POST   /recordings                    upload an MP4 with a task name
GET    /recordings                    list, newest first
GET    /recordings/{id}/video         byte-range supported, the review view seeks
POST   /recordings/{id}/comprehend    start comprehension in the background
GET    /recordings/{id}/events        SSE: sampling | analysing | validating
GET    /briefs/{id}                   fetch a plan
PATCH  /briefs/{id}                   replace it, validated, version increments
POST   /runs                          launch, one worker per input row
GET    /runs/{id}                     full run state including every worker
GET    /runs/{id}/events              SSE: worker | step | run
GET    /runs/{id}/results             final results table
GET    /health                        also reports real Daytona reachability
```

Errors are always `{"error": {"code": "...", "message": "..."}}`. Validation failures name the exact path, e.g. `steps[2].target: Additional properties are not allowed ('x' was unexpected)`.
