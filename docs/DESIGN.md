# Design System: Crewmate

> The visual language. Every UI decision references these tokens. No ad-hoc values in components.

## Direction

Dark, precise, instrument-like. Crewmate watches work and reports what it understood, so the interface should feel like a piece of measuring equipment: dense information, hairline rules, monospace for anything the machine produced, one accent used sparingly to mean "the system is certain about this". Closer to Linear or a Bloomberg terminal than to a SaaS dashboard.

It is **not** playful, not rounded, not gradient-heavy, not glassmorphic. No purple-to-blue gradients, no pill buttons, no drop shadows on cards. Emptiness is fine; decoration is not.

The interface has exactly one moment of drama — the speedrun view — and everything else is deliberately quiet so that moment lands.

## Colour

Dark only. No light mode; it is out of scope and doubling the surface costs polish where it matters.

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#0A0B0D` | Page background |
| `--surface` | `#131519` | Cards, panels, the step list |
| `--surface-raised` | `#1B1E24` | Hover states, active rows, modal |
| `--border` | `#24282F` | Hairlines, dividers, tile outlines |
| `--border-strong` | `#343A44` | Focused inputs, active tile |
| `--text` | `#E8EAED` | Primary text |
| `--text-muted` | `#8B929E` | Secondary text, labels, timestamps |
| `--text-faint` | `#565D68` | Pruned steps, disabled, placeholders |
| `--accent` | `#4ADE80` | Confirmed comprehension, complete, the single primary action |
| `--warning` | `#FBBF24` | Low confidence (<0.7), retried steps |
| `--danger` | `#F87171` | Failed workers, validation errors |
| `--info` | `#60A5FA` | Variables and their `{{tokens}}`, conditional branches |

Body text on `--bg` and on `--surface` meets WCAG AA (4.5:1). `--text-faint` is used only for de-emphasised non-essential content, never for text a user must read to operate the product.

Status colour mapping is fixed and must be consistent everywhere: `complete` → accent · `running` → text · `skipped` → info · `failed` → danger · `pending` → text-faint. `skipped` must never render as a failure — it is a designed conditional exit.

## Typography

- **Text:** Inter — `'Inter', -apple-system, system-ui, sans-serif`.
- **Mono:** JetBrains Mono — `'JetBrains Mono', ui-monospace, 'SF Mono', monospace`. Used for everything the machine produced: step targets, accessibility roles and names, variable tokens, sandbox ids, timestamps, JSON.

That split is load-bearing. Human prose in Inter, machine output in mono, no exceptions. It is what makes the Brief read as a machine artifact rather than a form.

Scale — 1.25 major third:

| Token | Size / line-height | Use |
|-------|-------------------|-----|
| `--text-xs` | 0.75rem / 1.1rem | Timestamps, tile labels, step ids |
| `--text-sm` | 0.875rem / 1.35rem | Body default, step intent, table cells |
| `--text-base` | 1rem / 1.5rem | Panel headings |
| `--text-lg` | 1.25rem / 1.75rem | View titles |
| `--text-xl` | 1.5rem / 2rem | Task name in the speedrun header |
| `--text-3xl` | 2.5rem / 3rem | Run completion count |

Weights: 400 body · 500 emphasis and labels · 600 headings. Never 700 — it reads heavy against this palette.

## Spacing & layout

Base unit 4px. Scale: `4, 8, 12, 16, 24, 32, 48, 64`.

- App shell: fixed 240px left rail, fluid content.
- Max content width 1440px, centred above that.
- Speedrun view: two columns, 50/50, 24px gutter, both full viewport height.
- Run grid: CSS grid, `repeat(auto-fill, minmax(280px, 1fr))`, 16px gap.

## Radii, borders, shadows

- Radius: `--radius-sm` 4px (inputs, buttons, tiles) · `--radius-md` 8px (panels, modal). Nothing larger. No pills.
- Borders: 1px throughout. Structure comes from hairlines and background steps, not from shadow.
- Shadows: one token only, `--shadow-modal: 0 16px 48px rgba(0,0,0,0.6)`. Used on the modal and nowhere else.

## Components

**Button.** Primary: `--accent` background, `#0A0B0D` text, 500 weight. Secondary: transparent with `--border`, `--text` label, hover to `--surface-raised`. Danger: transparent with `--danger` border and label. Height 32px standard, 40px for the launch action. Disabled at 40% opacity with `cursor: not-allowed`. Exactly one primary button visible per view.

**Input.** `--surface` background, 1px `--border`, `--radius-sm`, 32px high. Focus: border to `--border-strong` plus a 2px `--accent` outline offset 1px. Error: `--danger` border with the message directly beneath in `--text-xs`. Never rely on colour alone to signal error — always show text.

**Step row.** The core component, used in both the speedrun view and the editor. Layout: step id in mono `--text-faint` · action verb as a small mono chip · intent in Inter `--text-sm` `--text` · target role and name in mono `--text-muted` · a right-aligned confidence marker. Variable references render inline as `--info` mono chips. Hover raises to `--surface-raised`. Conditional steps get a left border in `--info` and their predicate on a second line.

**Confidence marker.** Confidence ≥ 0.7: nothing. Below 0.7: a `--warning` dot plus the numeric value in mono `--text-xs`. Uncertainty must be visible without being alarming — it invites the user to edit, which is the point of the editor.

**Worker tile.** `--surface` with 1px `--border`, `--radius-sm`. Screenshot fills the tile at 16:10 with `object-fit: cover`. A 2px top border carries the status colour. Overlaid bottom-left: row index and current step in mono `--text-xs` on a 60% black scrim. The active tile gets `--border-strong`.

**Focus.** Every interactive element has a visible `focus-visible` ring: 2px `--accent`, 1px offset. Never remove outlines. Full keyboard operability is required — the speedrun view is driven from the keyboard during the demo.

## Motion

Durations 150–250ms. Easing `cubic-bezier(0.2, 0, 0, 1)`. Purposeful only — no decorative or infinite animation anywhere except a determinate progress indicator.

Three motions are specified precisely because they carry meaning:

1. **Step materialising** (speedrun) — 200ms, opacity 0→1 with `translateY(6px)→0`. Steps appear one at a time as the replay reaches their timestamp.
2. **Pruned segment** (speedrun) — appears at full opacity, holds 400ms, then over 250ms fades to `--text-faint` and collapses its height to zero with a strikethrough on the reason. This animation is the product's argument that it understood intent rather than recording keystrokes. It must be legible, not subtle.
3. **Tile status change** (run grid) — 150ms border-colour transition. No scale, no bounce.

Respect `prefers-reduced-motion`: skip the transforms, keep the opacity changes, keep all timings.

## The speedrun view

The hero. It gets the most polish and is the last thing to be cut.

**Layout.** Two full-height columns. Left: the recording in a `<video>` at `playbackRate = 8`, with a scrub bar showing pruned segments as `--text-faint` bands and comprehended steps as `--accent` ticks. Right: the step list, scrolling, empty at the start.

**Sequence.** On play, the video runs at 8×. As playback passes each step's source timestamp, that step materialises into the right column (motion 1) and the list auto-scrolls to keep it in view. Variables highlight in `--info` the moment they are detected. When playback passes a pruned segment, its entry appears in the right column and immediately performs motion 2 — appearing, then greying and collapsing with its reason struck through.

**Header.** Task name at `--text-xl`, duration and step count in mono `--text-muted`, and the environment strings from the Brief as small `--border` chips.

**End state.** Playback finishes, the full step list sits populated, and a footer bar shows step count, variable count, pruned count, and a single primary button to continue to the editor.

**Controls.** Space toggles play/pause. `R` restarts. Speed is adjustable 1×–16× but defaults to 8×. It must survive being restarted repeatedly without a reload — it will be run many times in a row.

## Required UI states

Every data view designs all four of loading, empty, error, populated.

- **Loading:** skeleton rows at `--surface`, no spinners except for genuinely indeterminate waits.
- **Empty:** designed, never blank. One line of `--text-muted` explaining what will appear and the one action that produces it. The recordings list empty state points at the overlay.
- **Error:** human-readable, actionable, in `--danger`, with a retry action where retrying is meaningful. Never a raw code, never a stack trace, never a bare "Something went wrong".
- **Degraded:** when `/health` reports `daytona: false`, a persistent `--warning` bar in the shell reading that execution is unavailable. The rest of the app stays usable — recording, comprehension, and editing do not require Daytona.

## Quality bar

If a screen would look out of place in a well-designed, venture-backed product, it is not done. Consistency across the app beats novelty on one screen. When in doubt, remove something.
