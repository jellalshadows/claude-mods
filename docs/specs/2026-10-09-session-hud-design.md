# session-hud — Design Spec

- **Date:** 2026-10-09
- **Status:** Approved in conversation (sections 1 and 2); pending written-spec review
- **Engine build verified against:** Claude Code 2.1.296 (plugin API types shipped with the `plugin-authoring` skill)

## 1. Goal

A Claude Code mod that keeps a two-line HUD above the prompt so the person can see, at a glance and without typing anything:

1. The git branch the session is working on.
2. The subscription rate-limit windows (5-hour and 7-day): how full they are and when they reset.
3. What the session has spent: total tokens, and how much of each subscription window this session consumed.
4. How full the context window is.
5. How long the session has been running (wall clock) and how long Claude has actually been working (active time).

**Success criterion:** open Claude Code in any repository and, with no command typed, the band shows these figures, refreshed after every turn and every minute.

## 2. Requirements (as agreed)

| # | Requirement | Decision |
|---|---|---|
| R1 | Show current branch | `git branch --show-current`; detached HEAD shows the short SHA; no repo shows `sin repo` |
| R2 | Show subscription limits | `five_hour` and `seven_day` windows: percent used + time until reset |
| R3 | Session spend in tokens | **Raw total**: input + output + cache read + cache write, summed over every turn (subagents included), with output shown separately |
| R4 | Session spend in percent | **Both**: (a) per-window delta this session consumed, (b) context-window fill |
| R5 | Session time | Wall clock since session start + active time (sum of main-thread turn durations) |
| R6 | Display surface | Band above the prompt (`ui.render` on `AbovePrompt`), colored by severity |

UI strings are in Spanish (the person's working language): `activo`, `sin repo`.

## 3. Non-goals (YAGNI)

- No configuration options (thresholds and refresh period are constants).
- No USD cost display (`cost.usd` is the API-equivalent figure, not real spend on a subscription).
- No pane, no slash command, no notifications.
- No backfill of token totals for a resumed session.

## 4. Data sources (verified in the engine types)

| Figure | Source | Notes |
|---|---|---|
| Session start | `$.session.usage().startedAt` | Resets on `/clear`; for a resumed session it is its first launch |
| Rate-limit windows | `$.session.usage().rateLimits[]` → `{ kind, percentUsed, resetsAt? }` | Empty before the first API response and when not on a subscription |
| Context fill | `$.session.usage().context.percent` | Whole percent, may be absent before the first response |
| Tokens per turn | `turn.complete` → `e.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) | Absent on interrupts/API errors; fires for subagent turns too (`e.agentId` set) |
| Turn duration | `turn.complete` → `e.durationMs` | Wall-clock length of the turn |
| Branch | `$.process.run(['git', 'branch', '--show-current'])`, fallback `['git', 'rev-parse', '--short', 'HEAD']` | `$.session.repo()` does **not** expose the branch |
| Refresh triggers | `session.start`, `session.measure` (after each main turn and when a window moves a whole point), `$.clock.every(60_000)` | `$.session.usage()` without arguments is free |

The engine provides **no cumulative token counter**: `context.tokens` is the window fill of the last response, not spend. The mod accumulates tokens itself.

## 5. Architecture

The hard part of this mod is state logic (accumulation, window rolls, session resets), so it lives in a **pure reducer** with no engine dependency. The hooks module only reads the engine, dispatches actions and draws.

```
claude-mods/
├── docs/specs/2026-10-09-session-hud-design.md
└── session-hud/
    ├── .claude-plugin/plugin.json
    ├── types/index.d.ts         # PluginState contract: 'session-hud': { hud: HudState | null }
    ├── hooks/hooks.json         # { "modules": ["./register.tsx"] }
    ├── hooks/hud.ts             # PURE: reducer, window tracking, formatters
    ├── hooks/hud.test.ts        # unit tests for hud.ts
    ├── hooks/register.tsx       # wiring: events → actions → atom → band
    └── hooks/register.test.ts   # integration tests with claude-code/testing
```

### 5.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `hudReducer(state, action)` | Applies a `turn` or `measure` action; resets first when `action.startedAt !== state.startedAt` | nothing |
| `trackWindow(prev, reading)` | Per-window session delta with roll detection | nothing |
| `formatTokens`, `formatDuration`, `formatDelta`, `severity` | Presentation helpers | nothing |
| `register.tsx` | Hooks, timer, branch lookup, atom writes, band drawing | `$`, `hud.ts` |

### 5.2 State

```ts
type WindowTrack = {
  baseline: number      // percentUsed at the first reading this session (0 after a roll)
  carried: number       // delta accumulated in earlier windows of this session
  lastPercent: number   // latest percentUsed
  resetsAt?: string     // ISO 8601, latest reading
}

type HudState = {
  startedAt: number                     // session start, ms epoch
  now: number                           // time of the latest measure, ms epoch
  branch: string | null                 // null = not a repository
  tokens: { total: number; output: number }
  activeMs: number
  contextPercent: number | null
  windows: Record<string, WindowTrack>  // keyed by kind: five_hour, seven_day
}
```

Stored in `$.state` through one atom (`{ plugin: 'session-hud', key: 'hud' }`, initial `null`), so it survives hot reloads.

### 5.3 Actions

```ts
type TurnAction = {
  type: 'turn'
  startedAt: number
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
  durationMs: number
  isMain: boolean                       // e.agentId === undefined
}

type MeasureAction = {
  type: 'measure'
  startedAt: number
  now: number
  branch: string | null
  contextPercent: number | null
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}
```

Reducer rules:

- **Session reset:** when `state` is `null` or `action.startedAt !== state.startedAt`, start from a fresh state for `action.startedAt` (tokens 0, activeMs 0, no windows), then apply the action. Every action carries `startedAt`, so the first turn after a `/clear` never lands on the old totals.
- **turn:** when `usage` is present, `tokens.total += input + output + cache_read + cache_creation` and `tokens.output += output`; `activeMs += durationMs` only when `isMain`, whether or not `usage` is present (subagents run concurrently with the main turn; adding them would double-count).
- **measure:** replace `now`, `branch`, `contextPercent`; for each reading, `windows[kind] = trackWindow(windows[kind], reading)`. A window absent from the reading keeps its last track.

### 5.4 Window tracking

- First reading of a kind: `{ baseline: p, carried: 0, lastPercent: p, resetsAt }`.
- **Roll detected** when the new `resetsAt` is more than 60 s later than the stored one, or `percentUsed < lastPercent`: `carried += lastPercent - baseline`, `baseline = 0`, then take the new reading.
- Otherwise: update `lastPercent` and `resetsAt`.
- **Session delta** = `carried + (lastPercent - baseline)`.

## 6. Data flow

```
turn.complete    ──► TurnAction    (usage, durationMs, isMain, startedAt) ─┐
session.start   ─┐                                                          ├─► hudReducer ─► atom ─► ui.render(AbovePrompt)
session.measure ─┼─► refresh($) ──► MeasureAction (usage(), branch, now)  ─┘
clock.every 60s ─┘
```

- `refresh($)`: reads `$.session.usage()`, the branch and `$.clock.now()`, then dispatches one `measure`.
- `turn.complete`: reads `startedAt` from `$.session.usage()` and dispatches one `turn`.
- `session.start`: runs `refresh($)` and starts the 60 s timer (a hot reload drops the previous environment's timers, and `session.start` fires again on reload).
- Writes use `update($, atom, fn)`, so concurrent writes never get lost, and every refresh runs through one serial queue, so a slower, older read can never land after a newer one (window tracking is order-sensitive).

## 7. Rendering

```
⎇ feat/umbrella-x │ 5h 42% (+11) ↻2h05m │ 7d 18% (+3) ↻3d4h
▲ 1.2M tok (out 38k) │ ctx 61% │ ⏱ 2h13m · activo 47m
```

- Line 1: branch, 5h window, 7d window. Line 2: tokens, context fill, time.
- Percentages (5h, 7d, ctx) are colored with theme keys by `severity`: `< 50` → `success`, `< 80` → `warning`, `≥ 80` → `error`. Severity is computed on the displayed (rounded) percent, so the color and the number never disagree. Deltas and reset countdowns are `dimColor`.
- A window with no reading shows `5h —` / `7d —`; context with no reading shows `ctx —`.
- Elapsed wall clock = `now - startedAt`; reset countdown = `resetsAt - now`, omitted when absent or past.
- The hook yields with `next(e)` while `e.props.hasSurvey` is true or the state is still `null`.
- Text wraps when the terminal is narrower than the band; no custom narrow layout.

### 7.1 Formatting rules

| Helper | Rule | Examples |
|---|---|---|
| `formatTokens` | `< 1 000` raw; `< 10 000` one decimal + `k`; `< 1 000 000` integer + `k`; else one decimal + `M`. A trailing `.0` is always dropped, and the unit is chosen after rounding (999 600 → `1M`, never `1000k`) | `842`, `1k`, `8.4k`, `38k`, `1M`, `1.2M` |
| `formatDuration` | `< 1 min` → `<1m`; `< 1 h` → `Xm`; `< 24 h` → `XhYYm`; else `XdYh` | `<1m`, `47m`, `2h05m`, `3d4h` |
| `formatDelta` | `+` sign, at most one decimal, trailing `.0` dropped | `+11`, `+0.5`, `+0` |
| percent | `Math.round(percentUsed)` + `%` | `42%` |

Reset countdowns are relative (`↻2h05m`), never wall-clock times: the mod environment has no Node and its `Date` time zone cannot be guaranteed.

## 8. Error handling and edge cases

| Situation | Behavior |
|---|---|
| Before the first API response / API-key login | `rateLimits` empty → `—` placeholders |
| `/clear` or resume | `startedAt` changes → reducer resets |
| Window rolls mid-session | `trackWindow` carries the previous delta and rebases at 0 |
| `git` missing, non-zero exit, or timeout (5 s) | `branch = null` → `sin repo`; never throws out of `refresh` |
| A refresh fails | Keep the last good state; observer hooks always return `next(e)` (a HUD must never block a turn) |
| Survey holding the band | Yield with `next(e)` |
| Hot reload | State lives in `$.state` (host-held) and survives; the timer is recreated |

### 8.1 Known limitations (documented, accepted)

- Token totals count from the moment the mod loads; earlier turns of a resumed session are not included.
- The subscription delta includes any other session running in parallel on the same account, since the windows are account-wide.
- Rate-limit figures move only when the API reports them (after responses), at whole-point granularity for the `session.measure` push.

## 9. Testing (strict TDD: red → green → refactor)

Every behavior below gets its failing test before its implementation.

**`hud.test.ts` (pure):**

- Accumulates the four token counts into `total` and output into `output`.
- Adds `durationMs` to `activeMs` only for main-thread turns.
- Ignores a turn without `usage` for tokens but still counts its duration.
- Resets everything when `startedAt` changes (turn and measure actions alike).
- First window reading sets the baseline; later readings grow the delta.
- Roll by `resetsAt` jump and roll by percent drop both carry the previous delta.
- `severity` thresholds on the rounded percent: 49 / 50 / 79 / 80, and 49.6 → `warning` (displays as 50%).
- `formatTokens`, `formatDuration`, `formatDelta` against the table in 7.1.

**`register.test.ts` (engine test kit, `claude-code/testing`):**

- After `session.measure` with rate limits, the mounted `AbovePrompt` shows the window percents.
- After `turn.complete` with usage, the band shows the token total.
- With `hasSurvey: true`, the hook yields (no tree of its own).
- The body runs over `['terminal', 'desktop'] as const`.

Commands: `claude plugin validate <mod folder>` and `claude plugin test <mod folder>`.

## 10. Lifecycle and location

- **Development:** written in the session mods folder with hot reload (`~/.claude/dev-mods/<session-id>/session-hud/`).
- **Permanent home:** this repository, `~/claude-mods/session-hud/`, loaded in every session through `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.
- **Later option:** a `.claude-plugin/marketplace.json` makes the repository installable with `/plugin install session-hud --marketplace <owner>/<repo>`; out of scope for 0.1.0.

## 11. Execution rulings

Decisions taken while planning and implementing, on top of sections 1–10:

- **Development location:** the mod is developed and committed in this repository (one commit per task) and is only mirrored into the session mods folder for the live check; section 10's "development in the session mods folder" is superseded.
- **Branch survives a session reset:** a `/clear` or resume wipes tokens, active time, context and windows, but keeps the last branch until the next reading, because the branch belongs to the working copy, not to the session.
- **Band view model:** `bandLines(state)` in `hud.ts` turns the state into colored segments, so the whole layout is unit-tested without the engine; `register.tsx` only maps segments to `Text`.
- **Severity colors** are the theme keys `success` / `warning` / `error`, computed on the rounded percent.
- **Missing reset time:** a window reading without `resetsAt` keeps the previously known one (section 5.4 said "update `resetsAt`"), so a later roll is still detected and the countdown keeps showing.
- **Contract shape:** the state is declared inline (`'session-hud': { hud: HudState | null }`); validation refuses an alias there.
- **Test kit facts** (verified by a throwaway spike): op stubs answer `{ value }` or `{ deny }`; raised events need bottom hooks; a hook that throws does not fail a test, so every test asserts on the drawn band; `key` is honored on `Box` only.
- **Serialized refreshes:** `refresh` runs through one module-level promise chain. Window tracking reads a percent drop as a roll, so two overlapping refreshes landing out of order would inflate the session delta permanently (found in the final review, reproduced, and pinned by a regression test).
- **One `Text` per band line:** each line is a single `Text` with nested colored `Text` segments, so a line wider than the band wraps as one paragraph instead of shredding into per-segment columns.
