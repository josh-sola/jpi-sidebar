import { formatCount, formatDuration, truncate } from "../format.ts";
import type { SidebarSnapshot } from "../state.ts";
import type { ThemeLike } from "../theme.ts";

const NOT_AVAILABLE = "—";

export function renderSessionPanel(
  state: SidebarSnapshot,
  width: number,
  theme: ThemeLike,
  now: number = Date.now(),
): string[] {
  const lines: string[] = [];

  const titleText = state.sessionTitle
    ? truncate(state.sessionTitle, Math.max(0, width - 2))
    : "(untitled session)";
  lines.push(theme.fg("dim", `  ${titleText}`));

  if (state.activeTool) {
    const elapsed = now - state.activeTool.startedAt;
    const toolName = truncate(state.activeTool.name, Math.max(0, width - 14));
    lines.push(
      theme.fg("dim", "  tool  ") + theme.fg("accent", toolName) + theme.fg("dim", ` (${formatDuration(elapsed)})`),
    );
  }

  const modelText = state.modelName ? truncate(state.modelName, Math.max(0, width - 9)) : NOT_AVAILABLE;
  lines.push(theme.fg("dim", "  model ") + theme.fg(state.modelName ? "accent" : "muted", modelText));

  if (state.contextPercent !== null) {
    const percent = Math.round(state.contextPercent);
    const tokens = state.contextTokens !== null ? formatCount(state.contextTokens) : "?";
    const windowSize = state.contextWindow !== null ? formatCount(state.contextWindow) : "?";
    const color = percent > 90 ? "warning" : percent > 70 ? "accent" : "text";
    lines.push(
      theme.fg("dim", "  ctx   ") + theme.fg(color, `${tokens} / ${windowSize}`) + theme.fg("dim", ` (${percent}%)`),
    );
  } else {
    lines.push(theme.fg("dim", "  ctx   ") + theme.fg("muted", NOT_AVAILABLE));
  }

  const elapsedSession = now - state.sessionStartMs;
  const tps = state.liveTps ?? state.lastTps;
  const tokenTotal = state.tokensIn + state.tokensOut + state.cacheRead + state.cacheWrite;

  const stats: Array<[string, string]> = [
    ["time", elapsedSession >= 1000 ? formatDuration(elapsedSession) : NOT_AVAILABLE],
    ["turns", state.turnCount > 0 ? String(state.turnCount) : NOT_AVAILABLE],
    ["speed", tps !== null ? `${tps} tok/s` : NOT_AVAILABLE],
    ["cost", state.cost > 0 ? `$${state.cost.toFixed(3)}` : NOT_AVAILABLE],
    ["in", state.tokensIn > 0 ? formatCount(state.tokensIn) : NOT_AVAILABLE],
    ["out", state.tokensOut > 0 ? formatCount(state.tokensOut) : NOT_AVAILABLE],
    ["total", tokenTotal > 0 ? formatCount(tokenTotal) : NOT_AVAILABLE],
  ];

  for (const [label, value] of stats) {
    lines.push(theme.fg("dim", `  ${label.padEnd(6)} `) + theme.fg("muted", value));
  }

  return lines;
}
