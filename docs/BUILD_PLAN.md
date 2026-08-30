# Build Plan: Owari

> Chronological execution order, split across three agents working in parallel.
> References features (PRD.md), schema and the Brief contract (DATA_MODEL.md), routes (API.md),
> tokens (DESIGN.md), ownership (ARCHITECTURE.md) — it defines no new facts.

## Directives

- Build only inside the directories your agent owns. See the ownership table in ARCHITECTURE.md.
- `contract/` is frozen. Read it; never edit it. If it looks wrong, stop and raise it.
- Mock your dependencies and keep moving. Never block on another agent.
- No placeholder code, no stub files, no TODO comments. Every file written is functional.
- Strict typing throughout — no `any` in TypeScript, type hints on every Python function.
- One correct path per problem. No fallbacks, no "just in case" branches. If preconditions are not met, raise.
- Every async call, HTTP request, and Daytona call has real error handling. Fail fast, surface the real error.
- **Never invent an SDK method.** If a signature is not in the documentation you were given, stop and ask.
- Flag genuine contradictions between docs before building; do not silently resolve them.

## Phase 0 — Human, before any agent starts

Rayhan only. Nothing below can be trusted until this passes.

- **0.1 — The spike.** Create a sandbox, `computer_use.start()`, open noVNC, log into the target app **by hand**, snapshot the machine, fork it, open the fork's VNC, confirm it is **still logged in**.
- **0.2** — Confirm `find_nodes(role=, name=)` returns usable nodes on that app.
- **0.3** — Set `OWARI_SNAPSHOT_NAME` in `.env`. Confirm the Daytona org's concurrent sandbox limit and set `MAX_PARALLEL_WORKERS` at or below it.
- **Checkpoint:** a fork of the snapshot reaches an authenticated screen without logging in. **If this fails, stop and re-architect — every downstream task assumes it.**

---

# Claude Code #1 — `server/` and `executor/`

Owns every Daytona call and all persistence. The hardest work; start immediately.

**Docs to load:** `docs/` (all), plus from daytona.io — the Computer Use page, Sandboxes, Snapshots, and the fork/snapshot API reference. Nothing else. Do not load `llms-full.txt`.

### 1 — Scaffold
FastAPI app in `server/main.py`, uvicorn on `127.0.0.1:8000`, CORS allowing `http://localhost:5173` only. `GET /health` per API.md, with `daytona` reporting real reachability.
**Checkpoint:** `/health` returns 200.

### 2 — Database
`server/schema.sql` with every table in DATA_MODEL.md, exactly. `server/db.py` with connection handling and repository functions per table. Apply DDL at startup if the file is absent.
**Checkpoint:** schema matches DATA_MODEL.md field for field.

### 3 — Brief validation
`server/brief_schema.py` — one exported function that validates a Brief dict against `contract/brief.schema.json` and raises with the specific failure path. This is the **only** validation implementation in the codebase; every write path calls it.
**Checkpoint:** `contract/example-brief.json` validates; a Brief with an `x` coordinate in a target is rejected.

### 4 — Recordings routes
`POST /recordings`, `GET /recordings`, `GET /recordings/{id}/video` with byte-range support, per API.md.
**Checkpoint:** a curl upload returns 201 and the video streams with a Range header.

### 5 — SSE broadcaster
`server/events.py` — one channel per id, multiple subscribers, clean disconnect. Backs both `/recordings/{id}/events` and `/runs/{id}/events`.
**Checkpoint:** two concurrent curl clients both receive published events.

### 6 — Brief routes
`GET /briefs/{id}`, `PATCH /briefs/{id}`. PATCH replaces `content` wholesale, validates via task 3, increments `version`. Invalid Briefs return 400 with the validation path and do not persist.
**Checkpoint:** an invalid PATCH returns 400 and `version` is unchanged.

### 7 — Daytona client and forking
`executor/daytona_client.py` and `executor/fork.py`. Snapshot the configured sandbox, fork N times, track ids, tear every fork down on completion **and** on failure — a crashed run must not leak sandboxes and burn credits.
**Checkpoint:** 3 forks created from the snapshot, all torn down, verified in the Daytona dashboard.

### 8 — Grounding
`executor/grounding.py` — Brief step target → live accessibility node, via `find_nodes(scope, role, name, name_match)`. Returns the node or raises a typed not-found error. Never falls back to coordinates.
**Checkpoint:** a step target resolves to a real node id inside a fork.

### 9 — Actions and the runner
`executor/actions.py` — one function per action verb in DATA_MODEL.md (`invoke_node`, `set_node_value`, `focus_node`, `press_key`, `hotkey`, `wait_for`). `executor/runner.py` — per-worker step loop with `{{variable}}` substitution from the row, conditional evaluation, retry-once on not-found, screenshot polling at compressed scale 0.4 quality 60, publishing `worker` and `step` events per API.md.
**Checkpoint:** one worker completes `contract/example-brief.json` end to end against a real fork.

### 10 — Runs routes
`POST /runs` (validate rows against the Brief's variables, name any missing column, launch background execution), `GET /runs/{id}`, `GET /runs/{id}/events`, `GET /runs/{id}/results`.
**Checkpoint:** 8 workers launched from one POST, each reporting independently over SSE; killing one mid-run does not affect the others.

---

# Claude Code #2 — `web/`

Owns everything the judges look at. **Zero Daytona knowledge required** — never imports the SDK, never talks to Daytona.

**Docs to load:** `docs/` (all) and `contract/`. Nothing else.

**Start immediately against `contract/example-brief.json` loaded from disk.** Do not wait for the server. Swap to real endpoints at task 18.

### 11 — Scaffold and tokens
Vite + React + TS strict + Tailwind. Every token from DESIGN.md as CSS custom properties and Tailwind theme extensions. Inter and JetBrains Mono loaded.
**Checkpoint:** a page renders using only tokens; no hardcoded hex anywhere in the codebase.

### 12 — Shell and types
App shell with the 240px rail per DESIGN.md. `web/src/types.ts` hand-written from DATA_MODEL.md and API.md. `web/src/api.ts` with every call typed — the only place `fetch` appears.
**Checkpoint:** typecheck passes; navigation between four empty views works.

### 13 — Recordings list
List view with all four required states from DESIGN.md. The empty state points the user at the overlay.
**Checkpoint:** all four states render correctly.

### 14 — Step row component
The core component per DESIGN.md: id, action chip, intent, mono target, confidence marker, `--info` variable chips, conditional treatment with left border and predicate line. Used by both the speedrun view and the editor.
**Checkpoint:** renders every step in the example brief, including the conditional and a low-confidence step.

### 15 — Speedrun view
**The hero. Highest polish, cut last.** Two columns, video at 8×, steps materialising against timestamps (motion 1), pruned segments appearing then greying and collapsing with struck-through reasons (motion 2), variables highlighting on detection, scrub bar with pruned bands and step ticks, header and end-state footer per DESIGN.md. Space toggles play, `R` restarts.
**Checkpoint:** runs start to finish smoothly, restarts ten times without reload, no dropped frames.

### 16 — Brief editor
Edit intent, target role, target name, value, and order. Delete steps. Rename variables and remap `source_column`. Local validation mirrors the server's rules so errors surface before the request.
**Checkpoint:** an edit round-trips; an invalid edit shows a specific inline error and does not submit.

### 17 — Run grid and results
Launch control taking pasted rows. Grid of worker tiles per DESIGN.md consuming `/runs/{id}/events`. `skipped` renders visibly distinct from `failed`. Results table on completion.
**Checkpoint:** eight tiles update live from a stubbed SSE stream; statuses are visually unambiguous.

### 18 — Wire to the real server
Replace disk fixtures with real endpoints. Handle SSE reconnection and the degraded state when `/health` reports `daytona: false`.
**Checkpoint:** full flow against the live server; killing and restarting the server reconnects without a reload.

---

# Codex — `overlay/` and `comprehension/`

Two self-contained modules. **Zero Daytona knowledge required.**

**Docs to load:** `docs/` (all) and `contract/`. Nothing else.

Build `overlay/` first — it produces the input everything else needs.

### 19 — Electron scaffold
`overlay/main.ts` — always-on-top, frameless, non-activating floating window, roughly 320×90, draggable, remembered position. Renderer per DESIGN.md tokens.
**Checkpoint:** the window floats above all applications including fullscreen apps.

### 20 — Capture
`overlay/recorder.ts` — `desktopCapturer` on the primary display, `MediaRecorder` to WebM, remux to MP4 via `ffmpeg-static`. Task-name field, record button, running timer.
**Checkpoint:** a 30-second recording produces a playable MP4 at 1080p or better.

### 21 — Permissions and upload
Detect denied screen-recording permission before starting; show the named macOS permission and a button opening the correct System Settings pane; never produce a black recording. `POST /recordings` per API.md. On upload failure, keep the file and show retry — never discard.
**Checkpoint:** with permission denied, the specific permission is named and no recording starts. With the server down, the file survives and retry succeeds once it is back.

### 22 — Frame sampling
`comprehension/frames.py` — ffmpeg sampling at `FRAME_SAMPLE_FPS`, returning frames with their source timestamps. Timestamps are required: the speedrun view positions steps by them.
**Checkpoint:** a 60-second video yields correctly timestamped frames.

### 23 — The vision prompt
`comprehension/prompt.py`. Given frames plus `task_name`, emit a Brief matching DATA_MODEL.md exactly. The prompt must explicitly demand:
- **Semantic targets only** — accessibility role and name. Any coordinate is a failure.
- **Variable detection** — values typed that look like input data become `{{variable}}` with a `source_column` guess.
- **Conditional detection** — anything done only because of what was on screen.
- **Pruning** — backtracks, wrong turns, and corrections excluded from `steps` and listed in `pruned` with a plain-English reason.
- **`intent` in plain English**, because it is rendered to the user.
- **Calibrated `confidence`** per step.
**Checkpoint:** a recording containing a deliberate wrong turn produces a non-empty `pruned` array and excludes that segment from `steps`.

### 24 — Comprehension pipeline
`comprehension/comprehend.py` — frames + task name → model → parse → validate against `contract/brief.schema.json` → return. On validation failure, retry once with the validation error appended to the prompt, then raise. Never emit a partial or repaired Brief.
**Checkpoint:** produces a Brief that validates; a forced invalid response raises rather than half-succeeding.

### 25 — Progress events
Publish `sampling`, `analysing`, `validating` stages so the dashboard can show real work. Expose a single function the server calls as a background task; the server owns HTTP and persistence, not this module.
**Checkpoint:** all three stages observed on `/recordings/{id}/events`.

### 26 — End-to-end
Record in the overlay → upload → comprehend → brief persisted and visible in the dashboard.
**Checkpoint:** one unbroken pass from pressing record to a Brief on screen.

---

## Integration — Rayhan

- **I1** — Merge branches. Disjoint ownership means no conflicts; if there are any, ownership was violated.
- **I2** — End-to-end: record → comprehend → speedrun → edit → launch → grid → results.
- **I3** — Pin the demo. Fixed input rows, a rehearsed recording containing a deliberate wrong turn, a variable, and a conditional. Run it three times unchanged.
- **I4** — Record a backup video of the full flow. Non-negotiable.

## Time budget

| Time | Gate |
|------|------|
| +45 min | Phase 0 passed. If the fork is not logged in, stop and re-architect. |
| 14:00 | Task 10 (runs routes) and task 24 (comprehension) working. |
| 15:30 | Task 15 (speedrun view) complete. **This gate does not move.** |
| 16:15 | **Hard stop on features.** Backup video, pinned rows, three rehearsals. |

## Cut order when behind

Cut in this order, without negotiation:

1. `MAX_PARALLEL_WORKERS` 8 → 4
2. Results table → the grid's end state alone
3. Brief editor (task 16) → read-only Brief view
4. Live screenshots → status-only tiles
5. Overlay polish → a plain window

**Never cut the speedrun view.** A demo that ends at comprehension, with no execution at all, still wins on the moment where the machine shows it understood the work.
