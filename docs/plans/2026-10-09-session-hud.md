# session-hud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that draws a two-line band above the prompt with the git branch, the subscription windows (5h/7d) and this session's share of them, total tokens, context fill, and wall-clock/active time.

**Architecture:** All state logic lives in a pure module (`hooks/hud.ts`): formatters, rate-limit window tracking, a Redux-style reducer and a band view model, none of which touch the engine. `hooks/register.tsx` only reads the engine (`$.session.usage()`, `git` through `$.process.run`, `$.clock`), dispatches actions into one `$.state` atom and draws the view model with the surface's `Box`/`Text`.

**Tech Stack:** Claude Code 2.1.296 function hooks (TypeScript/TSX, `claude-code` API, `claude-code/testing` kit), `claude plugin validate`, `claude plugin test`, TypeScript 5.6.3 via `npx` for type-checking.

**Spec:** `docs/specs/2026-10-09-session-hud-design.md`

## Global Constraints

- Repository: `C:\Users\Usuario\claude-mods` (Git Bash path `/c/Users/Usuario/claude-mods`); the mod lives in `session-hud/`. Run every command from the repository root.
- Work on branch `feat/session-hud`. Code reaches `main` only through the owner's PR policy (decided at the finish step, not in this plan).
- Commits: conventional commits, **no AI attribution and no `Co-Authored-By` lines**.
- Strict TDD: every behavior gets a failing test first, then the minimal code, then a green run.
- Plugin name `session-hud`, version `0.1.0`.
- UI strings in Spanish: `activo`, `sin repo`.
- Constants: severity thresholds 50 / 80 on the **rounded** percent; refresh every `60_000` ms; `git` timeout `5_000` ms; window-roll slack `60_000` ms.
- Theme color keys only: `success`, `warning`, `error`; deltas and countdowns use `dimColor`.
- Hooks environment: no DOM, no Node, no `console`, no `import()`. Relative `import` declarations between plugin files are fine.
- Keys go on `Box` only: a `key` on `Text` is silently stripped.
- Contract (`types/index.d.ts`): exports types only (no `export {}`), and the state shape is written **inline** inside `PluginState` (`'session-hud': { hud: HudState | null }`); an alias there fails validation.
- Test kit facts (verified by spike):
  - Op stubs (`session.usage`, `process.run`) return `{ value }` or `{ deny }`, never a bare object.
  - Events raised by a test (`session.start`, `turn.complete`, `session.measure`, `ui.render`) need a bottom hook registered by the test.
  - `session.start` is not raised on load; the test raises it with `{ cwd, surface, isInteractive }`.
  - A hook that throws does **not** fail a test, so every test asserts on what the band shows.
  - The test's own `$` has no `$.state`; read state through the mounted band.
- Commands:
  - Validate: `claude plugin validate session-hud`
  - Test: `claude plugin test session-hud`
  - Type-check: `npx --yes -p typescript@5.6.3 tsc -p "$SCRATCH/tsc-session-hud/tsconfig.json"`, with `SCRATCH=C:/Users/Usuario/AppData/Local/Temp/claude/C--Users-Usuario/d5a9a82a-706c-4a86-9c3f-2bdb8cfa6f3f/scratchpad`

## Review Focus

1. **Context fill missing** (`usage.context.percent` absent before the first response): the band shows `ctx —`, never `ctx NaN%` or `ctx 0%`. Test in Task 5.
2. **`git` hangs or is refused** (`$.process.run` rejects on timeout): the band shows `sin repo` and the rest still draws. Test in Task 5.
3. **`$.session.usage()` fails mid-session:** the band keeps the last good figures instead of going blank. Test in Task 5.
4. **A window reading loses `resetsAt`** after earlier readings had it: no false roll, no crash, the delta keeps growing, and the known reset time is kept so a later roll is still detected. Test in Task 2.
5. **Detached HEAD** (`git branch --show-current` prints nothing): the band shows the short SHA. Test in Task 5.

---

### Task 1: Scaffold the mod and the formatters

**Files:**
- Create: `.gitattributes`, `.gitignore`
- Create: `session-hud/.claude-plugin/plugin.json`, `session-hud/hooks/hooks.json`, `session-hud/types/index.d.ts`, `session-hud/hooks/register.tsx` (empty registrar for now)
- Create: `session-hud/hooks/hud.ts`
- Test: `session-hud/hooks/hud.test.ts`
- Create (outside the repo): `$SCRATCH/tsc-session-hud/tsconfig.json`

**Interfaces:**
- Consumes: nothing.
- Produces (in `hooks/hud.ts`):
  - `type Severity = 'success' | 'warning' | 'error'`
  - `formatTokens(n: number): string`
  - `formatDuration(ms: number): string`
  - `formatDelta(delta: number): string`
  - `formatPercent(percent: number): string`
  - `severity(percent: number): Severity`
  - `formatCountdown(resetsAt: string | undefined, now: number): string | null`
- Produces (in `types/index.d.ts`): `WindowTrack`, `HudState` and the `PluginState` entry `'session-hud': { hud: HudState | null }`.

- [ ] **Step 1: Create the branch**

```bash
git switch -c feat/session-hud
```

- [ ] **Step 2: Write the repository hygiene files**

`.gitattributes`:

```
* text=auto eol=lf
```

`.gitignore` (the engine writes typings and a tsconfig into a mod folder it loads):

```
*/.claude-plugin/types/
*/tsconfig.json
```

- [ ] **Step 3: Write the manifest, hooks list, contract and an empty registrar**

`session-hud/.claude-plugin/plugin.json`:

```json
{
  "name": "session-hud",
  "version": "0.1.0",
  "description": "Two-line band above the prompt: git branch, subscription limits, session tokens, context fill and time.",
  "author": { "name": "Adrian-Manuel" },
  "types": "./types/index.d.ts"
}
```

`session-hud/hooks/hooks.json`:

```json
{ "modules": ["./register.tsx"] }
```

`session-hud/types/index.d.ts`:

```ts
export type WindowTrack = {
  baseline: number
  carried: number
  lastPercent: number
  resetsAt?: string
}

export type HudState = {
  startedAt: number
  now: number
  branch: string | null
  tokens: { total: number; output: number }
  activeMs: number
  contextPercent: number | null
  windows: Record<string, WindowTrack>
}

declare module 'claude-code' {
  interface PluginState {
    'session-hud': { hud: HudState | null }
  }
}
```

`session-hud/hooks/register.tsx`:

```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 4: Write the type-check config outside the repository**

`$SCRATCH/tsc-session-hud/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [
    "C:/Users/Usuario/AppData/Local/Temp/claude/bundled-skills/2.1.296/05a05a1b600f6c135563affc9f650b2d/plugin-authoring/types/claude-code.d.ts",
    "C:/Users/Usuario/claude-mods/session-hud/hooks",
    "C:/Users/Usuario/claude-mods/session-hud/types"
  ]
}
```

- [ ] **Step 5: Validate the scaffold**

Run: `claude plugin validate session-hud`
Expected: passes with no errors and no `author` warning.

- [ ] **Step 6: Commit the scaffold**

```bash
git add .gitattributes .gitignore session-hud/.claude-plugin/plugin.json session-hud/hooks/hooks.json session-hud/types/index.d.ts session-hud/hooks/register.tsx
git commit -m "chore(session-hud): scaffold the mod"
```

- [ ] **Step 7: Write the failing formatter tests**

`session-hud/hooks/hud.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { formatCountdown, formatDelta, formatDuration, formatPercent, formatTokens, severity } from './hud'

describe('formatTokens', () => {
  test('keeps counts under a thousand raw', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(842)).toBe('842')
  })

  test('uses one decimal under ten thousand and drops .0', () => {
    expect(formatTokens(1_000)).toBe('1k')
    expect(formatTokens(8_400)).toBe('8.4k')
  })

  test('uses whole thousands under a million, choosing the unit after rounding', () => {
    expect(formatTokens(9_960)).toBe('10k')
    expect(formatTokens(38_000)).toBe('38k')
  })

  test('switches to millions after rounding', () => {
    expect(formatTokens(999_600)).toBe('1M')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('formatDuration', () => {
  test('shows <1m under a minute, including negatives', () => {
    expect(formatDuration(59_999)).toBe('<1m')
    expect(formatDuration(-5_000)).toBe('<1m')
  })

  test('shows minutes under an hour', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(47 * 60_000)).toBe('47m')
  })

  test('shows hours with two-digit minutes under a day', () => {
    expect(formatDuration((2 * 60 + 5) * 60_000)).toBe('2h05m')
    expect(formatDuration((2 * 60 + 13) * 60_000)).toBe('2h13m')
  })

  test('shows days and hours from a day on', () => {
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe('3d4h')
  })
})

describe('formatDelta', () => {
  test('signs the delta with at most one decimal', () => {
    expect(formatDelta(11)).toBe('+11')
    expect(formatDelta(0.5)).toBe('+0.5')
    expect(formatDelta(11.199999)).toBe('+11.2')
  })

  test('never shows a negative delta', () => {
    expect(formatDelta(0)).toBe('+0')
    expect(formatDelta(-0.3)).toBe('+0')
  })
})

describe('formatPercent', () => {
  test('rounds to a whole percent', () => {
    expect(formatPercent(41.6)).toBe('42%')
    expect(formatPercent(7)).toBe('7%')
  })
})

describe('severity', () => {
  test('grades the rounded percent at 50 and 80', () => {
    expect(severity(49)).toBe('success')
    expect(severity(49.6)).toBe('warning')
    expect(severity(50)).toBe('warning')
    expect(severity(79)).toBe('warning')
    expect(severity(80)).toBe('error')
  })
})

describe('formatCountdown', () => {
  test('counts down to the reset', () => {
    expect(formatCountdown('1970-01-01T02:05:00.000Z', 0)).toBe('↻2h05m')
  })

  test('omits a missing, past or unreadable reset', () => {
    expect(formatCountdown(undefined, 0)).toBeNull()
    expect(formatCountdown('1970-01-01T00:00:00.000Z', 60_000)).toBeNull()
    expect(formatCountdown('not a date', 0)).toBeNull()
  })
})
```

- [ ] **Step 8: Run the tests to see them fail**

Run: `claude plugin test session-hud`
Expected: FAIL, because `./hud` does not exist yet.

- [ ] **Step 9: Write the formatters**

`session-hud/hooks/hud.ts`:

```ts
export type Severity = 'success' | 'warning' | 'error'

const trimZero = (text: string): string => text.replace(/\.0$/, '')

export const formatTokens = (n: number): string => {
  if (n < 1_000) return String(n)
  const thousandsOneDecimal = Math.round(n / 100) / 10
  if (thousandsOneDecimal < 10) return `${trimZero(thousandsOneDecimal.toFixed(1))}k`
  const thousands = Math.round(n / 1_000)
  if (thousands < 1_000) return `${thousands}k`
  return `${trimZero((Math.round(n / 100_000) / 10).toFixed(1))}M`
}

export const formatDuration = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

export const formatDelta = (delta: number): string =>
  `+${trimZero((Math.round(Math.max(0, delta) * 10) / 10).toFixed(1))}`

export const formatPercent = (percent: number): string => `${Math.round(percent)}%`

export const severity = (percent: number): Severity => {
  const shown = Math.round(percent)
  if (shown >= 80) return 'error'
  if (shown >= 50) return 'warning'
  return 'success'
}

export const formatCountdown = (resetsAt: string | undefined, now: number): string | null => {
  if (resetsAt === undefined) return null
  const remaining = Date.parse(resetsAt) - now
  return Number.isNaN(remaining) || remaining <= 0 ? null : `↻${formatDuration(remaining)}`
}
```

- [ ] **Step 10: Run the tests, the type-check and the validation**

Run: `claude plugin test session-hud`
Expected: PASS (all `hud.test.ts` tests).

Run: `npx --yes -p typescript@5.6.3 tsc -p "$SCRATCH/tsc-session-hud/tsconfig.json"`
Expected: no output, exit code 0.

Run: `claude plugin validate session-hud`
Expected: passes.

- [ ] **Step 11: Commit**

```bash
git add session-hud/hooks/hud.ts session-hud/hooks/hud.test.ts
git commit -m "feat(session-hud): add token, duration, percent and countdown formatters"
```

---

### Task 2: Track rate-limit windows across rolls

**Files:**
- Modify: `session-hud/hooks/hud.ts` (add an import at the top; append the code below)
- Test: `session-hud/hooks/hud.test.ts` (extend the import; append a `describe`)

**Interfaces:**
- Consumes: `WindowTrack` from `../types`.
- Produces (in `hooks/hud.ts`):
  - `type RateLimitReading = { kind: string; percentUsed: number; resetsAt?: string }`
  - `trackWindow(previous: WindowTrack | undefined, reading: RateLimitReading): WindowTrack`
  - `windowDelta(track: WindowTrack): number`

- [ ] **Step 1: Write the failing window tests**

In `session-hud/hooks/hud.test.ts`, replace the `./hud` import with:

```ts
import {
  formatCountdown,
  formatDelta,
  formatDuration,
  formatPercent,
  formatTokens,
  severity,
  trackWindow,
  windowDelta,
} from './hud'
```

Append:

```ts
describe('trackWindow', () => {
  const R1 = '2026-10-09T15:00:00.000Z'
  const R1_JITTER = '2026-10-09T15:00:30.000Z'
  const R2 = '2026-10-09T20:00:00.000Z'

  test('takes the first reading as the baseline', () => {
    const track = trackWindow(undefined, { kind: 'five_hour', percentUsed: 31, resetsAt: R1 })
    expect(track).toMatchObject({ baseline: 31, carried: 0, lastPercent: 31, resetsAt: R1 })
    expect(windowDelta(track)).toBe(0)
  })

  test('grows the delta with later readings of the same window', () => {
    const first = trackWindow(undefined, { kind: 'five_hour', percentUsed: 31, resetsAt: R1 })
    const later = trackWindow(first, { kind: 'five_hour', percentUsed: 42, resetsAt: R1 })
    expect(windowDelta(later)).toBe(11)
  })

  test('ignores reset jitter within a minute', () => {
    const first = trackWindow(undefined, { kind: 'five_hour', percentUsed: 31, resetsAt: R1 })
    const later = trackWindow(first, { kind: 'five_hour', percentUsed: 42, resetsAt: R1_JITTER })
    expect(later).toMatchObject({ baseline: 31, carried: 0 })
    expect(windowDelta(later)).toBe(11)
  })

  test('carries the delta when the reset time jumps forward', () => {
    const first = trackWindow(undefined, { kind: 'five_hour', percentUsed: 31, resetsAt: R1 })
    const later = trackWindow(first, { kind: 'five_hour', percentUsed: 42, resetsAt: R1 })
    const rolled = trackWindow(later, { kind: 'five_hour', percentUsed: 5, resetsAt: R2 })
    expect(rolled).toMatchObject({ baseline: 0, carried: 11, lastPercent: 5, resetsAt: R2 })
    expect(windowDelta(rolled)).toBe(16)
  })

  test('carries the delta when the percent drops', () => {
    const first = trackWindow(undefined, { kind: 'seven_day', percentUsed: 30 })
    const later = trackWindow(first, { kind: 'seven_day', percentUsed: 42 })
    const rolled = trackWindow(later, { kind: 'seven_day', percentUsed: 3 })
    expect(rolled).toMatchObject({ baseline: 0, carried: 12, lastPercent: 3 })
    expect(windowDelta(rolled)).toBe(15)
  })

  test('keeps growing, and keeps the known reset time, when a reading loses it', () => {
    const first = trackWindow(undefined, { kind: 'five_hour', percentUsed: 31, resetsAt: R1 })
    const later = trackWindow(first, { kind: 'five_hour', percentUsed: 35 })
    expect(later).toMatchObject({ baseline: 31, carried: 0, lastPercent: 35, resetsAt: R1 })
    expect(windowDelta(later)).toBe(4)
    const rolled = trackWindow(later, { kind: 'five_hour', percentUsed: 40, resetsAt: R2 })
    expect(rolled).toMatchObject({ baseline: 0, carried: 4, lastPercent: 40, resetsAt: R2 })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test session-hud`
Expected: FAIL, because `trackWindow` and `windowDelta` are not exported.

- [ ] **Step 3: Write the window tracking**

At the top of `session-hud/hooks/hud.ts`, add:

```ts
import type { WindowTrack } from '../types'
```

Append to `session-hud/hooks/hud.ts`:

```ts
export type RateLimitReading = { kind: string; percentUsed: number; resetsAt?: string }

const ROLL_SLACK_MS = 60_000

const isLater = (next: string | undefined, previous: string | undefined): boolean =>
  next !== undefined && previous !== undefined && Date.parse(next) - Date.parse(previous) > ROLL_SLACK_MS

export const windowDelta = (track: WindowTrack): number => track.carried + track.lastPercent - track.baseline

export const trackWindow = (previous: WindowTrack | undefined, reading: RateLimitReading): WindowTrack => {
  const { percentUsed, resetsAt } = reading
  if (previous === undefined) return { baseline: percentUsed, carried: 0, lastPercent: percentUsed, resetsAt }
  const isRolled = percentUsed < previous.lastPercent || isLater(resetsAt, previous.resetsAt)
  if (isRolled) return { baseline: 0, carried: windowDelta(previous), lastPercent: percentUsed, resetsAt }
  // A reading without a reset time keeps the known one, so a later roll is still seen.
  return { ...previous, lastPercent: percentUsed, resetsAt: resetsAt ?? previous.resetsAt }
}
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `claude plugin test session-hud`
Expected: PASS.

Run: `npx --yes -p typescript@5.6.3 tsc -p "$SCRATCH/tsc-session-hud/tsconfig.json"`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add session-hud/hooks/hud.ts session-hud/hooks/hud.test.ts
git commit -m "feat(session-hud): track each rate-limit window's session delta across rolls"
```

---

### Task 3: The HUD reducer

**Files:**
- Modify: `session-hud/hooks/hud.ts` (widen the type import; append the code below)
- Test: `session-hud/hooks/hud.test.ts` (extend the imports; append a `describe`)

**Interfaces:**
- Consumes: `trackWindow`, `RateLimitReading` (Task 2); `HudState` from `../types`.
- Produces (in `hooks/hud.ts`):
  - `type TokenUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }`
  - `type TurnAction = { type: 'turn'; startedAt: number; usage?: TokenUsage; durationMs: number; isMain: boolean }`
  - `type MeasureAction = { type: 'measure'; startedAt: number; now: number; branch: string | null; contextPercent: number | null; rateLimits: readonly RateLimitReading[] }`
  - `type HudAction = TurnAction | MeasureAction`
  - `emptyState(startedAt: number): HudState`
  - `hudReducer(state: HudState | null, action: HudAction): HudState`

- [ ] **Step 1: Write the failing reducer tests**

In `session-hud/hooks/hud.test.ts`, add `hudReducer` to the `./hud` import list and add below the imports:

```ts
import type { HudState } from '../types'
import type { MeasureAction, TurnAction } from './hud'
```

Append:

```ts
describe('hudReducer', () => {
  const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 200 }
  const turn = (overrides: Partial<TurnAction> = {}): TurnAction =>
    ({ type: 'turn', startedAt: 1_000, usage: USAGE, durationMs: 60_000, isMain: true, ...overrides })
  const measure = (overrides: Partial<MeasureAction> = {}): MeasureAction => ({
    type: 'measure',
    startedAt: 1_000,
    now: 5_000,
    branch: 'main',
    contextPercent: 61,
    rateLimits: [{ kind: 'five_hour', percentUsed: 31 }],
    ...overrides,
  })

  test('adds the four token counts to the total and output to output', () => {
    const state = hudReducer(null, turn())
    expect(state.tokens).toEqual({ total: 1_350, output: 50 })
  })

  test('accumulates across turns', () => {
    const state = hudReducer(hudReducer(null, turn()), turn())
    expect(state.tokens).toEqual({ total: 2_700, output: 100 })
    expect(state.activeMs).toBe(120_000)
  })

  test('counts a subagent turn in tokens but not in active time', () => {
    const state = hudReducer(hudReducer(null, turn()), turn({ isMain: false, durationMs: 540_000 }))
    expect(state.tokens.total).toBe(2_700)
    expect(state.activeMs).toBe(60_000)
  })

  test('counts the duration of a main turn without usage', () => {
    const state = hudReducer(null, turn({ usage: undefined, durationMs: 30_000 }))
    expect(state.tokens).toEqual({ total: 0, output: 0 })
    expect(state.activeMs).toBe(30_000)
  })

  test('takes time, branch, context and windows from a measurement', () => {
    const first = hudReducer(null, measure())
    const second = hudReducer(first, measure({ now: 9_000, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }] }))
    expect(second).toMatchObject({ now: 9_000, branch: 'main', contextPercent: 61 })
    expect(second.windows.five_hour).toMatchObject({ baseline: 31, lastPercent: 42 })
  })

  test('keeps a window the latest measurement did not report', () => {
    const first = hudReducer(null, measure({ rateLimits: [{ kind: 'seven_day', percentUsed: 18 }] }))
    const second = hudReducer(first, measure({ rateLimits: [] }))
    expect(second.windows.seven_day).toMatchObject({ lastPercent: 18 })
  })

  test('starts over when the session start changes, keeping the branch', () => {
    const before: HudState = hudReducer(hudReducer(null, measure()), turn())
    const after = hudReducer(before, turn({ startedAt: 2_000, usage: { ...USAGE, input_tokens: 0 } }))
    expect(after).toMatchObject({ startedAt: 2_000, now: 2_000, branch: 'main', contextPercent: null, windows: {} })
    expect(after.tokens).toEqual({ total: 1_250, output: 50 })
    expect(after.activeMs).toBe(60_000)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test session-hud`
Expected: FAIL, because `hudReducer` is not exported.

- [ ] **Step 3: Write the reducer**

In `session-hud/hooks/hud.ts`, replace the type import with:

```ts
import type { HudState, WindowTrack } from '../types'
```

Append:

```ts
export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type TurnAction = { type: 'turn'; startedAt: number; usage?: TokenUsage; durationMs: number; isMain: boolean }

export type MeasureAction = {
  type: 'measure'
  startedAt: number
  now: number
  branch: string | null
  contextPercent: number | null
  rateLimits: readonly RateLimitReading[]
}

export type HudAction = TurnAction | MeasureAction

export const emptyState = (startedAt: number): HudState => ({
  startedAt,
  now: startedAt,
  branch: null,
  tokens: { total: 0, output: 0 },
  activeMs: 0,
  contextPercent: null,
  windows: {},
})

// A new session start (/clear, resume) wipes the figures; the branch is the
// working copy's, not the session's, so it survives until the next reading.
const forSession = (state: HudState | null, startedAt: number): HudState =>
  state !== null && state.startedAt === startedAt ? state : { ...emptyState(startedAt), branch: state?.branch ?? null }

const applyTurn = (state: HudState, action: TurnAction): HudState => {
  const { usage } = action
  const tokens = usage === undefined
    ? state.tokens
    : {
        total:
          state.tokens.total +
          usage.input_tokens +
          usage.output_tokens +
          usage.cache_read_input_tokens +
          usage.cache_creation_input_tokens,
        output: state.tokens.output + usage.output_tokens,
      }
  return { ...state, tokens, activeMs: action.isMain ? state.activeMs + action.durationMs : state.activeMs }
}

const applyMeasure = (state: HudState, action: MeasureAction): HudState => {
  const windows = { ...state.windows }
  for (const reading of action.rateLimits) windows[reading.kind] = trackWindow(windows[reading.kind], reading)
  return { ...state, now: action.now, branch: action.branch, contextPercent: action.contextPercent, windows }
}

export const hudReducer = (state: HudState | null, action: HudAction): HudState => {
  const current = forSession(state, action.startedAt)
  return action.type === 'turn' ? applyTurn(current, action) : applyMeasure(current, action)
}
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `claude plugin test session-hud`
Expected: PASS.

Run: `npx --yes -p typescript@5.6.3 tsc -p "$SCRATCH/tsc-session-hud/tsconfig.json"`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add session-hud/hooks/hud.ts session-hud/hooks/hud.test.ts
git commit -m "feat(session-hud): reduce turns and measurements into the HUD state"
```

---

### Task 4: The band view model

**Files:**
- Modify: `session-hud/hooks/hud.ts` (append)
- Test: `session-hud/hooks/hud.test.ts` (extend the imports; append a `describe`)

**Interfaces:**
- Consumes: the formatters (Task 1), `windowDelta` (Task 2), `HudState` and `WindowTrack`.
- Produces (in `hooks/hud.ts`):
  - `type Segment = { text: string; color?: Severity; isDim?: boolean }`
  - `type BandLine = readonly Segment[]`
  - `bandLines(state: HudState): [BandLine, BandLine]`
  - `lineText(line: BandLine): string`

- [ ] **Step 1: Write the failing view-model tests**

In `session-hud/hooks/hud.test.ts`, add `bandLines`, `emptyState` and `lineText` to the `./hud` import list, then append:

```ts
describe('bandLines', () => {
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const NOW = 2 * HOUR + 13 * MINUTE
  const full: HudState = {
    startedAt: 0,
    now: NOW,
    branch: 'feat/umbrella-x',
    tokens: { total: 1_200_000, output: 38_000 },
    activeMs: 47 * MINUTE,
    contextPercent: 61,
    windows: {
      five_hour: { baseline: 31, carried: 0, lastPercent: 42, resetsAt: new Date(NOW + 2 * HOUR + 5 * MINUTE).toISOString() },
      seven_day: { baseline: 15, carried: 0, lastPercent: 18, resetsAt: new Date(NOW + (3 * 24 + 4) * HOUR).toISOString() },
    },
  }

  test('draws the agreed two lines', () => {
    const [first, second] = bandLines(full)
    expect(lineText(first)).toBe('⎇ feat/umbrella-x │ 5h 42% (+11) ↻2h05m │ 7d 18% (+3) ↻3d4h')
    expect(lineText(second)).toBe('▲ 1.2M tok (out 38k) │ ctx 61% │ ⏱ 2h13m · activo 47m')
  })

  test('colors the percents by severity and dims deltas and countdowns', () => {
    const [first, second] = bandLines({ ...full, contextPercent: 85 })
    expect(first.find(segment => segment.text === '42%')).toEqual({ text: '42%', color: 'success' })
    expect(first.find(segment => segment.text === ' (+11)')).toEqual({ text: ' (+11)', isDim: true })
    expect(first.find(segment => segment.text === ' ↻2h05m')).toEqual({ text: ' ↻2h05m', isDim: true })
    expect(second.find(segment => segment.text === '85%')).toEqual({ text: '85%', color: 'error' })
  })

  test('draws placeholders before any reading', () => {
    const [first, second] = bandLines(emptyState(0))
    expect(lineText(first)).toBe('⎇ sin repo │ 5h — │ 7d —')
    expect(lineText(second)).toBe('▲ 0 tok (out 0) │ ctx — │ ⏱ <1m · activo <1m')
  })

  test('omits a countdown whose reset has passed', () => {
    const passed: HudState = {
      ...full,
      windows: { five_hour: { baseline: 31, carried: 0, lastPercent: 42, resetsAt: new Date(NOW - MINUTE).toISOString() } },
    }
    expect(lineText(bandLines(passed)[0])).toBe('⎇ feat/umbrella-x │ 5h 42% (+11) │ 7d —')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test session-hud`
Expected: FAIL, because `bandLines` and `lineText` are not exported.

- [ ] **Step 3: Write the view model**

Append to `session-hud/hooks/hud.ts`:

```ts
export type Segment = { text: string; color?: Severity; isDim?: boolean }

export type BandLine = readonly Segment[]

const SEPARATOR: Segment = { text: ' │ ' }

const windowSegments = (label: string, track: WindowTrack | undefined, now: number): Segment[] => {
  if (track === undefined) return [{ text: `${label} —` }]
  const countdown = formatCountdown(track.resetsAt, now)
  return [
    { text: `${label} ` },
    { text: formatPercent(track.lastPercent), color: severity(track.lastPercent) },
    { text: ` (${formatDelta(windowDelta(track))})`, isDim: true },
    ...(countdown === null ? [] : [{ text: ` ${countdown}`, isDim: true }]),
  ]
}

const contextSegments = (percent: number | null): Segment[] =>
  percent === null
    ? [{ text: 'ctx —' }]
    : [{ text: 'ctx ' }, { text: formatPercent(percent), color: severity(percent) }]

export const bandLines = (state: HudState): [BandLine, BandLine] => [
  [
    { text: `⎇ ${state.branch ?? 'sin repo'}` },
    SEPARATOR,
    ...windowSegments('5h', state.windows.five_hour, state.now),
    SEPARATOR,
    ...windowSegments('7d', state.windows.seven_day, state.now),
  ],
  [
    { text: `▲ ${formatTokens(state.tokens.total)} tok (out ${formatTokens(state.tokens.output)})` },
    SEPARATOR,
    ...contextSegments(state.contextPercent),
    SEPARATOR,
    { text: `⏱ ${formatDuration(state.now - state.startedAt)} · activo ${formatDuration(state.activeMs)}` },
  ],
]

export const lineText = (line: BandLine): string => line.map(segment => segment.text).join('')
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `claude plugin test session-hud`
Expected: PASS.

Run: `npx --yes -p typescript@5.6.3 tsc -p "$SCRATCH/tsc-session-hud/tsconfig.json"`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add session-hud/hooks/hud.ts session-hud/hooks/hud.test.ts
git commit -m "feat(session-hud): build the two band lines as colored segments"
```

---

### Task 5: Wire the engine and draw the band

**Files:**
- Modify: `session-hud/hooks/register.tsx` (replace the empty registrar)
- Test: `session-hud/hooks/register.test.ts`

**Interfaces:**
- Consumes: `hudReducer`, `HudAction`, `bandLines`, `Segment` from `./hud`.
- Produces: the band drawn on `AbovePrompt` as `Box key="session-hud"`, holding `Box key="session-hud-line-1"` and `Box key="session-hud-line-2"`, each made of one `Text` per segment.

- [ ] **Step 1: Write the failing integration tests**

`session-hud/hooks/register.test.ts`:

```ts
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const BAND = {
  plugin: 'session-hud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const USAGE = { input_tokens: 1_000, output_tokens: 38_000, cache_read_input_tokens: 1_150_000, cache_creation_input_tokens: 11_000, model: 'm' }
const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }

type World = {
  startedAt: number
  percent5h: number
  contextPercent?: number
  branch: string
  git: 'ok' | 'fails' | 'refused'
  isUsageDown: boolean
}

const newWorld = (overrides: Partial<World> = {}): World =>
  ({ startedAt: 0, percent5h: 42, contextPercent: 61, branch: 'main', git: 'ok', isUsageDown: false, ...overrides })

const GIT_FAILURE = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false }

// The engine beneath the plugin, answering from `world` at call time.
const stubEngine = (on: On, world: World) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: { key: 'engine' }, children: ['engine'] }))
  on('session.usage', () => {
    if (world.isUsageDown) return { deny: 'usage unavailable' }
    return {
      value: {
        startedAt: world.startedAt,
        context: { window: 200_000, percent: world.contextPercent },
        rateLimits: [
          { kind: 'five_hour', percentUsed: world.percent5h, resetsAt: new Date(world.startedAt + 3 * HOUR).toISOString() },
        ],
      },
    }
  })
  on('process.run', ($, e) => {
    if (world.git === 'refused') return { deny: 'timed out' }
    if (world.git === 'fails') return { value: GIT_FAILURE }
    const stdout = e.argv.join(' ') === 'git branch --show-current' ? `${world.branch}\n` : 'abc1234\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

type Finder = { find: (query: { key: string }) => Promise<{ text: string } | undefined> }

const textOf = async (ui: Finder, key: string): Promise<string | undefined> => (await ui.find({ key }))?.text

describe('session-hud band', () => {
  test('draws branch, windows, context and time once the session starts', async ($, on) => {
    mock.clock(on, { now: 2 * HOUR })
    stubEngine(on, newWorld())
    await $.session.start(START)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ main │ 5h 42% (+0) ↻1h00m │ 7d —')
      expect(await textOf(ui, 'session-hud-line-2')).toBe('▲ 0 tok (out 0) │ ctx 61% │ ⏱ 2h00m · activo <1m')
      await ui.unmount()
    }
  })

  test('adds every turn to the tokens and only main turns to active time', async ($, on) => {
    mock.clock(on, { now: 2 * HOUR })
    stubEngine(on, newWorld())
    await $.session.start(START)
    await $.turn.complete({ answer: '', durationMs: 5 * MINUTE, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE })
    await $.turn.complete({ answer: '', durationMs: 9 * MINUTE, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'sub-1', usage: NO_USAGE })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await textOf(ui, 'session-hud-line-2')).toBe('▲ 1.2M tok (out 38k) │ ctx 61% │ ⏱ 2h00m · activo 5m')
  })

  test('redraws the mounted band on measurements and on the minute tick', async ($, on) => {
    const clock = mock.clock(on, { now: 2 * HOUR })
    const world = newWorld()
    stubEngine(on, world)
    await $.session.start(START)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    world.percent5h = 47
    await $.session.measure({ context: { window: 200_000, percent: 61 }, rateLimits: [], changed: ['rateLimits'] })
    expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ main │ 5h 47% (+5) ↻1h00m │ 7d —')
    world.percent5h = 50
    await clock.advance(MINUTE)
    expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ main │ 5h 50% (+8) ↻59m │ 7d —')
    expect(await textOf(ui, 'session-hud-line-2')).toBe('▲ 0 tok (out 0) │ ctx 61% │ ⏱ 2h01m · activo <1m')
  })

  test('starts the figures over after a /clear but keeps the branch', async ($, on) => {
    mock.clock(on, { now: 2 * HOUR })
    const world = newWorld()
    stubEngine(on, world)
    await $.session.start(START)
    await $.turn.complete({ answer: '', durationMs: 5 * MINUTE, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE })
    world.startedAt = HOUR
    await $.turn.complete({ answer: '', durationMs: MINUTE, isAborted: false, turnId: 't2', reason: 'answer', usage: { ...NO_USAGE, output_tokens: 500 } })
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ main │ 5h — │ 7d —')
    expect(await textOf(ui, 'session-hud-line-2')).toBe('▲ 500 tok (out 500) │ ctx — │ ⏱ <1m · activo 1m')
  })

  test('shows sin repo when git fails or is refused, and the rest still draws', async ($, on) => {
    mock.clock(on, { now: 2 * HOUR })
    const world = newWorld({ git: 'fails' })
    stubEngine(on, world)
    await $.session.start(START)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ sin repo │ 5h 42% (+0) ↻1h00m │ 7d —')
    world.git = 'refused'
    world.percent5h = 44
    await $.session.measure({ context: { window: 200_000, percent: 61 }, rateLimits: [], changed: ['rateLimits'] })
    expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ sin repo │ 5h 44% (+2) ↻1h00m │ 7d —')
  })

  test('shows the short SHA on a detached HEAD', async ($, on) => {
    mock.clock(on, { now: 2 * HOUR })
    stubEngine(on, newWorld({ branch: '' }))
    await $.session.start(START)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ abc1234 │ 5h 42% (+0) ↻1h00m │ 7d —')
  })

  test('shows ctx — while the context fill is unknown', async ($, on) => {
    mock.clock(on, { now: 2 * HOUR })
    stubEngine(on, newWorld({ contextPercent: undefined }))
    await $.session.start(START)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await textOf(ui, 'session-hud-line-2')).toBe('▲ 0 tok (out 0) │ ctx — │ ⏱ 2h00m · activo <1m')
  })

  test('keeps the last good figures when usage cannot be read', async ($, on) => {
    const clock = mock.clock(on, { now: 2 * HOUR })
    const world = newWorld()
    stubEngine(on, world)
    await $.session.start(START)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    world.isUsageDown = true
    world.percent5h = 90
    await clock.advance(MINUTE)
    expect(await textOf(ui, 'session-hud-line-1')).toBe('⎇ main │ 5h 42% (+0) ↻1h00m │ 7d —')
    expect(await textOf(ui, 'session-hud-line-2')).toBe('▲ 0 tok (out 0) │ ctx 61% │ ⏱ 2h00m · activo <1m')
  })

  test('yields the band before the first measurement and to a survey', async ($, on) => {
    mock.clock(on, { now: 2 * HOUR })
    stubEngine(on, newWorld())
    for (const surface of SURFACES) {
      const before = await $.ui.mount({ ...BAND, surface })
      expect(await before.find({ key: 'session-hud' })).toBeUndefined()
      expect(await before.find({ key: 'engine' })).toBeDefined()
      await before.unmount()
    }
    await $.session.start(START)
    for (const surface of SURFACES) {
      const survey = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, hasSurvey: true } })
      expect(await survey.find({ key: 'session-hud' })).toBeUndefined()
      expect(await survey.find({ key: 'engine' })).toBeDefined()
      await survey.unmount()
    }
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test session-hud`
Expected: the `hud.test.ts` tests PASS and every `session-hud band` test FAILS: the empty registrar never draws `session-hud-line-*`, so `textOf` returns `undefined`.

- [ ] **Step 3: Write the registrar**

Replace `session-hud/hooks/register.tsx` with:

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { bandLines, hudReducer } from './hud'
import type { HudAction, Segment } from './hud'

const REFRESH_MS = 60_000
const GIT_TIMEOUT_MS = 5_000

const hud = atom({ plugin: 'session-hud', key: 'hud' } as const, null)

const dispatch = ($: EngineInterface, action: HudAction) => update($, hud, state => hudReducer(state, action))

const runGit = async ($: EngineInterface, args: readonly string[]): Promise<string | null> => {
  const result = await $.process.run(['git', ...args], { timeoutMs: GIT_TIMEOUT_MS })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

// The branch, the short SHA on a detached HEAD, or null outside a repository
// (and whenever git cannot answer: missing, refused, timed out).
const readBranch = async ($: EngineInterface): Promise<string | null> => {
  try {
    const branch = await runGit($, ['branch', '--show-current'])
    if (branch === null || branch !== '') return branch
    return await runGit($, ['rev-parse', '--short', 'HEAD'])
  } catch {
    return null
  }
}

// A failed read keeps the last good state: the HUD never blocks a turn.
const refresh = async ($: EngineInterface): Promise<void> => {
  try {
    const [usage, branch, now] = await Promise.all([$.session.usage(), readBranch($), $.clock.now()])
    await dispatch($, {
      type: 'measure',
      startedAt: usage.startedAt,
      now,
      branch,
      contextPercent: usage.context.percent ?? null,
      rateLimits: usage.rateLimits,
    })
  } catch {
    // Keep the last good state.
  }
}

const styleOf = (segment: Segment) => ({
  ...(segment.color === undefined ? {} : { color: segment.color }),
  ...(segment.isDim === true ? { dimColor: true } : {}),
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const { startedAt } = await $.session.usage()
      await dispatch($, {
        type: 'turn',
        startedAt,
        usage: e.usage,
        durationMs: e.durationMs,
        isMain: e.agentId === undefined,
      })
    } catch {
      // Keep the last good state.
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, hud)
    if (e.props.hasSurvey || state === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const [first, second] = bandLines(state)

    return (
      <Box key="session-hud" flexDirection="column">
        <Box key="session-hud-line-1">
          {first.map(segment => <Text {...styleOf(segment)}>{segment.text}</Text>)}
        </Box>
        <Box key="session-hud-line-2">
          {second.map(segment => <Text {...styleOf(segment)}>{segment.text}</Text>)}
        </Box>
      </Box>
    )
  })
}
```

- [ ] **Step 4: Run the tests, the type-check and the validation**

Run: `claude plugin test session-hud`
Expected: PASS (every `hud.test.ts` and `register.test.ts` test).

Run: `npx --yes -p typescript@5.6.3 tsc -p "$SCRATCH/tsc-session-hud/tsconfig.json"`
Expected: exit code 0.

Run: `claude plugin validate session-hud`
Expected: passes, listing hooks on `session.start`, `session.measure`, `turn.complete` and `ui.render`.

- [ ] **Step 5: Commit**

```bash
git add session-hud/hooks/register.tsx session-hud/hooks/register.test.ts
git commit -m "feat(session-hud): draw the band from session usage, turns and git"
```

---

### Task 6: Document, try it live, and load it everywhere

**Files:**
- Create: `README.md` (repository index), `session-hud/README.md`
- Modify: `docs/specs/2026-10-09-session-hud-design.md` (add section 11, Execution rulings)
- Modify (outside the repo, by the controller only): `~/.claude/settings.json` (`env.CLAUDE_CODE_PLUGIN_DIRS`)

**Interfaces:**
- Consumes: the finished mod (Tasks 1–5).
- Produces: documentation; the mod loaded in this session (hot reload) and in every future session.

- [ ] **Step 1: Write the mod README**

`session-hud/README.md`:

````markdown
# session-hud

A two-line band above the Claude Code prompt:

```
⎇ feat/umbrella-x │ 5h 42% (+11) ↻2h05m │ 7d 18% (+3) ↻3d4h
▲ 1.2M tok (out 38k) │ ctx 61% │ ⏱ 2h13m · activo 47m
```

| Figure | Meaning |
|---|---|
| `⎇ feat/umbrella-x` | Current git branch (short SHA on a detached HEAD, `sin repo` outside a repository) |
| `5h 42% (+11) ↻2h05m` | 5-hour subscription window: percent used, how much **this session** consumed, time until reset |
| `7d 18% (+3) ↻3d4h` | Same for the 7-day window |
| `▲ 1.2M tok (out 38k)` | Total tokens this session (input + output + cache read + cache write, subagents included), output separately |
| `ctx 61%` | Context-window fill |
| `⏱ 2h13m · activo 47m` | Wall clock since the session started · time Claude spent working on main-thread turns |

Percentages turn green below 50 %, yellow below 80 % and red from 80 %. The band refreshes after every turn and every minute.

## Install

The mod loads from this folder in every session through `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\Usuario\\claude-mods\\session-hud" } }
```

Multiple mods are separated with `;` on Windows (`:` on macOS/Linux). Restart Claude Code after changing it.

## Known limitations

- Token totals count from the moment the mod loads; earlier turns of a resumed session are not included.
- The subscription delta includes other sessions running in parallel on the same account, since the windows are account-wide.
- Window figures move only when the API reports them (after responses).
- With an API key instead of a subscription there are no windows: `5h —` / `7d —`.

## Development

```bash
claude plugin validate session-hud
claude plugin test session-hud
```

Design: [`docs/specs/2026-10-09-session-hud-design.md`](../docs/specs/2026-10-09-session-hud-design.md). Plan: [`docs/plans/2026-10-09-session-hud.md`](../docs/plans/2026-10-09-session-hud.md).
````

- [ ] **Step 2: Write the repository README**

`README.md`:

```markdown
# claude-mods

Personal Claude Code mods (function-hook plugins), one folder each.

| Mod | What it does |
|---|---|
| [`session-hud`](session-hud/README.md) | Band above the prompt with branch, subscription limits, session tokens, context fill and time |

Each mod validates with `claude plugin validate <mod>` and tests with `claude plugin test <mod>`. Specs and plans live in `docs/`.
```

- [ ] **Step 3: Record the execution rulings in the spec**

Append to `docs/specs/2026-10-09-session-hud-design.md`:

```markdown
## 11. Execution rulings

Decisions taken while planning and implementing, on top of sections 1–10:

- **Development location:** the mod is developed and committed in this repository (one commit per TDD step) and is only mirrored into the session mods folder for the live check; section 10's "development in the session mods folder" is superseded.
- **Branch survives a session reset:** a `/clear` or resume wipes tokens, active time, context and windows, but keeps the last branch until the next reading, because the branch belongs to the working copy, not to the session.
- **Band view model:** `bandLines(state)` in `hud.ts` turns the state into colored segments, so the whole layout is unit-tested without the engine; `register.tsx` only maps segments to `Text`.
- **Severity colors** are the theme keys `success` / `warning` / `error`, computed on the rounded percent.
- **Missing reset time:** a window reading without `resetsAt` keeps the previously known one (section 5.4 said "update `resetsAt`"), so a later roll is still detected and the countdown keeps showing.
- **Contract shape:** the state is declared inline (`'session-hud': { hud: HudState | null }`); validation refuses an alias there.
- **Test kit facts** (verified by a throwaway spike): op stubs answer `{ value }` or `{ deny }`; raised events need bottom hooks; a hook that throws does not fail a test, so every test asserts on the drawn band; `key` is honored on `Box` only.
```

- [ ] **Step 4: Commit the documentation**

```bash
git add README.md session-hud/README.md docs/specs/2026-10-09-session-hud-design.md
git commit -m "docs(session-hud): add READMEs and execution rulings"
```

- [ ] **Step 5: Live check in this session (controller only)**

Copy `session-hud/` (without `.claude-plugin/types/` or `tsconfig.json` if present) to `C:\Users\Usuario\.claude\dev-mods\d5a9a82a-706c-4a86-9c3f-2bdb8cfa6f3f\session-hud\`. The engine asks the person "Enable hot reloading for this session?"; on `Enable for this session` the mod loads when the turn ends. Expected: the two-line band appears above the prompt with the real branch, windows, tokens and time.

- [ ] **Step 6: Load it in every future session (controller only)**

Read `~/.claude/settings.json`, then merge `"CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\Usuario\\claude-mods\\session-hud"` into its `env` object, keeping every existing key. Do not commit anything outside the repository.
