import { describe, expect, test } from 'claude-code/testing'

import {
  formatCountdown,
  formatDelta,
  formatDuration,
  formatPercent,
  formatTokens,
  hudReducer,
  severity,
  trackWindow,
  windowDelta,
} from './hud'
import type { HudState } from '../types'
import type { MeasureAction, TurnAction } from './hud'

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
