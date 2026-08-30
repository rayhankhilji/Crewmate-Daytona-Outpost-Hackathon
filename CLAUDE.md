# Owari

Owari watches a person do a task once, works out what they were trying to do, and runs it at scale in parallel cloud sandboxes.

## Read these first, in order

The full spec lives in `docs/`. Each file owns one thing — do not look for a fact in the wrong file, and do not restate a fact across files.

- `docs/PRD.md` — what we're building, features, acceptance criteria
- `docs/ARCHITECTURE.md` — stack, module boundaries, **agent directory ownership**, directory map, integrations
- `docs/DATA_MODEL.md` — the complete schema **and the Brief contract** (ground truth for all data)
- `docs/API.md` — endpoint contracts
- `docs/DESIGN.md` — the visual system and tokens
- `docs/BUILD_PLAN.md` — your numbered tasks, in order
- `docs/DECISIONS.md` — decisions already made; append here, don't relitigate

## Before you write anything

**Open your own brief in `agents/` first.** Rayhan will have told you which agent you are.

- `agents/AGENT_1_SERVER.md` — Claude Code #1 · owns `server/`, `executor/` · tasks 1–10
- `agents/AGENT_2_WEB.md` — Claude Code #2 · owns `web/` · tasks 11–18
- `agents/AGENT_3_OVERLAY.md` — Codex · owns `overlay/`, `comprehension/` · tasks 19–26

Read only your own. Then:

1. **Confirm your directories in the ownership table in `docs/ARCHITECTURE.md`.** It tells you which directories you own and which BUILD_PLAN task numbers are yours.
2. **Create files only inside your own directories.** Never edit another agent's files — not even to fix an obvious bug. Report it instead.
3. **`contract/` is frozen and read-only.** It is the interface all three agents build against. If it looks wrong, stop and raise it.
4. **Mock your dependencies; never wait.** `contract/example-brief.json` is the fixture everyone develops against.

Three agents are building in parallel. Exclusive directory ownership is the only thing preventing collisions — violating it is the one mistake that breaks everyone else's work.

## Commands

```bash
# server + executor
pip install fastapi "uvicorn[standard]" python-multipart daytona openai jsonschema
uvicorn server.main:app --reload --host 127.0.0.1 --port 8000

# web
cd web && npm install && npm run dev        # http://localhost:5173
cd web && npm run build && npx tsc --noEmit

# overlay
cd overlay && npm install && npm start

# comprehension (called by the server; runnable standalone for testing)
python -m comprehension.comprehend <video_path> "<task name>"
```

## Stack

Electron overlay · React + Vite dashboard · FastAPI server · SQLite · Daytona sandboxes for execution · OpenAI vision for comprehension. Full detail in `docs/ARCHITECTURE.md`.

## Conventions

- **Python:** 3.11+, `from __future__ import annotations`, type hints on every function. No bare `except`.
- **TypeScript:** strict. No `any`. No non-null assertions to silence the compiler.
- **Formatting:** `ruff format` for Python, Prettier for TS. Run before finishing a task.
- **Data access:** all database access goes through `server/db.py`. No SQL anywhere else except `server/schema.sql`.
- **Brief validation:** exactly one implementation, `server/brief_schema.py`. Every write path calls it. Do not write a second validator.
- **SDK isolation:** `executor/` is the only module importing `daytona`. `comprehension/` is the only module importing `openai`. If you need one from elsewhere, route through the owner.
- **Styling:** tokens from `docs/DESIGN.md` only. A hardcoded hex value anywhere in `web/` is a defect.

## House rules (non-negotiable)

- **One correct path.** No fallbacks, no alternative branches "just in case". If preconditions aren't met, raise — fail fast and loud.
- **One way to do a thing.** Don't introduce a second pattern for something the codebase already solves.
- **Clarity over cleverness.** Readable code beats compact code.
- **Separation of concerns.** Each function does one thing.
- **Surgical changes.** Fix the root cause with the smallest correct edit. No drive-by refactors, no symptom patches.
- **Evidence-based debugging.** Reproduce → isolate with targeted logging → diagnose → then fix. Find the cause before touching code. Never guess-patch.
- **Real error handling everywhere.** Every async call, request, and query handles failure explicitly. Errors are human-readable; never leak a stack trace to a client.
- **Don't overengineer.** This is a one-day build. Simple beats complex.

## Guardrails (never do these)

- **Never invent an SDK method.** If a Daytona or OpenAI signature is not in the documentation you were given, **stop and ask**. Hallucinating a method name and building three files on top of it is the most expensive failure available here. The fork and snapshot-from-running-sandbox signatures in `docs/ARCHITECTURE.md` are explicitly marked unverified — read them from the Daytona docs first.
- **Never put pixel coordinates in a Brief step.** Targets are accessibility role + name, re-grounded at runtime. The schema rejects coordinates; do not work around it.
- **Never call the vision model during normal step execution.** Comprehension time and failure-retry only. See `docs/DECISIONS.md` D3.
- **Never leak a sandbox.** Every fork is torn down on completion *and* on failure. Leaked sandboxes burn real credits.
- **Never commit `.env`, an API key, or anything in `server/storage/`.**
- **Never expose the server beyond `127.0.0.1`.** It has no authentication by design.
- **Never add an auth layer, a scheduler, or multi-user support.** All explicitly out of scope in `docs/PRD.md`.
- **Never load `llms-full.txt` into context.** It will consume the context budget. Load only the specific Daytona pages named in `docs/BUILD_PLAN.md`, and only if you are the agent that owns `executor/`.

## Definition of done

A task is done when: types pass strict, its BUILD_PLAN checkpoint is demonstrably met, no console errors, and the relevant acceptance criterion in `docs/PRD.md` is satisfied.
