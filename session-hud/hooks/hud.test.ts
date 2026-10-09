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
