import type { HudState, WindowTrack } from '../types'

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
