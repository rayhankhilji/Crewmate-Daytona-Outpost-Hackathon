# PRD: Owari

> Product definition. What is being built and what "done" means per feature.
> Owns: problem, user, scope, features, acceptance. For how it's built see ARCHITECTURE.md;
> for schema see DATA_MODEL.md; for build order see BUILD_PLAN.md.

## 1. Problem

Operations work is trapped in software that has no API and never will — legacy portals, internal admin panels, desktop line-of-business apps. The only way to automate it today is to write brittle scripts against pixel coordinates, or to hire a person to do it by hand, one row at a time. Existing RPA tools require weeks of configuration by a specialist before a single task runs.

Owari removes the configuration step entirely. A person demonstrates the task once, on their own machine, and Owari works out what they were trying to do.

## 2. Target user & core action

**User:** An operations person who does the same multi-step task repeatedly across software that cannot be scripted.

**Core action:** Record yourself doing a task once, review the breakdown Owari produces, and launch it against many rows of input at the same time.

## 3. Scope

**In scope (v1):**
- Mac desktop app with a floating overlay that records the screen and the task name.
- Vision-based comprehension that turns a recording into a structured, human-readable **Brief**.
- Comprehension that detects input variables, at least one conditional branch, and prunes dead-ends and mistakes from the recording.
- A speedrun review view: the recording replays at speed while the Brief assembles against it.
- Brief editing — a human can change, add, or delete any step before launch.
- Parallel execution: one row of input per worker, each worker a forked Daytona sandbox running the compiled Brief.
- Live run view showing every worker's screen and status, and a final results table.

**Explicitly out of scope:**
- Automatic environment inference. Owari does **not** work out which apps and logins a workflow needs. The execution sandbox is provisioned by hand in advance and referenced by snapshot name. The Brief declares its environment requirements as text only.
- Credential capture, credential storage, or automated login. Logins are performed by a human once, inside the sandbox, before the snapshot is taken. Owari never handles a password.
- Scheduling, triggers, cron, or any unattended recurring execution.
- Multi-user accounts, teams, permissions, billing.
- Recording anything other than the primary display.
- Executing on the user's own Mac. All execution happens in Daytona sandboxes.

## 4. Features

### F1 — Overlay recording
A floating always-on-top window sits above all other applications. The user types a task name, presses record, and a timer runs. The user performs the task on their own machine. Pressing stop ends capture, writes an MP4, and uploads it with the task name to the server.

Failure case: if screen-recording permission is not granted, the overlay displays the specific macOS permission required and a button to open the relevant System Settings pane. It does not start a recording that would produce a black video. If the upload fails, the recording is retained on disk and the overlay shows a retry action — the file is never discarded.

### F2 — Comprehension
The server samples frames from the uploaded recording and sends them, with the task name, to a vision model. The model returns a Brief: an ordered list of steps, each with a plain-English `intent` and a **semantic** target expressed as an accessibility role and name. It additionally returns detected variables, at least one conditional where the recording contains one, and a list of pruned segments with reasons.

Steps must never contain pixel coordinates. A recording made at one screen size executes on a sandbox of a different size, so coordinates are meaningless and their presence is a defect.

Failure case: if the model returns output that does not validate against the Brief schema, comprehension fails with a visible error naming the validation failure. It does not silently emit a partial Brief.

### F3 — Speedrun review
The dashboard replays the recording at 8× while the Brief assembles in step with it. Each step appears on the timeline at the moment it was comprehended from. Detected variables highlight as they are found. Pruned segments appear briefly and grey out with their reason shown.

This is the product's primary demonstration surface and must render smoothly with no dropped frames.

### F4 — Brief editing
Every step is editable before launch: its intent, its target role and name, its value, and its position. Steps can be deleted. Variables can be renamed and remapped to a different input column. Edits persist and take effect on the next run.

Failure case: an edit that produces a Brief failing schema validation is rejected at the point of edit with a specific message. Invalid Briefs are never saved.

### F5 — Parallel execution
The user supplies rows of input data and launches. The server forks one sandbox per row from the configured snapshot, and each fork executes the compiled Brief independently. Each step is re-grounded at execution time by searching the live accessibility tree for a node matching the step's role and name — the Brief is never replayed as coordinates.

Failure case: if a step's target cannot be found, the worker captures a screenshot and the accessibility tree, retries once, and on second failure marks itself failed at that step and stops. One worker failing never affects another.

### F6 — Live run view
While a run is in progress, the dashboard shows a tile per worker with a live screenshot, its current step, and its status. Workers that take a conditional branch and finish early are visibly distinct from workers that fail. When the run completes, a results table lists every row with its outcome and the step it reached.

### F7 — Environment declaration
Comprehension emits the environment the workflow requires as a list of human-readable strings. The dashboard displays these before launch alongside the configured snapshot name, so the user can confirm the execution environment matches what they demonstrated. This is a display and confirmation surface only — Owari does not provision it.

## 5. Acceptance criteria

| Feature | Criterion | Pass condition |
|---------|-----------|----------------|
| F1 | Overlay records and uploads | Pressing record then stop produces an MP4 on the server with the task name attached, and the server returns a recording id |
| F1 | Permission failure is explicit | With screen recording permission denied, the overlay shows the named permission and does not produce a recording |
| F2 | Brief validates | Comprehension output validates against the Brief schema in DATA_MODEL.md, or fails loudly with the validation error |
| F2 | No coordinates | No step in any produced Brief contains a numeric x or y target |
| F2 | Pruning works | A recording containing a deliberate wrong turn produces a Brief whose `pruned` array is non-empty and whose `steps` array excludes that segment |
| F2 | Variables detected | A value typed during recording that matches an input column appears in the Brief as a `{{variable}}` reference, not a literal |
| F3 | Speedrun replays | The recording plays at 8× with steps appearing against timestamps and pruned segments greying out |
| F4 | Edits persist | Changing a step's target name and reloading the brief returns the changed value |
| F4 | Invalid edits rejected | An edit producing an invalid Brief returns a specific error and does not save |
| F5 | Forks inherit session | A worker forked from the configured snapshot reaches an authenticated page without logging in |
| F5 | Parallel completion | Eight workers run concurrently from one launch and each reports an independent outcome |
| F5 | Failure is isolated | A worker whose target is missing marks itself failed and stops; other workers complete |
| F6 | Live tiles update | Every running worker's tile updates its screenshot and current step at least once every three seconds |
| F6 | Results table | On completion, every input row appears with an outcome and the step reached |
| F7 | Environment shown | The brief view displays the environment strings and the snapshot name before launch |

**Global (apply to the whole build):**
- Python typed throughout (`from __future__ import annotations`, type hints on every function); TypeScript strict, no `any`.
- Zero console errors on any screen.
- Every input validated at the boundary it enters.
- Every async path has real error handling; nothing is silently swallowed.
- The UI recovers from a dropped SSE connection by reconnecting, and shows a visible degraded state while disconnected.
