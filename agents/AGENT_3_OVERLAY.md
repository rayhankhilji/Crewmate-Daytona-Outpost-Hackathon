# AGENT 3 — Overlay & Comprehension

**You are Codex.** This file is yours. The other two agents have their own; do not read or act on theirs.

## What you own

```
overlay/          ← yours, exclusively  (Electron + TypeScript)
comprehension/    ← yours, exclusively  (Python + vision model)
```

You create files **only** inside those two directories. You never edit `server/`, `executor/`, `web/`, `contract/`, or `docs/`. If you spot a bug elsewhere, say so in your output — do not fix it.

Two different languages, two separate modules. Build `overlay/` first — it produces the input everything else depends on.

## Your tasks

**Tasks 19 through 26 in `docs/BUILD_PLAN.md`.** Build them in order. Each has a checkpoint; meet it before moving on.

Do not touch tasks 1–18. Those belong to other agents building in parallel right now.

## Read before you write

1. `CLAUDE.md` (project root) — house rules and guardrails
2. `docs/DATA_MODEL.md` — **the Brief contract.** Your comprehension output must match it exactly.
3. `contract/brief.schema.json` — frozen, read-only. Validate against it.
4. `contract/example-brief.json` — the shape you are aiming to produce
5. `docs/API.md` — `POST /recordings` and the events contract
6. `docs/DESIGN.md` — tokens for the overlay UI
7. `docs/BUILD_PLAN.md` — your tasks 19–26

You need **zero** Daytona knowledge. Do not fetch Daytona documentation.

## The two rules that decide whether comprehension works

**1. Semantic targets only.** Every step target is an accessibility `role` plus `name`. A pixel coordinate anywhere in your output is a hard failure — the recording is made on a Mac at one resolution and executed on a Linux sandbox at 1280x800, so coordinates are meaningless there. The schema rejects them via `additionalProperties: false`; do not try to work around it.

**2. Prune aggressively and explain why.** The `pruned` array is not decorative — it is the product's central claim. When the person backtracks, opens the wrong thing, or corrects a mistake, that segment must be **excluded from `steps`** and listed in `pruned` with a plain-English reason. Your prompt must explicitly hunt for these. A comprehension that faithfully records every keystroke including the mistakes has failed.

Your prompt must also demand: variable detection (typed values that look like input data become `{{variable}}`), conditional detection (anything done only because of what was on screen), `intent` written in plain English because it is shown to the user, and calibrated per-step `confidence`.

## Mock, never wait

You are not blocked by anyone.

- For task 21's upload, POST to a local stub returning a fixed id until the real server exists.
- For comprehension, test against any screen recording you make yourself.
- Validate your output against `contract/brief.schema.json` directly — you do not need the server's validator.

## Non-negotiables

- **Never emit a partial or repaired Brief.** If the model's output fails schema validation, retry once with the validation error appended to the prompt, then raise. Silently patching invalid output produces briefs that fail mysteriously at execution time.
- **Never discard a recording.** If upload fails, keep the file on disk and offer retry.
- **Never start a recording that would be black.** Detect denied macOS screen-recording permission first and name the exact permission needed.
- Frame timestamps are required — the speedrun view positions steps by them. A frame without its source timestamp is useless.

## Definition of done for you

Tasks 19–26 complete. A recording containing a deliberate wrong turn produces a Brief that validates against the schema, excludes the wrong turn from `steps`, lists it in `pruned` with a readable reason, and contains at least one `{{variable}}`.

---

## Kickoff prompt — paste this into the agent

```
Read CLAUDE.md, then agents/AGENT_3_OVERLAY.md, then the docs it tells you to read.
Read docs/DATA_MODEL.md "The Brief contract" section closely — your output must match it exactly.

You own overlay/ and comprehension/ exclusively. Create files only there.
Build tasks 19-26 from docs/BUILD_PLAN.md in order, meeting each checkpoint.
Build overlay/ first.

Two hard rules: step targets are accessibility role+name and NEVER coordinates,
and the pruned array must actually catch backtracks and mistakes.

Do not wait for the server — POST to a local stub until it exists.

Start with task 19 and tell me when its checkpoint passes.
```
