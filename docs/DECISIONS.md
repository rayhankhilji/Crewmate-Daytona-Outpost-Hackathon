# Decisions Log: Owari

> Append-only record of non-obvious decisions and why. The agent adds an entry whenever it makes
> a call that a future reader might otherwise second-guess. Never delete entries; supersede them
> with a new one that references the old.

## Format

Each entry: date · decision · rationale · alternatives rejected · status (accepted / superseded by #N).

Entries marked **ASSUMPTION** were made without explicit confirmation from Rayhan and may be overridden.

---

### D1 — Record on the Mac, execute on a hand-provisioned sandbox
- **Date:** 2026-08-30
- **Decision:** The user records on their own machine. Execution happens on a Daytona sandbox provisioned by hand in advance, with logins already performed and captured in a snapshot. The Brief declares its environment as text only; Owari does not infer or build the environment.
- **Rationale:** Recording locally is the product experience worth having. Automatically reconstructing the recorded machine in the cloud is an unsolved research problem and cannot be in the critical path of a one-day build. Declaring the environment explicitly turns the gap into a visible product surface rather than a hidden failure.
- **Rejected:** (a) recording inside the sandbox over VNC — safer to build but loses the "on my own Mac" moment; (b) full environment inference — correct long-term, not buildable today.
- **Status:** accepted

### D2 — Semantic targets, never coordinates
- **Date:** 2026-08-30
- **Decision:** Brief steps target accessibility `role` + `name`. Any `x`/`y` field is a schema violation. Targets are re-grounded against the live accessibility tree at execution time.
- **Rationale:** The recording is made at one screen size and executed at another. Coordinates cannot survive that translation. Daytona exposes AT-SPI via `find_nodes`, which makes semantic targeting available natively.
- **Rejected:** coordinate replay with scaling — fails across resolutions and on any layout change.
- **Status:** accepted

### D3 — No model call on the execution hot path
- **Date:** 2026-08-30
- **Decision:** The vision model is called at comprehension time and on step-failure retry only. Normal step execution is deterministic.
- **Rationale:** A model call per step means seconds per step, non-determinism, and a parallel run that will not finish inside a demo. Compiling the Brief to a deterministic plan is both faster and a stronger technical claim.
- **Rejected:** per-step agent loop — the common approach, and the reason most demos of this kind fail live.
- **Status:** accepted

### D4 — Exclusive directory ownership per agent
- **Date:** 2026-08-30
- **Decision:** Three coding agents, disjoint directories, a frozen `contract/`, and mandatory mocking of cross-module dependencies.
- **Rationale:** Merge conflicts are the dominant failure mode of parallel agent work. Disjoint file trees make them structurally impossible. A frozen contract lets all three build simultaneously without any blocking on another's progress.
- **Rejected:** shared ownership with coordination — cannot work when agents cannot see each other's context.
- **Status:** accepted

### D5 — Only one module may import each external SDK
- **Date:** 2026-08-30
- **Decision:** `executor/` is the sole importer of `daytona`; `comprehension/` is the sole importer of `openai`.
- **Rationale:** Two agents independently constructing Daytona clients will diverge on lifecycle and leak sandboxes, which costs real credits. It also means only one agent needs the Daytona documentation loaded, which matters on Pro-plan context budgets.
- **Rejected:** a shared utility module — creates a file two agents want to edit, violating D4.
- **Status:** accepted

### D6 — SQLite with plain `sqlite3`, no ORM
- **Date:** 2026-08-30
- **Decision:** Direct `sqlite3` with a thin repository layer.
- **Rationale:** Five tables, one user, one process. An ORM adds setup time and a migration story for no benefit at this size.
- **Rejected:** SQLAlchemy, Postgres — both cost setup time that buys nothing here.
- **Status:** accepted

### D7 — Dark mode only
- **Date:** 2026-08-30
- **Decision:** One theme.
- **Rationale:** Doubling the visual surface costs polish on the speedrun view, which is the only screen that decides anything.
- **Rejected:** light mode, system-preference switching.
- **Status:** accepted

### D8 — `skipped` is a first-class worker status
- **Date:** 2026-08-30
- **Decision:** A worker that exits early via a conditional is `skipped`, rendered distinctly from `failed`.
- **Rationale:** Divergence in the grid is what makes parallel execution read as intelligence rather than a loop. Collapsing it into `failed` or `complete` destroys the most legible evidence that the Brief contains real branching.
- **Rejected:** binary complete/failed.
- **Status:** accepted

### D9 — **ASSUMPTION** — the demo workflow is deliberately unspecified
- **Date:** 2026-08-30
- **Decision:** No specific workflow is named anywhere in the build. The workflow is data — a Brief — and `contract/example-brief.json` is a generic placeholder fixture.
- **Rationale:** Owari must automate anything from watching; hardcoding a workflow into the system would be a design error. The demo workflow is chosen separately and only needs to satisfy the constraints in D10.
- **Rejected:** naming a vertical in the docs — would leak demo choices into product code.
- **Status:** accepted

### D10 — **ASSUMPTION** — required shape of the demo recording
- **Date:** 2026-08-30
- **Decision:** Whatever workflow is chosen, the recorded demonstration must contain at least one input variable, at least one conditional, and at least one deliberate wrong turn to be pruned. Total runtime under 40 seconds per worker.
- **Rationale:** These three are what make comprehension impressive rather than obvious. The pruned wrong turn in particular is the strongest available evidence that the system understood intent rather than recording keystrokes. Under 40 seconds is what allows a parallel run to complete inside a demo window.
- **Rejected:** a clean recording — comprehending a clean recording proves much less.
- **Status:** accepted

### D11 — **ASSUMPTION** — Electron over Tauri for the overlay
- **Date:** 2026-08-30
- **Decision:** Electron.
- **Rationale:** `desktopCapturer` and `MediaRecorder` are well-trodden; Tauri's screen capture needs a Rust path that is slower to get right under time pressure. Bundle size is irrelevant for a local tool.
- **Rejected:** Tauri, native Swift with ScreenCaptureKit — Swift is the better long-term answer and the wrong call for today.
- **Status:** accepted

### D12 — **ASSUMPTION** — vision model unpinned
- **Date:** 2026-08-30
- **Decision:** The model id comes from `VISION_MODEL` with no default in code.
- **Rationale:** Model identifiers change. Hardcoding one that has been renamed produces a confusing runtime failure. Forcing an explicit value fails at startup instead, which is cheaper to diagnose.
- **Rejected:** hardcoding a model string.
- **Status:** accepted

### D13 — Fork/snapshot signatures are unverified
- **Date:** 2026-08-30
- **Decision:** ARCHITECTURE.md documents the Computer Use surface from first-hand reading of the Daytona docs, but the snapshot-from-running-sandbox and fork method signatures were **not** verified. They are marked as such and must be read from the Daytona documentation before `executor/fork.py` is written.
- **Rationale:** Guessing a method name and building on it is the most expensive available failure. Marking the boundary of what is verified prevents an agent treating an inferred signature as documented fact.
- **Rejected:** inferring signatures from changelog descriptions.
- **Status:** accepted
