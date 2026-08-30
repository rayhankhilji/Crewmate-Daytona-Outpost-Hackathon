# Owari

**Watch a person do a task once. Work out what they were trying to do. Then do it at scale, in parallel cloud sandboxes.**

Owari records someone working, turns that recording into a readable plan, lets them correct it, and then executes that plan across many machines at the same time — one per row of input.

---

## The problem

Operations work is trapped in software that has no API and never will: legacy portals, internal admin panels, line-of-business desktop apps. The only ways to automate it today are to write brittle scripts against pixel coordinates, or to pay a person to do it by hand, one row at a time. Existing RPA tools need weeks of configuration by a specialist before a single task runs.

Owari removes the configuration step. You demonstrate the task once.

---

## The loop

```
RECORD      A floating overlay records the screen while you do the task once.

COMPREHEND  Frames are sampled and sent to a vision model, which returns a Brief:
            an ordered list of steps, each with a plain-English intent and a
            semantic target — plus detected variables, conditional branches, and
            the dead-ends it decided to throw away.

REVIEW      The recording replays at 8x while the Brief assembles against it.
            Steps appear on the timeline where they were comprehended from.
            Pruned segments surface, grey out, and collapse with their reason.

EDIT        Every step is editable. Change a target, delete a step, remap a
            variable to a different input column.

EXECUTE     One sandbox per input row. Each runs the same Brief against different
            data, and reports its screen and status live.
```

---

## The two ideas that make it work

### 1. Targets are semantic, never spatial

A Brief step does not say *click at (431, 208)*. It says:

```json
{
  "intent": "Open the leads section",
  "action": "invoke_node",
  "target": { "role": "link", "name": "Leads", "name_match": "exact" }
}
```

At execution time the worker queries the **live accessibility tree** of the machine it is actually looking at and acts on the node it finds. That is what lets a recording made on a Mac at one resolution run on a Linux sandbox at another. The schema rejects any `x` or `y` field outright — `additionalProperties: false` means coordinates cannot be added even by accident.

Matching is on the **name**, with `role` used to rank candidates rather than filter them. This is deliberate and was learned the hard way: a model watching a video can read a control's label, but it cannot know whether the page implemented that control as a `link`, a `push button`, or a `table cell`. Those are invisible markup details that differ between two applications that look identical. In a real run, a Brief guessed several roles wrong — the control it wanted was a `table cell` — and every step still landed correctly.

### 2. The plan is compiled, not improvised

The vision model is called at comprehension time and on failure only. It is **never** called per step during execution.

Most demos of this kind run an agent loop per worker: a model call for every click, seconds each, non-deterministic, different every run. Owari compiles the recording into a deterministic plan once, then replays it. Ten steps execute in about thirteen seconds, and they execute the same way tomorrow.

This is also what makes the Brief the *product surface* rather than an implementation detail. Because the plan is explicit, it can be rendered assembling against the video, and a human can correct step 4 before launching.

---

## Pruning: how you can tell it understood

The strongest evidence that a system modelled *intent* rather than recording keystrokes is what it throws away.

If the person opens a settings page, finds nothing useful, and navigates back, that is not part of the task. Owari excludes it from `steps` and records it in `pruned` with a plain-English reason:

```json
"pruned": [
  {
    "at_seconds": 12.5,
    "reason": "Opened Settings looking for a report template, found every control disabled, and went back"
  }
]
```

An empty `pruned` array is valid. A comprehension pass that never produces one on a messy recording is suspect.

---

## Architecture

```
overlay/         Electron. Screen capture, the floating window, upload.
comprehension/   Frames -> vision model -> validated Brief.
server/          FastAPI. Routes, SQLite, SSE, orchestration, validation.
executor/        Every Daytona call in the system. Grounding, actions, the step loop.
web/             React + Vite. All rendering.
contract/        The frozen Brief schema. Read-only to every module.
```

Each module owns its directory exclusively and talks to the others only through the HTTP contract or a named function boundary. Two rules are enforced by convention and worth knowing:

- **`executor/` is the only module that imports the Daytona SDK.** Two modules constructing sandbox clients independently would diverge on lifecycle and leak sandboxes, which costs real money.
- **`comprehension/` is the only module that imports `openai`.**

Validation lives in exactly one place, `server/brief_schema.py`, and every write path calls it. There is no second validator to drift out of sync.

### Execution, in detail

A run creates one sandbox per input row from a pre-provisioned snapshot — a machine that a human has already signed into by hand. Owari never handles a password; the login is baked into the snapshot before any automation runs.

Each worker then walks the Brief:

- `{{variable}}` references are substituted from that worker's row. An undeclared variable or a missing column **raises** rather than typing a literal `{{company}}` into a live application.
- A target that cannot be found is retried once, then the worker fails at that step with a readable error. One worker failing never affects another.
- A conditional step whose target is absent takes its `else` branch — either skipping the step or ending the workflow early, which marks that worker `skipped`. That status is deliberately distinct from `failed`: it means the data led somewhere different, by design.
- Compressed screenshots stream to the dashboard at least every three seconds.

Every sandbox is destroyed on completion **and** on every failure path, including a crash part-way through provisioning. Sandboxes are additionally created `ephemeral`, so Daytona reaps anything that outlives the server process.

---

## Running it

Requires Python 3.11+, Node 18+, ffmpeg, and a Daytona account.

```bash
cp env.example .env      # then fill it in — see below
python3.11 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" python-multipart daytona openai jsonschema
```

```bash
.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 8000    # server
cd web && npm install && npm run dev                              # dashboard, :5173
cd overlay && npm install && npm start                            # recorder
```

### Configuration

| Variable | Where it comes from |
|---|---|
| `DAYTONA_API_KEY` | app.daytona.io/dashboard/keys |
| `OWARI_SNAPSHOT_NAME` | A snapshot you create by hand: boot a sandbox, sign into your target application, snapshot it. This is the machine every worker forks from. |
| `OPENAI_API_KEY` | platform.openai.com |
| `VISION_MODEL` | A vision-capable model id. Set explicitly — there is no default in code, so a renamed model fails at startup rather than confusingly at runtime. |
| `MAX_PARALLEL_WORKERS` | Must not exceed your Daytona organisation's concurrent sandbox limit. Exceeding it fails mid-run, which is worse than launching fewer. |

The server binds to `127.0.0.1` only and has **no authentication by design**. Do not expose it.

---

## Notable decisions

Recorded in full in `docs/DECISIONS.md`. The ones worth knowing:

- **The execution environment is provisioned by hand, not inferred.** Working out which applications and logins a workflow needs is an unsolved research problem. Owari declares the environment as text and forks a snapshot a human prepared. That turns a hidden failure into a visible product surface.
- **Credentials are never handled.** A human logs in once, inside the sandbox, before the snapshot is taken.
- **`skipped` is a first-class worker status.** Divergence in the grid is what makes parallel execution read as intelligence rather than a loop.
- **`sandbox.fork()` is not used.** It exists in the Daytona SDK but is supported for VM sandboxes only; Owari runs container sandboxes and creates each worker from the snapshot instead.

---

## Out of scope

Deliberately, and stated so the gaps are not mistaken for oversights:

- Automatic environment inference
- Credential capture or automated login
- Scheduling, triggers, or unattended recurring runs
- Multi-user accounts, teams, permissions, billing
- Recording anything other than the primary display
- Executing on the operator's own machine — all execution happens in sandboxes

---

## Status

Built in a day, by three agents working in parallel against a frozen contract.

The server and executor are verified end to end against live Daytona: real sandboxes provisioned from a snapshot, steps grounded against real accessibility trees, screenshots streamed over SSE, and every sandbox torn down on both the success and failure paths with no leaks across any run.

A two-worker launch was observed completing a ten-step workflow on one row while the other row took a conditional branch and ended `skipped` — the same Brief, different data, different outcome.
