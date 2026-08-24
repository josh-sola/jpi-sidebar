import { formatCount, formatDuration, formatRelativeTime, truncate } from "../format.ts";
import type { SidebarSnapshot, SubagentEntry } from "../state.ts";
import type { ThemeLike } from "../theme.ts";

const TOOL_LOG_PREVIEW = 3;

function renderSubagentBlock(agent: SubagentEntry, width: number, theme: ThemeLike, now: number): string[] {
  const lines: string[] = [];
  const elapsed = now - agent.startedAt;
  const contentMax = Math.max(0, width - 2);

  let glyph: string;
  let nameColor: string;
  if (agent.status === "completed") {
    glyph = theme.fg("success", "✓");
    nameColor = "success";
  } else if (agent.status === "failed") {
    glyph = theme.fg("warning", "✗");
    nameColor = "warning";
  } else {
    glyph = theme.fg("accent", "●");
    nameColor = "accent";
  }

  lines.push(`${glyph} ${theme.fg(nameColor, truncate(agent.name, contentMax))}`);

  const meta = `${agent.turns} turns · ${agent.toolCount} tools · ${formatCount(agent.tokens)} tokens`;
  if (agent.status === "completed" && agent.completedAt !== undefined) {
    lines.push(theme.fg("dim", `  complete (${formatRelativeTime(now - agent.completedAt)})`));
    const duration = formatDuration(agent.completedAt - agent.startedAt);
    lines.push(theme.fg("dim", `  ${truncate(`${meta} · ${duration}`, contentMax)}`));
  } else if (agent.status === "failed") {
    lines.push(theme.fg("dim", `  failed (${formatRelativeTime(elapsed)})`));
    lines.push(theme.fg("dim", `  ${truncate(meta, contentMax)}`));
  } else {
    lines.push(theme.fg("dim", `  running (${formatDuration(elapsed)})`));
    lines.push(theme.fg("dim", `  ${truncate(meta, contentMax)}`));
  }

  for (const entry of agent.toolLog.slice(-TOOL_LOG_PREVIEW)) {
    lines.push(theme.fg("dim", `  ${truncate(entry, contentMax)}`));
  }

  return lines;
}

export function renderSubagentsPanel(
  state: SidebarSnapshot,
  width: number,
  theme: ThemeLike,
  now: number = Date.now(),
): string[] {
  if (state.subagents.length === 0) return [theme.fg("dim", "  (no subagents)")];

  const lines: string[] = [];
  state.subagents.forEach((agent, index) => {
    if (index > 0) lines.push("");
    lines.push(...renderSubagentBlock(agent, width, theme, now));
  });
  return lines;
}
