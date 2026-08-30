# START HERE — Rayhan only

This file is for you, not the agents.

## The folder question, answered

**One folder. Three terminals. No branches, no worktrees, no git required.**

You do not need branches. Branches exist to stop two people editing the same file. Since each agent owns different directories and never touches another's, **there is nothing to conflict.** Learning git worktrees right now would cost you an hour and buy you nothing.

So: put `owari/` wherever you like. Open three terminal windows. In each one, `cd` into that same `owari/` folder and start a different agent. All three write into the same folder at the same time, into different subfolders.

```
~/owari/                      ← all three agents run from HERE
├── CLAUDE.md                 (auto-loaded by every agent)
├── .env                      (you make this — copy .env.example)
├── agents/                   (one brief per agent)
├── docs/                     (the spec — read-only to agents)
├── contract/                 (FROZEN — read-only to everyone)
│
├── server/         ─┐
├── executor/       ─┴─ Claude Code #1 writes here
├── web/            ─── Claude Code #2 writes here
├── overlay/        ─┐
└── comprehension/  ─┴─ Codex writes here
```

If you want a safety net, run `git init` and `git commit -am "wip"` every 30 minutes. That's all the git you need today. If someone's edit breaks everything, `git checkout .` rewinds to the last commit.

## Setup — five minutes

```bash
cd ~/owari
cp .env.example .env          # then fill it in
git init && git add -A && git commit -m "docs + scaffold"
```

Fill in `.env`: your Daytona API key, your OpenAI key, the vision model id, and — once Phase 0 passes — `OWARI_SNAPSHOT_NAME`.

## Phase 0 — you, before any agent starts

Nothing else can be trusted until this passes. From `docs/BUILD_PLAN.md`:

1. Create a Daytona sandbox, run `computer_use.start()`, open noVNC in your browser.
2. **Log into the target app by hand** inside that desktop.
3. Snapshot the machine.
4. Fork it. Open the fork's VNC.
5. **Confirm the fork is still logged in.**

If step 5 fails, stop everything and come back — the whole architecture assumes it.

While you're there: check your Daytona org's concurrent sandbox limit, and go ask the Daytona people at the event to raise it. Your demo grid depends on it.

## Launching the three agents

Three terminals, same folder, one command each:

**Terminal 1 — Claude Code #1 (server + executor)**
```
claude --model opus
```
Then paste the kickoff prompt from the bottom of `agents/AGENT_1_SERVER.md`.

**Terminal 2 — Claude Code #2 (dashboard)**
```
claude --model opus
```
Then paste the kickoff prompt from `agents/AGENT_2_WEB.md`.

**Terminal 3 — Codex (overlay + comprehension)**

Start your Codex session and paste the kickoff prompt from `agents/AGENT_3_OVERLAY.md`.

Each agent reads `CLAUDE.md` automatically, then its own brief, then only the docs it needs.

## Your job while they build

You are the integrator. Do not take a build task — the integrator cannot also be heads-down in code.

- Check in every 20 minutes. Ask each agent which checkpoint it last passed.
- **Watch for ownership violations.** If an agent creates a file outside its directories, stop it immediately and have it delete the file. This is the only thing that can break all three at once.
- **Watch for invented SDK methods.** If Claude #1 uses a Daytona method you haven't seen in the docs, make it prove where it came from.
- Commit every 30 minutes.

## Gates — do not let these slip

| Time | Gate |
|------|------|
| +45 min | Phase 0 passed. Fork is logged in. |
| 14:00 | Tasks 10 and 24 working. |
| 15:30 | Task 15, the speedrun view, complete. **This one does not move.** |
| 16:15 | **Hard stop on features.** Backup video, pinned rows, three rehearsals out loud. |

## Cut order when you're behind

No negotiating, just cut in this order:

1. Workers 8 → 4
2. Results table → grid end state only
3. Brief editor → read-only brief view
4. Live screenshots → status-only tiles
5. Overlay polish → a plain window

**Never cut the speedrun view.** A demo that ends at comprehension, showing the machine understood the work, still wins without any execution at all.

## The demo recording — get this right

Whatever workflow you pick, the recording you make on stage must contain:

- **A variable** — something you type that comes from the spreadsheet
- **A conditional** — something you do only because of what you saw on screen
- **A deliberate wrong turn** — open the wrong menu, back out, carry on. Don't announce it.

That third one is the whole demo. When the speedrun view shows the wrong turn appearing and then greying out with *"opened Settings, backed out — not part of the task"*, that is the moment the room understands Owari didn't record your keystrokes, it understood your job.

## The four beats

1. Spreadsheet of rows. One line of context.
2. You do it once, live, on your Mac. Fumble included. ~50 seconds.
3. **The speedrun.** Let it breathe. This is the demo.
4. Launch. Grid runs, some workers branch early. Results.

Closing line: *"It didn't record what I did. It worked out what I was doing."*
