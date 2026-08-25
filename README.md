# jpi-sidebar

An OpenCode-style sidebar for Pi's fullscreen TUI. It shows live session
stats, todos, and subagents down one edge of the terminal — the left edge by
default, or the right, depending on config.

**This only works when pi is running its fullscreen renderer** (start it with
`--tui-mode fullscreen`). In regular mode jpi-sidebar does nothing at all — no
notification, no visible change — so it's always safe to install. Running
`/sidebar` explicitly in regular mode does answer, telling you fullscreen is
required.

## What it shows

- **Session** — title, active tool, model, context usage, elapsed time, turn
  count, tokens per second, token counts, and cost.
- **Todos** — reads `@tintinweb/pi-tasks`'s task file directly (subject,
  status) when that package is installed. Without it, falls back to parsing
  the input of any tool with "todo" in its name.
- **Subagents** — listens to `@tintinweb/pi-subagents`'s event bus
  (lifecycle plus final tool/token/duration stats) when that package is
  installed. Without it, falls back to a narrow tool-name heuristic (exactly
  `task`/`agent`, or a `dispatch*` prefix) that stands down the moment a real
  bus event is seen. A subagent with no terminal event for 30 minutes shows
  as `lost`. While a subagent is running, jpi-sidebar also polls
  pi-subagents' cross-extension manager registry once a second for its live
  status word (queued/running/steered), tool count, tokens, and cost, when
  that registry is present — a completed/failed subagent's final stats always
  come from the bus event, never from a poll.

Both panels show an empty state when their package isn't installed — there's
nothing to detect, so nothing renders as an error.

Everything comes from official pi extension events, the pi-subagents event
bus, and the pi-tasks file — there are no LLM calls of any kind, including
for session titles (the title is the session name, or a truncated first user
prompt).

Workspace/git and MCP panels are out of scope for now.

## Install

```
pi install git:github.com/josh-sola/jpi-sidebar
```

## Config

jpi-sidebar reads the `sidebar { }` section of the shared
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/jpi.kdl`. The section is created with
defaults the first time it loads if it's missing:

```kdl
sidebar {
  enabled #true
  width 40
  linger 30
  position "left"
}
```

`width` is clamped to 10–120; a value outside that range is treated as the
default (40) and reported as a warning at session start. `linger` (0–600,
default 30) is how many seconds a completed todo or a finished subagent stays
visible before it's dropped from its panel. `position` is `"left"` or
`"right"` (case-insensitive); any other value is treated as the default
(`"left"`) and reported as a warning at session start.

## Commands

- `/sidebar on` / `/sidebar off` — toggle the sidebar for future frames.
- `/sidebar width <10-120>` — resize it.
- `/sidebar position <left|right>` — move it to the other edge.
- **Alt+S** — toggle the sidebar without typing a command.

Each of these writes the change straight into the `sidebar { }` section of
`jpi.kdl`, alongside whatever else is in the file, so it survives a restart.
The change still takes effect immediately even if the write fails (for
example, a read-only `jpi.kdl`) — jpi-sidebar warns when that happens instead
of losing the change.

## Development

```
npm install
npm test
```

To try a checkout inside a real Pi session:

```
pi -e . --tui-mode fullscreen
```
