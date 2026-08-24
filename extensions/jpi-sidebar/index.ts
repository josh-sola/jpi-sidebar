import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type CompositorTerminal, SidebarCompositor } from "./compositor.ts";
import { createSidebarConfig, loadSidebarSettings } from "./config.ts";
import { renderSidebar } from "./sidebar.ts";
import { TASK_TOOL_PATTERN, SidebarState } from "./state.ts";
import {
  parseSubagentFinished,
  parseSubagentStarted,
  SUBAGENT_COMPLETED_CHANNEL,
  SUBAGENT_FAILED_CHANNEL,
  SUBAGENT_READY_CHANNEL,
  SUBAGENT_STARTED_CHANNEL,
} from "./subagents-bus.ts";
import { loadTaskTodos } from "./tasks.ts";
import type { ThemeLike } from "./theme.ts";

const RENDER_DEBOUNCE_MS = 16;
const CLOCK_INTERVAL_MS = 30_000;
const MIN_WIDTH = 10;
const MAX_WIDTH = 120;

interface WidgetTui {
  readonly mode: string;
  readonly terminal: CompositorTerminal;
  requestRender(force?: boolean): void;
}

interface NotifyContext {
  ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
}

interface TaskReloadContext {
  cwd: string;
  sessionManager: { getSessionId(): string };
}

export default function jpiSidebar(pi: ExtensionAPI) {
  const config = createSidebarConfig();
  const state = new SidebarState();

  let enabled = true;
  let width = 40;
  let tui: WidgetTui | null = null;
  let theme: ThemeLike | null = null;
  let compositor: SidebarCompositor | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  const scheduleRender = () => {
    compositor?.invalidate();
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      tui?.requestRender();
    }, RENDER_DEBOUNCE_MS);
  };

  const teardownCompositor = () => {
    compositor?.dispose();
    compositor = null;
  };

  const installCompositor = () => {
    if (!enabled || !tui || !theme || compositor) return;
    const activeTheme = theme;
    const instance = new SidebarCompositor(tui, {
      getWidth: () => width,
      renderBand: (bandWidth) => renderSidebar(state.snapshot(), bandWidth, activeTheme),
    });
    if (instance.install()) compositor = instance;
  };

  const applyOverride = async (
    override: { enabled?: boolean; width?: number },
    ctx: NotifyContext,
  ): Promise<boolean> => {
    if (override.enabled !== undefined) enabled = override.enabled;
    if (override.width !== undefined) width = override.width;

    if (!enabled) {
      teardownCompositor();
    } else {
      installCompositor();
    }
    scheduleRender();

    // The runtime change above already took effect; a persistence failure
    // must not roll it back, only warn that it won't survive a restart.
    const result = await config.save(override);
    if (result.issues.length > 0) {
      ctx.ui.notify(
        `jpi-sidebar: active for this session, but could not be saved to jpi.kdl: ${result.issues[0]}`,
        "warning",
      );
    }

    return compositor !== null;
  };

  // pi-tasks broadcasts nothing, so the todo list is only ever as fresh as
  // the last reload; only replace it when a file was actually found and read.
  const reloadTasks = async (ctx: TaskReloadContext) => {
    const todos = await loadTaskTodos(ctx.cwd, ctx.sessionManager.getSessionId());
    if (todos !== undefined) {
      state.setTodos(todos);
      scheduleRender();
    }
  };

  // Subscribed once for the process's life, not per session: pi-subagents
  // fires subagents:ready on every session_start, and busActive is sticky.
  if (pi.events && typeof pi.events.on === "function") {
    const events = pi.events;
    events.on(SUBAGENT_READY_CHANNEL, () => {
      state.markSubagentBusActive();
    });
    events.on(SUBAGENT_STARTED_CHANNEL, (data) => {
      const payload = parseSubagentStarted(data);
      if (payload) {
        state.onSubagentStarted(payload);
        scheduleRender();
      }
    });
    events.on(SUBAGENT_COMPLETED_CHANNEL, (data) => {
      const payload = parseSubagentFinished(data);
      if (payload) {
        state.onSubagentFinished(payload, "completed");
        scheduleRender();
      }
    });
    events.on(SUBAGENT_FAILED_CHANNEL, (data) => {
      const payload = parseSubagentFinished(data);
      if (payload) {
        state.onSubagentFinished(payload, "failed");
        scheduleRender();
      }
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    const loaded = await loadSidebarSettings(config);
    enabled = loaded.enabled;
    width = loaded.width;
    if (loaded.issues.length > 0) {
      ctx.ui.notify(`jpi-sidebar config at ${loaded.path} has issues: ${loaded.issues.join("; ")}.`, "warning");
    }

    state.onSessionStart(ctx);
    await reloadTasks(ctx);

    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(scheduleRender, CLOCK_INTERVAL_MS);

    if (!ctx.hasUI) return;

    ctx.ui.setWidget(
      "jpi-sidebar",
      (widgetTui, widgetTheme) => {
        tui = widgetTui;
        theme = widgetTheme;
        installCompositor();

        return {
          render: () => [],
          invalidate: () => {},
          dispose: () => {
            teardownCompositor();
            tui = null;
            theme = null;
          },
        };
      },
      { placement: "belowEditor" },
    );
  });

  pi.on("session_shutdown", async () => {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    state.onSessionShutdown();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    state.onBeforeAgentStart(event, ctx);
    scheduleRender();
  });

  pi.on("agent_start", async (_event, ctx) => {
    state.onAgentStart(ctx);
    scheduleRender();
  });

  pi.on("agent_end", async (_event, ctx) => {
    state.onAgentEnd(ctx);
    scheduleRender();
  });

  pi.on("message_start", async (event) => {
    state.onMessageStart(event);
  });

  pi.on("message_update", async (event) => {
    state.onMessageUpdate(event);
    scheduleRender();
  });

  pi.on("message_end", async (event) => {
    state.onMessageEnd(event);
    scheduleRender();
  });

  pi.on("tool_call", async (event) => {
    state.onToolCall(event);
    scheduleRender();
  });

  pi.on("tool_result", async (event, ctx) => {
    state.onToolResult(event);
    // After the tool ran, so pi-tasks's file already reflects the change.
    if (TASK_TOOL_PATTERN.test(event.toolName ?? "")) await reloadTasks(ctx);
    scheduleRender();
  });

  pi.on("tool_execution_start", async (event) => {
    state.onToolExecutionStart(event);
    scheduleRender();
  });

  pi.on("tool_execution_end", async () => {
    state.onToolExecutionEnd();
    scheduleRender();
  });

  pi.on("turn_end", async (_event, ctx) => {
    state.onTurnEnd(ctx);
    scheduleRender();
  });

  pi.on("model_select", async (event, ctx) => {
    state.onModelSelect(event, ctx);
    scheduleRender();
  });

  pi.registerCommand("sidebar", {
    description: "Control the sidebar: /sidebar on | off | width <N>",
    handler: async (args, ctx) => {
      const [action, value] = args.trim().split(/\s+/).filter(Boolean);

      if (action === "on" || action === "off") {
        const active = await applyOverride({ enabled: action === "on" }, ctx);
        if (action === "off") {
          ctx.ui.notify("jpi-sidebar disabled.", "info");
        } else if (active) {
          ctx.ui.notify("jpi-sidebar enabled.", "info");
        } else {
          ctx.ui.notify("jpi-sidebar needs pi's fullscreen renderer (start with --tui-mode fullscreen).", "warning");
        }
        return;
      }

      if (action === "width") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < MIN_WIDTH || parsed > MAX_WIDTH) {
          ctx.ui.notify(`Usage: /sidebar width <${MIN_WIDTH}-${MAX_WIDTH}>`, "warning");
          return;
        }
        await applyOverride({ width: parsed }, ctx);
        ctx.ui.notify(`jpi-sidebar width set to ${parsed}.`, "info");
        return;
      }

      ctx.ui.notify("Usage: /sidebar on | off | width <N>", "warning");
    },
  });

  pi.registerShortcut("alt+s", {
    description: "Toggle the jpi-sidebar",
    handler: async (ctx) => {
      const turningOn = !enabled;
      const active = await applyOverride({ enabled: turningOn }, ctx);
      if (!turningOn) {
        ctx.ui.notify("jpi-sidebar disabled.", "info");
      } else if (active) {
        ctx.ui.notify("jpi-sidebar enabled.", "info");
      } else {
        ctx.ui.notify("jpi-sidebar needs pi's fullscreen renderer (start with --tui-mode fullscreen).", "warning");
      }
    },
  });
}
