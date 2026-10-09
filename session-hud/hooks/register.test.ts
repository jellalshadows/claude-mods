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
