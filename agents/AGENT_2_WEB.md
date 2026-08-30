# AGENT 2 — Dashboard

**You are Claude Code #2.** This file is yours. The other two agents have their own; do not read or act on theirs.

## What you own

```
web/     ← yours, exclusively
```

You create files **only** inside `web/`. You never edit `server/`, `executor/`, `overlay/`, `comprehension/`, `contract/`, or `docs/`. If you spot a bug elsewhere, say so in your output — do not fix it.

## Your tasks

**Tasks 11 through 18 in `docs/BUILD_PLAN.md`.** Build them in order. Each has a checkpoint; meet it before moving on.

Do not touch tasks 1–10 or 19–26. Those belong to other agents building in parallel right now.

## Read before you write

1. `CLAUDE.md` (project root) — house rules and guardrails
2. `docs/DESIGN.md` — **read this closely.** It is the most important file for you. Every colour, size, and motion is specified. A hardcoded hex value anywhere in `web/` is a defect.
3. `docs/API.md` — every endpoint you call
4. `docs/DATA_MODEL.md` — the Brief contract, which you render
5. `docs/BUILD_PLAN.md` — your tasks 11–18
6. `contract/example-brief.json` — your development fixture

You need **zero** Daytona knowledge. You never import the SDK, never call Daytona, never think about sandboxes. Do not fetch Daytona documentation.

## Task 15 is the one that matters

The **speedrun view** is the product's hero moment and the single screen the judges will remember. It gets your highest polish and is the last thing cut. `docs/DESIGN.md` specifies its layout, its three motions, and its keyboard controls precisely — follow it exactly rather than improvising.

The two motions that carry meaning:
- Steps materialising against the video's timestamps as it replays at 8×
- Pruned segments appearing, then greying and collapsing with their reason struck through

That second one is the product's entire argument that it understood intent rather than recording keystrokes. Make it legible, not subtle.

It must survive being restarted ten times without a page reload. It will be run repeatedly during rehearsal and the demo.

## Mock, never wait

**Start immediately. Do not wait for the server to exist.**

- Load `contract/example-brief.json` from disk as your fixture for tasks 11–17.
- For the video in the speedrun view, use any local MP4 until `GET /recordings/{id}/video` is live.
- For the run grid, write a local stub that emits fake SSE-shaped events on a timer so you can build all five worker statuses.
- Swap everything to real endpoints at task 18, and not before.

Build every one of the four required UI states from `docs/DESIGN.md` — loading, empty, error, populated — on every view. Empty states are designed, not blank.

## Definition of done for you

Tasks 11–18 complete, `npx tsc --noEmit` clean, zero console errors, no hardcoded hex anywhere, and the speedrun view running start to finish smoothly ten times in a row.

---

## Kickoff prompt — paste this into the agent

```
Read CLAUDE.md, then agents/AGENT_2_WEB.md, then the docs it tells you to read.
Read docs/DESIGN.md carefully — every token is specified and there are no hardcoded values allowed.

You own web/ exclusively. Create files only there.
Build tasks 11-18 from docs/BUILD_PLAN.md in order, meeting each checkpoint.

Do not wait for the server. Load contract/example-brief.json from disk as your
fixture and stub the SSE stream locally. Wire to the real API only at task 18.

Task 15, the speedrun view, is the hero screen — highest polish, follow DESIGN.md exactly.

Start with task 11 and tell me when its checkpoint passes.
```
