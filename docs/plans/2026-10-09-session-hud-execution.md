# session-hud — Execution Record

- **Plan:** [`2026-10-09-session-hud.md`](2026-10-09-session-hud.md)
- **Spec:** [`../specs/2026-10-09-session-hud-design.md`](../specs/2026-10-09-session-hud-design.md)
- **Method:** subagent-driven development. Each task got a fresh implementer, then a task review (spec compliance + quality). The whole branch then got a final review on the most capable model, one fix wave, and a scoped re-review.
- **Branch:** `feat/session-hud`, from `main` @ `d01a750`.
- **Result:** 42 tests passing (`claude plugin test session-hud`), `claude plugin validate` passing, type-check clean.

## Pre-flight

Before execution, a throwaway spike verified the test-kit behavior the plan depends on, against Claude Code 2.1.296:

- Op stubs answer `{ value }` or `{ deny }`, and raised events need bottom hooks.
- `session.start` is not raised on load.
- A hook that throws does not fail a test.
- `key` is honored on `Box` only.
- `.map()` children work, conditional spread props work, and a `$` captured in a timer works.

The plan was then scanned for cross-task interface conflicts; none were found.

## Task log

| Task | Commits | Tests | Review |
|---|---|---|---|
| 1. Scaffold + formatters | `05bced6`, `5d7e074` | 14 | Approved |
| 2. Window tracking | `a9a5fb9` | 20 | Approved |
| 3. Reducer | `aa932b8` | 27 | Approved |
| 4. Band view model | `516365f` | 31 | Approved |
| 5. Engine wiring + band | `8fada05` | 40 | Approved |
| 6. Docs | `03be613` | 40 | Approved |
| Final-review fix wave | `0d9e947` | 42 | All findings addressed |

## Final review findings (fixed)

1. **Overlapping refreshes permanently inflated the session delta (Important).**
   - **Cause:** `refresh` reads usage, waits on `git`, then dispatches. When the minute tick and a `session.measure` overlapped and the older read landed last, `trackWindow` read the lower percent as a window roll.
   - **Effect:** reproduced as `5h 43% (+12)` → `5h 42% (+54)`.
   - **Fix:** every refresh now runs through one module-level promise chain. A gated-`git` regression test pins it.
   - **TDD:** the regression test's RED run showed the corrupted delta.
2. **Band lines shredded at narrow widths (Important).**
   - **Cause:** each line was a row of sibling `Text` segments. When a line is wider than the band, Ink shrinks every sibling and wraps it in its own column.
   - **Fix:** each line is now one `Text` with nested colored segments. A structural test pins it.

## Rulings

Each ruling: the decision, why, and what it costs if wrong.

1. **The controller created `feat/session-hud`, so Task 1 Step 1 was skipped.**
   - Why: no implementation should ever touch `main`.
   - Cost if wrong: none.
2. **Worked in place on the feature branch, not in a git worktree.**
   - Why: the repository held only two docs and nothing else was in flight.
   - Cost if wrong: a parallel edit on `main` could collide; none was planned.
3. **Plan Task 6 Steps 5–6 (live copy into the session mods folder; `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`) were done by the controller after the final review.**
   - Why: they are side effects outside the repository and depend on the reviewed code.
   - Cost if wrong: one settings key to remove.
4. **No `/plugin install --marketplace` line in the mod README, despite `validate`'s advisory.**
   - Why: spec §10 puts marketplace distribution out of scope for 0.1.0, and the repository has no remote.
   - Cost if wrong: one README line to add when a `marketplace.json` lands.
5. **Final-review Minor not applied: `session.start` still awaits `refresh` (including `git`) before `next(e)`.**
   - Why: this is spec §6's deterministic contract, and the integration tests rely on it. The cost is two local `git` calls, tens of milliseconds.
   - Cost if wrong: if `git` hangs, startup waits up to 5 s once per session.
6. **Final-review Minor not applied: no refresh on `session.end` with reason `clear`.**
   - Why: the minute tick corrects the band within 60 s, which matches the spec's refresh cadence. Scheduling work from `session.end`'s short bound is unverified engine territory.
   - Cost if wrong: old figures linger up to 60 s after `/clear`.
7. **Final-review Minors 3–5 folded into the fix wave.** These were the README wording and the resumed-session clock limitation, the vacuous `windows: {}` assertion, and the spec §11 commit wording. Spec §6's "compose functionally" claim was corrected too.
   - Why: cheap, and they keep the docs and tests honest.
   - Cost if wrong: docs churn only.
8. **Controller misjudgment, corrected.** The overlapping-refresh race was first logged during Task 5 as a minor that heals on the next tick. The final review proved the damage permanent, and it became Important 1.
   - Cost: none shipped; caught before merge.

## Deferred minor findings (triaged in the final review: none block merge)

| Origin | Finding | Triage |
|---|---|---|
| Task 1 | Duration unit-rollover boundaries (59m → `1h00m`, 24h → `1d0h`) untested | Code verified correct |
| Task 1 | `formatDuration` / `formatDelta` render `NaN` as `NaNdNaNh` / `+NaN` | No `NaN` path: engine inputs are numbers |
| Task 1 | A fractional token count under 1 000 prints decimals | Token counts are integers |
| Task 2 | A percent-drop roll without `resetsAt` clears `resetsAt` | Correct: the old reset time is stale after a roll |
| Task 2 | Explicit `resetsAt: undefined` keys are dropped by JSON state | Nothing tests `'resetsAt' in track` |
| Task 2 | Untested: a first reading without `resetsAt` followed by one with it; an unchanged percent; the exact 60 000 ms boundary | Traced correct; strict `>` matches spec §5.4 |
| Task 3 | No reset test through a `measure` action | Same `forSession` path as the tested `turn` reset |
| Task 4 | View-model tests skip the `warning` color and the dimming of the 7d countdown | `severity` is unit-tested; the mapping is shared |
| Task 4 | `SEPARATOR` is a segment object shared across lines | Readonly, never mutated |
| Task 5 | If `usage()` rejects inside `turn.complete`, that turn's figures are dropped | Rare; matches spec §8 keep-last-good-state |
| Task 5 | No integration test for `turn.complete` without usage, nor for a repeated `session.start` | Reducer test and the engine contract cover them |
| Task 6 | README install path is the owner's absolute path | Personal repository, per spec §10 |
| Fix wave | The refresh queue is module-level, so a test that fails with its gate parked would stall later tests in the module | Passing runs unaffected |

## Notes

- The type-check config lives outside the repository and points at the engine's bundled typings for 2.1.296. After a Claude Code update, point it at the new `bundled-skills/<version>/…/types/claude-code.d.ts`, or use the `.claude-plugin/types/` folder the engine writes beside a loaded mod.
- One implementer used a shell heredoc to append tests, against the owner's tool rules. The content was verified correct; later dispatches required file-editing tools.
