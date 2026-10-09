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
