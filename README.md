# jpi-sidebar

An OpenCode-style sidebar for Pi's fullscreen TUI. It shows live session
stats, todos, and subagents down the right edge of the terminal.

**This only works when pi is running its fullscreen renderer** (start it with
`--tui-mode fullscreen`). In regular mode jpi-sidebar does nothing at all — no
notification, no visible change — so it's always safe to install. Running
`/sidebar` explicitly in regular mode does answer, telling you fullscreen is
required.

## What it shows

- **Session** — title, active tool, model, context usage, elapsed time, turn
  count, tokens per second, token counts, and cost.
- **Todos** — the agent's current todo list with status glyphs.
- **Subagents** — running, completed, and failed subagent tasks, each with
  turn/tool/token counts and a short recent-activity log.

Everything comes from official pi extension events — there are no LLM calls
of any kind, including for session titles (the title is the session name, or
a truncated first user prompt).

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
}
```

`width` is clamped to 10–120; a value outside that range is treated as the
default (40) and reported as a warning at session start.

## Commands

- `/sidebar on` / `/sidebar off` — toggle the sidebar for future frames.
- `/sidebar width <10-120>` — resize it.
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
