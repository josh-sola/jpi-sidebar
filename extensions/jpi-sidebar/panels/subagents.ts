import { formatCount, formatDuration, formatRelativeTime, truncate } from "../format.ts";
import type { SidebarSnapshot, SubagentEntry } from "../state.ts";
import type { ThemeLike } from "../theme.ts";

function finalStats(agent: SubagentEntry): string | undefined {
  const parts: string[] = [];
  if (typeof agent.toolUses === "number") parts.push(`${agent.toolUses} tools`);
  if (typeof agent.tokens === "number") parts.push(`${formatCount(agent.tokens)} tokens`);
  if (typeof agent.durationMs === "number") parts.push(formatDuration(agent.durationMs));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// Elapsed is always known (startedAt always is); tools/tokens/cost come from
// the registry poll and are absent until it's had a chance to run once.
function liveStats(agent: SubagentEntry, now: number): string {
  const parts: string[] = [];
  if (typeof agent.toolUses === "number") parts.push(`${agent.toolUses} tools`);
  if (typeof agent.tokens === "number") parts.push(`${formatCount(agent.tokens)} tokens`);
  if (typeof agent.cost === "number") parts.push(`$${agent.cost.toFixed(2)}`);
  parts.push(formatDuration(now - agent.startedAt));
  return parts.join(" · ");
}

function renderSubagentBlock(agent: SubagentEntry, width: number, theme: ThemeLike, now: number): string[] {
  const lines: string[] = [];
  const contentMax = Math.max(0, width - 2);
  const label = agent.type ? `${agent.name} (${agent.type})` : agent.name;

  let glyph: string;
  let nameColor: string;
  if (agent.status === "completed") {
    glyph = theme.fg("success", "✓");
    nameColor = "success";
  } else if (agent.status === "failed") {
    glyph = theme.fg("warning", "✗");
    nameColor = "warning";
  } else if (agent.status === "lost") {
    glyph = theme.fg("dim", "?");
    nameColor = "dim";
  } else {
    glyph = theme.fg("accent", "●");
    nameColor = "accent";
  }

  lines.push(`${glyph} ${theme.fg(nameColor, truncate(label, contentMax))}`);

  if (agent.status === "running") {
    // pi-subagents' own vocabulary (queued/steered) is more specific than our
    // coarse "running", and worth showing when the registry has it.
    const statusWord = agent.rawStatus && agent.rawStatus !== "running" ? agent.rawStatus : "running";
    lines.push(theme.fg("dim", `  ${statusWord}`));
    lines.push(theme.fg("dim", `  ${truncate(liveStats(agent, now), contentMax)}`));
    return lines;
  }
  if (agent.status === "lost") {
    lines.push(theme.fg("dim", "  lost (no update in 30m)"));
    return lines;
  }

  const verb = agent.status === "completed" ? "complete" : "failed";
  const suffix = agent.completedAt !== undefined ? ` (${formatRelativeTime(now - agent.completedAt)})` : "";
  lines.push(theme.fg("dim", `  ${verb}${suffix}`));

  const stats = finalStats(agent);
  if (stats) lines.push(theme.fg("dim", `  ${truncate(stats, contentMax)}`));

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
