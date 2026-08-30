# AGENT 1 — Server & Executor

**You are Claude Code #1, running in the terminal.** This file is yours. The other two agents have their own; do not read or act on theirs.

## What you own

```
server/      ← yours, exclusively
executor/    ← yours, exclusively
```

You create files **only** inside those two directories. You never edit `web/`, `overlay/`, `comprehension/`, `contract/`, or `docs/`. If you spot a bug in another agent's directory, say so in your output — do not fix it.

## Your tasks

**Tasks 1 through 10 in `docs/BUILD_PLAN.md`.** Build them in order. Each has a checkpoint; meet it before moving on.

Do not start any task numbered 11 or above. Those belong to other agents and are being built in parallel right now.

## Read before you write

1. `CLAUDE.md` (project root) — house rules and guardrails
2. `docs/ARCHITECTURE.md` — your module boundaries and the directory map
3. `docs/DATA_MODEL.md` — the schema and the Brief contract
4. `docs/API.md` — every route you are implementing
5. `docs/BUILD_PLAN.md` — your tasks 1–10
6. `contract/brief.schema.json` — frozen, read-only

## Daytona documentation — you are the only agent who needs it

Fetch these pages and nothing else. **Do not load `llms-full.txt`** — it will eat your context budget on a Pro plan.

- `https://www.daytona.io/docs/en/computer-use.md`
- `https://www.daytona.io/docs/en/sandboxes.md`
- `https://www.daytona.io/docs/en/snapshots.md`
- `https://www.daytona.io/docs/en/python-sdk`

Any Daytona docs page works with a `.md` suffix, which gives you clean markdown instead of the rendered page.

## The rule that matters most for you

**Never invent an SDK method.** The fork and snapshot-from-running-sandbox signatures in `docs/ARCHITECTURE.md` are explicitly marked as unverified — they were not confirmed against the docs. Read them from the Daytona documentation before you write `executor/fork.py`. If you cannot find a signature, **stop and ask Rayhan**. Hallucinating a method name and building three files on top of it is the most expensive mistake available on this project.

## Mock, never wait

The other agents are building at the same time. You are not blocked by either of them.

- You do not need the overlay. Test `POST /recordings` with `curl -F`.
- You do not need comprehension. Insert `contract/example-brief.json` straight into the `briefs` table to test runs.
- You do not need the dashboard. Test SSE with `curl -N`.

## Blocked on Rayhan

Task 7 onwards needs `OWARI_SNAPSHOT_NAME` in `.env` — a real Daytona snapshot with logins already in it. If it isn't set yet, build tasks 1–6 first and say so. Do not stub Daytona; do not fake a fork.

## Definition of done for you

Tasks 1–10 complete, each checkpoint met, `uvicorn server.main:app` runs clean, and eight workers launched from one `POST /runs` each report independently over SSE.

---

## Kickoff prompt — paste this into the agent

```
Read CLAUDE.md, then agents/AGENT_1_SERVER.md, then the docs it tells you to read.

You own server/ and executor/ exclusively. Create files only there.
Build tasks 1-10 from docs/BUILD_PLAN.md in order, meeting each checkpoint.

Before writing executor/fork.py, fetch the Daytona fork and snapshot docs and
confirm the real method signatures. Do not guess an SDK method — stop and ask me.

Start with task 1 and tell me when its checkpoint passes.
```
