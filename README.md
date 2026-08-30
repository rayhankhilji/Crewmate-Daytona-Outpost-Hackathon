# Crewmate

**Show it the job once. It builds you a crew.**

Crewmate watches a person do a task, works out what they were actually trying to accomplish, and then runs that task across a crew of cloud machines at the same time — one per row of your data.

Built in a day on [Daytona](https://daytona.io).

---

## The thing nobody has solved

A huge amount of real work happens inside software that has no API and never will. Internal admin panels. Legacy portals. The line-of-business tool someone's company bought in 2014 and can't replace.

If you want to automate that today you have two options. Write a brittle script against pixel coordinates and watch it break the first time a button moves. Or pay a person to do it by hand, one row at a time, forever.

RPA tools exist. They take weeks of configuration by a specialist before a single task runs.

Crewmate takes one demonstration.

---

## How it feels to use

You hit record on a small floating bar, do your task once like you normally would, and hit stop.

A few seconds later Crewmate shows you what it understood — not a video, not a macro, but a written plan. *Open the leads section. Search for the company. Open the matching record. Write the research report into the notes field.* Plain English, in order, with the bits that changed between rows marked as variables.

It also shows you what it threw away. If you opened a settings page, poked around, found nothing useful and backed out, that's not part of the job — and Crewmate says so, in the plan, with a reason:

> *"Opened Settings looking for a report template, found every control disabled, and went back"*

That's the moment the thing stops looking like a screen recorder.

You can edit any step. Then you paste in your rows, hit run, and watch a grid of live machines each doing your task with different data.

---

## The idea that makes it work

Here's the problem with recording someone's screen: you recorded it at 1512×982 on a Mac, and it's going to run at 1280×800 on Linux. Every coordinate you captured is now a lie.

So Crewmate doesn't capture any. A step looks like this:

```json
{
  "intent": "Open the leads section",
  "action": "invoke_node",
  "target": { "role": "link", "name": "Leads", "name_match": "exact" }
}
```

No x, no y. At run time each machine queries its own **live accessibility tree** — the same structure a screen reader uses — finds the control called "Leads", and acts on it. The schema physically rejects coordinates; you couldn't add one if you tried.

We learned something building this that turned out to matter a lot.

The first version demanded the role match exactly. It failed constantly, and the reason is interesting: a model watching a video can read the label on a button, but it has no way to know whether that button was built as a `link`, a `push button`, or — genuinely, in our own app — a `table cell`. Those are invisible implementation details that differ between two apps that look pixel-identical.

So we flipped it. **The name is the identity; the role is a hint.** Crewmate matches on what's actually visible and uses the role to rank candidates. In our last run the plan guessed several roles wrong and every single step still landed on the right control.

That's the difference between a demo that works on one app and a system that works on apps nobody has seen.

---

## Why it's fast

Most agent demos run a model call for every click. Seconds per action, a different answer every time, and eight parallel workers that quietly cost a fortune and finish after the judges have left.

Crewmate calls the model **once**, at comprehension time, and compiles the recording into a fixed plan. Execution is deterministic. Ten steps run in about thirteen seconds, and they run the same way tomorrow.

That's not just a performance trick — it's what makes the plan *visible*. Because the understanding is an explicit list rather than prose in a context window, you can watch it assemble against the video, and you can fix step 4 before you launch.

---

## Powered by Daytona

Every worker is a Daytona sandbox: a full Linux desktop, booted from a snapshot that's already signed into your app.

That last part is the trick that makes the whole thing safe. **Crewmate never sees a password.** You log in once, by hand, inside a sandbox. You snapshot that machine. Every worker from then on wakes up already authenticated.

Daytona's Computer Use API gives us the accessibility tree, the keyboard, and compressed screenshots — which is exactly the surface this needed and the reason a one-day build could reach live parallel execution at all.

Sandboxes are torn down on every path, including crashes and partial provisioning failures. Across every run we made today, zero leaked.

---

## Built by a crew, appropriately enough

Three coding agents built this in parallel, in one day, against a frozen interface contract.

**Codex** owned the two hardest human-facing pieces: the Electron overlay that captures the screen without ever producing a black recording, and the entire comprehension pipeline — frame sampling, the vision prompt, and the validate-and-retry loop that turns 90 stills into a structured plan. The prompt engineering that gets a model to preserve typed text verbatim, spot which values are variables, and *hunt for its own dead-ends to discard* is Codex's work, and it's the part of this that feels like magic.

**Claude Code** ran two seats: one on the dashboard, one on the server and the Daytona executor.

They never touched each other's files. Disjoint directory ownership and a frozen `contract/` meant three agents could build simultaneously with zero merge conflicts — which, if you've tried this, you'll know is the entire ballgame.

---

## Running it

Needs Python 3.11+, Node 18+, ffmpeg, and a Daytona account.

```bash
cp env.example .env       # fill it in, see below
python3.11 -m venv .venv
.venv/bin/pip install fastapi "uvicorn[standard]" python-multipart daytona openai jsonschema
```

Three terminals:

```bash
.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 8000   # server
cd web && npm install && npm run dev                             # dashboard :5173
cd overlay && npm install && npm start                           # the record bar
```

You'll need `DAYTONA_API_KEY`, `OPENAI_API_KEY`, a vision-capable `VISION_MODEL`, and `CREWMATE_SNAPSHOT_NAME` — the snapshot you made by signing into your app by hand. `MAX_PARALLEL_WORKERS` should sit at or below your Daytona concurrency limit.

The server binds to loopback only and has no auth. Keep it that way.

---

## Under the hood

```
overlay/         Electron. Screen capture, floating window, upload.        [Codex]
comprehension/   Frames -> vision model -> validated plan.                 [Codex]
web/             React + Vite. Everything you look at.                     [Claude Code]
server/          FastAPI, SQLite, SSE, orchestration, validation.          [Claude Code]
executor/        Every Daytona call. Grounding, actions, the step loop.    [Claude Code]
contract/        The frozen plan schema. Read-only to all three.
```

Two boundaries are enforced hard. `executor/` is the only module that imports the Daytona SDK — two modules building sandbox clients independently would diverge on lifecycle and leak machines that cost real money. `comprehension/` is the only module that imports `openai`. And validation lives in exactly one file, so there's no second implementation to drift out of sync.

When a run starts, each worker walks the plan against its own row. Variables are substituted from that row — and a missing column raises rather than typing a literal `{{company}}` into a live system. A control that can't be found is retried once, then that worker fails at that step with a readable error and the others carry on untouched.

If a conditional's target isn't on screen, the worker takes the other branch — which might mean skipping a step, or finishing early. That worker is marked `skipped`, deliberately distinct from `failed`, because "this row led somewhere different" and "this row broke" are not the same thing and the grid should never conflate them.

We watched exactly that happen: two workers, same plan, different companies. One completed all ten steps and saved a full research report. The other searched, found no match, took the conditional branch, and ended `skipped`.

Same instructions. Different data. Different outcome. That's the whole product in one screen.
