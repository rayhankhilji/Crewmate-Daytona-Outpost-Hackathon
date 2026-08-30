# Architecture: Crewmate

> How the system is built and how its parts relate. Schema and the Brief contract live in
> DATA_MODEL.md; endpoint contracts in API.md; feature behaviour in PRD.md; task sequence in BUILD_PLAN.md.

## Stack

- **Overlay (Mac):** Electron 30.x + TypeScript strict. `desktopCapturer` for screen capture, `MediaRecorder` to WebM, `ffmpeg-static` to remux to MP4.
- **Dashboard:** Vite 5.x + React 18 + TypeScript strict + Tailwind 3.x. Plain `fetch` and native `EventSource`. No state library, no data-fetching library — the app has one live data source and adding either is overhead.
- **Server:** Python 3.11+, FastAPI, uvicorn. Typed throughout.
- **Executor:** Python, `daytona` SDK. Runs in-process inside the server as a background task — not a separate service.
- **Comprehension:** Python, `openai` SDK with a vision-capable model. Frame sampling via `ffmpeg`.
- **Database:** SQLite (schema → DATA_MODEL.md).
- **Hosting:** none. Everything runs on the operator's Mac against the Daytona cloud.

**Pinned packages**

```
electron 30.x · typescript 5.x · vite 5.x · react 18.x · tailwindcss 3.x
fastapi · uvicorn[standard] · python-multipart · daytona · openai · jsonschema
```

Install the Daytona SDK with `pip install daytona`.

**Environment variables** (`.env` at project root, loaded by the server; never committed)

```
DAYTONA_API_KEY=            # from app.daytona.io/dashboard/keys
CREWMATE_SNAPSHOT_NAME=        # the hand-provisioned, logged-in snapshot instantiated for every run
OPENAI_API_KEY=
VISION_MODEL=               # vision-capable model id — set explicitly, do not hardcode a default
MAX_PARALLEL_WORKERS=8      # raise only after confirming the Daytona org concurrency limit
FRAME_SAMPLE_FPS=1.5        # frames per second sent to comprehension
SERVER_HOST=127.0.0.1
SERVER_PORT=8000
```

## System pattern

Local monolith with three clients. One FastAPI process owns all state, all Daytona calls, and all model calls. The overlay and the dashboard are thin — they capture input and render output, and hold no business logic.

This is the right shape because the whole system runs on one machine for one user, and because three agents are building in parallel: a single server with a fixed HTTP contract lets each client be developed and tested against a stub without waiting for the others.

The server binds to `127.0.0.1` only. It has no authentication and must never be exposed to a network interface.

## Data flow

```
RECORD      overlay → captures screen → MP4 → POST /recordings → server → disk + recordings row

COMPREHEND  server → ffmpeg samples frames → vision model (frames + task_name)
            → Brief JSON → validate → briefs row

REVIEW      dashboard → GET /briefs/{id} + GET /recordings/{id}/video
            → speedrun replay, user edits → PATCH /briefs/{id}

EXECUTE     dashboard → POST /runs (brief_id + rows)
            → server creates one sandbox per row from CREWMATE_SNAPSHOT_NAME
            → per worker: for each step, find_nodes(role, name) → invoke/set/press
            → screenshots + status streamed to dashboard over SSE
```

The critical property of the execute path: **steps are re-grounded at runtime.** The executor never replays a coordinate. For each step it queries the live accessibility tree in that fork for a node matching the step's role and name, and acts on the node it finds. This is what allows a recording made on a Mac to execute on a Linux sandbox.

## Service boundaries

Each module owns its directory exclusively and communicates only through the HTTP contract in API.md or a function call across a named interface. **No module reaches into another module's directory.**

| Module | Owns | Must not touch |
|--------|------|----------------|
| `overlay/` | Screen capture, the floating window, upload | The database, Daytona, the model |
| `comprehension/` | Frames → Brief JSON | Daytona, the database, HTTP routing |
| `executor/` | Every Daytona call in the system | HTTP routing, the model, the dashboard |
| `server/` | Routes, database, SSE, orchestration, schema validation | Screen capture, direct model prompting |
| `web/` | All rendering | Daytona, the database, the model |

`executor/` is the **only** module that imports the `daytona` SDK. `comprehension/` is the **only** module that imports `openai`. If a second module needs either, that is a design error — route it through the owner.

## Agent ownership

Three coding agents build in parallel. Directory ownership is exclusive and is the mechanism that prevents them colliding.

| Agent | Directories owned | Tasks |
|-------|-------------------|-------|
| **Claude Code #1** (terminal) | `server/`, `executor/` | BUILD_PLAN tasks 1–10 |
| **Claude Code #2** | `web/` | BUILD_PLAN tasks 11–18 |
| **Codex** | `overlay/`, `comprehension/` | BUILD_PLAN tasks 19–26 |
| **Rayhan** (human) | `contract/`, `docs/`, `.env`, merges | The Daytona spike, integration, demo |

Rules that bind every agent:

1. **Create files only inside your own directories.** Never edit another agent's files, not even to fix an obvious bug — report it instead.
2. **`contract/` is read-only for all agents.** It is the frozen interface. If it appears wrong, stop and raise it; do not edit it.
3. **Mock your dependencies; never wait.** The dashboard renders `contract/example-brief.json` from disk until the real endpoint exists. The executor runs against that same example. The overlay POSTs to a stub that returns a fixed id.
4. **Never invent an SDK method.** If a Daytona or OpenAI method signature is not in the docs you were given, stop and ask. Hallucinating a method name and building three files on top of it is the single most expensive failure mode available here.
5. **`git worktree` or three separate clones**, one branch per agent. Rayhan merges. With disjoint ownership there is nothing to conflict.

Only Claude Code #1 needs the Daytona documentation. Give it `docs/en/computer-use.md`, plus the sandboxes, snapshots and VNC-access pages from `daytona.io/docs`, and nothing else. Do not paste `llms-full.txt` into any agent — it is large enough to consume the context budget on a Pro plan.

## Directory structure

```
crewmate/
├── CLAUDE.md                     # agent operating manual (root — auto-loaded)
├── .env                          # never committed
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── API.md
│   ├── DESIGN.md
│   ├── BUILD_PLAN.md
│   └── DECISIONS.md
├── contract/                     # FROZEN — read-only to all agents
│   ├── brief.schema.json
│   └── example-brief.json
├── server/                       # Claude Code #1
│   ├── main.py                   # FastAPI app, route registration, CORS for localhost:5173
│   ├── db.py                     # sqlite3 connection + repository functions
│   ├── schema.sql                # DDL, derived from DATA_MODEL.md
│   ├── brief_schema.py           # THE single validation function for Briefs
│   ├── routes/
│   │   ├── recordings.py
│   │   ├── briefs.py
│   │   └── runs.py
│   ├── events.py                 # SSE broadcaster, one channel per run id
│   └── storage/                  # gitignored
│       └── recordings/
├── executor/                     # Claude Code #1
│   ├── daytona_client.py         # the only file that constructs a Daytona client
│   ├── fork.py                   # snapshot → N worker sandboxes, lifecycle, teardown
│   ├── grounding.py              # step target → live accessibility node
│   ├── actions.py                # one function per Brief action verb
│   └── runner.py                 # per-worker step loop, retry, screenshot polling
├── comprehension/                # Codex
│   ├── frames.py                 # ffmpeg frame sampling
│   ├── prompt.py                 # the vision prompt (see BUILD_PLAN task 23)
│   └── comprehend.py             # frames + task_name → validated Brief
├── overlay/                      # Codex
│   ├── main.ts                   # Electron main process, always-on-top window
│   ├── preload.ts
│   ├── recorder.ts               # desktopCapturer + MediaRecorder + remux
│   └── renderer/                 # the overlay UI
└── web/                          # Claude Code #2
    ├── src/
    │   ├── App.tsx
    │   ├── api.ts                # every fetch call, typed against API.md
    │   ├── types.ts              # TS types generated by hand from DATA_MODEL.md
    │   ├── views/
    │   │   ├── RecordingsList.tsx
    │   │   ├── Speedrun.tsx      # THE hero view
    │   │   ├── BriefEditor.tsx
    │   │   └── RunGrid.tsx
    │   └── components/
    └── index.html
```

## Integrations

### Daytona

- **Purpose:** provides the execution environment. One pre-provisioned snapshot is instantiated once per input row; each worker sandbox is a full Linux desktop with a browser already signed in. "Fork" throughout this project means create-a-sandbox-from-the-snapshot, not the SDK's `fork()` method.
- **Auth:** `DAYTONA_API_KEY`.
- **Key surface** — confirm every signature against the Daytona docs before use:
  - `sandbox.computer_use.start()` — boots Xvfb, xfce4, x11vnc, novnc.
  - `sandbox.computer_use.accessibility.find_nodes(scope=, role=, name=, name_match=, limit=)` — the grounding call. This is the most important method in the project.
  - `sandbox.computer_use.accessibility.invoke_node(id, action=)` / `focus_node(id)` / `set_node_value(id, value)`.
  - `sandbox.computer_use.keyboard.press(key, modifiers)` / `.hotkey(keys)` / `.type(text, delay)`.
  - `sandbox.computer_use.screenshot.take_compressed(ScreenshotOptions(fmt="jpeg", quality=60, scale=0.4))` — grid tiles. Never take full-resolution screenshots on the polling path. The field is `fmt`, **not** `format`; `format` raises a pydantic validation error. Verified against the installed SDK on 2026-08-30.
  - `sandbox.create_snapshot(name, timeout=60)` — captures a running sandbox's filesystem into a reusable snapshot. This is how the hand-provisioned, logged-in machine becomes `CREWMATE_SNAPSHOT_NAME`.
  - `daytona.create(CreateSandboxFromSnapshotParams(snapshot=..., env_vars=..., ephemeral=True, auto_delete_interval=0))` — **this is the per-row fork.** Called once per input row.
  - `sandbox.delete()` — teardown. `ephemeral=True` with `auto_delete_interval=0` is the safety net for a crashed run.
  - **`sandbox.fork()` is not used.** It exists in the SDK but is supported for VM sandboxes only, and Crewmate runs container sandboxes. Verified against the Daytona docs and the installed SDK on 2026-08-30; supersedes the earlier unverified assumption in D13.
- **Display:** Xvfb runs on `:0` inside the sandbox — not `:1`. Anything launched onto the desktop from a shell must set `DISPLAY=:0`.
- **Chromium accessibility (three requirements, all mandatory):** a browser in the sandbox exposes nothing to `find_nodes` unless all three hold. (a) `--force-renderer-accessibility` — Chromium builds its tree lazily and publishes only the window title without it. (b) `DBUS_SESSION_BUS_ADDRESS` must be in the environment — AT-SPI is carried over D-Bus; xfce autostart inherits it, a plain shell does not. (c) the profile lock must be cleared (below). Verified in a live sandbox on 2026-08-30: with all three, `find_nodes(role="link", name="Leads")` returns a real node id; with any one missing it returns nothing.
- **Browser profile locks:** a snapshot of a machine with Chromium running captures the profile's `Singleton*` lock files, which name the machine that created them. Every sandbox booting from that snapshot inherits a lock belonging to a machine that no longer exists, and Chromium refuses to start. The launcher removes `SingletonLock`, `SingletonSocket` and `SingletonCookie` before starting. Cookies — and therefore the baked-in login — live elsewhere in the profile and are untouched.
- **Resolution:** the virtual desktop defaults to `1024x768`. Crewmate fixes it at `1280x800` by passing `VNC_RESOLUTION` in `env_vars` on **every** sandbox creation — the Phase 0 provisioning sandbox and each per-row worker alike. It cannot be changed on a running sandbox.
- **Resources:** CPU, memory and disk are inherited from the snapshot and **cannot be overridden per worker** — `CreateSandboxFromSnapshotParams` exposes no resource fields. Whatever the snapshot was built with is what all workers get.
- **Image:** Computer Use requires the Daytona default sandbox image. A bare OS image (for example `ubuntu:22.04`) has no Xvfb, xfce4, x11vnc or novnc, so `computer_use.start()` has nothing to start and `find_nodes` never returns a node.
- **Failure behaviour:** fork failure fails that worker only and is surfaced in its tile. A failure to reach the Daytona API at all fails the whole run immediately with a real error — never silently degrade to fewer workers than requested.
- **Concurrency:** `MAX_PARALLEL_WORKERS` must not exceed the Daytona organisation's concurrent sandbox limit. Exceeding it fails mid-run, which is worse than launching fewer workers. Confirm the account limit before raising it.

### OpenAI (vision)

- **Purpose:** comprehension only — recording frames plus task name into a Brief. Also used on the executor's retry path to interpret a failure screenshot.
- **Auth:** `OPENAI_API_KEY`, model id from `VISION_MODEL`.
- **Failure behaviour:** a response that fails Brief schema validation is a hard failure with the validation error surfaced. Retry once with the validation error appended to the prompt, then fail. Never emit a partial or repaired Brief.
- **Not on the hot path:** the model is called at comprehension time and on step failure only. It is never called per step during normal execution — that would make runs slow and non-deterministic, and the parallel grid would not complete inside a demo.
