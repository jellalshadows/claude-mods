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
