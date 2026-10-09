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
// Window tracking is order-sensitive: a stale lower percent would read as a
// roll. Refreshes run one at a time, each reading after the last dispatched.
let queue: Promise<void> = Promise.resolve()
const serially = (work: () => Promise<void>): Promise<void> => (queue = queue.then(work))

const refresh = ($: EngineInterface): Promise<void> =>
  serially(async () => {
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
  })

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
          <Text>{first.map(segment => <Text {...styleOf(segment)}>{segment.text}</Text>)}</Text>
        </Box>
        <Box key="session-hud-line-2">
          <Text>{second.map(segment => <Text {...styleOf(segment)}>{segment.text}</Text>)}</Text>
        </Box>
      </Box>
    )
  })
}
