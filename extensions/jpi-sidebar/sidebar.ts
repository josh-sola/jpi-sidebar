import { truncateToWidth } from "@earendil-works/pi-tui";

import { renderSessionPanel } from "./panels/session.ts";
import { renderSubagentsPanel } from "./panels/subagents.ts";
import { renderTodosPanel } from "./panels/todos.ts";
import type { SidebarSnapshot } from "./state.ts";
import type { ThemeLike } from "./theme.ts";

interface Panel {
  title(state: SidebarSnapshot): string;
  render(state: SidebarSnapshot, width: number, theme: ThemeLike): string[];
}

const PANELS: readonly Panel[] = [
  { title: () => "Session", render: renderSessionPanel },
  {
    title: (state) => `Todos (${state.todos.filter((todo) => todo.status === "completed").length}/${state.todos.length})`,
    render: renderTodosPanel,
  },
  {
    title: (state) =>
      `Subagents (${state.subagents.filter((agent) => agent.status === "completed").length}/${state.subagents.length})`,
    render: renderSubagentsPanel,
  },
];

export function renderSidebar(state: SidebarSnapshot, width: number, theme: ThemeLike): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];

  for (const panel of PANELS) {
    const body = panel.render(state, safeWidth, theme);
    if (body.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(theme.bold(` ${panel.title(state)}`));
    lines.push(theme.fg("dim", "─".repeat(safeWidth)));
    lines.push(...body);
  }

  return lines.map((line) => truncateToWidth(line, safeWidth, ""));
}
