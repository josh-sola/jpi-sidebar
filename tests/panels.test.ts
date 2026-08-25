import assert from "node:assert/strict";
import { test } from "vite-plus/test";

import { renderSessionPanel } from "../extensions/jpi-sidebar/panels/session.ts";
import { renderSubagentsPanel } from "../extensions/jpi-sidebar/panels/subagents.ts";
import { renderTodosPanel } from "../extensions/jpi-sidebar/panels/todos.ts";
import { renderSidebar } from "../extensions/jpi-sidebar/sidebar.ts";
import type { SidebarSnapshot, SubagentEntry, TodoItem } from "../extensions/jpi-sidebar/state.ts";
import type { ThemeLike } from "../extensions/jpi-sidebar/theme.ts";

const theme: ThemeLike = {
  fg: (_color, text) => text,
  bold: (text) => `**${text}**`,
};

function baseSnapshot(overrides: Partial<SidebarSnapshot> = {}): SidebarSnapshot {
  return {
    sessionTitle: null,
    modelName: null,
    modelProvider: null,
    contextTokens: null,
    contextPercent: null,
    contextWindow: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turnCount: 0,
    activeTool: null,
    sessionStartMs: 0,
    liveTps: null,
    lastTps: null,
    lastTurnMs: null,
    todos: [],
    subagents: [],
    ...overrides,
  };
}

test("session panel shows a placeholder title and N/A fields when nothing is known", () => {
  const lines = renderSessionPanel(baseSnapshot(), 40, theme, 0);
  assert.match(lines[0]!, /\(untitled session\)/);
  assert.ok(lines.some((line) => line.includes("model") && line.includes("—")));
  assert.ok(lines.some((line) => line.includes("ctx") && line.includes("—")));
});

test("session panel shows the active tool with elapsed time", () => {
  const snapshot = baseSnapshot({ activeTool: { name: "bash", startedAt: 0 } });
  const lines = renderSessionPanel(snapshot, 40, theme, 3000);
  assert.ok(lines.some((line) => line.includes("bash") && line.includes("3s")));
});

test("session panel renders context usage and cumulative stats when known", () => {
  const snapshot = baseSnapshot({
    modelName: "Sonnet 5",
    contextTokens: 50_000,
    contextWindow: 200_000,
    contextPercent: 25,
    tokensIn: 1200,
    tokensOut: 800,
    turnCount: 3,
    cost: 0.125,
  });
  const lines = renderSessionPanel(snapshot, 40, theme, 0).join("\n");
  assert.match(lines, /Sonnet 5/);
  assert.match(lines, /50k \/ 200k \(25%\)/);
  assert.match(lines, /\$0\.125/);
  assert.match(lines, /\b3\b/);
});

test("session panel truncates a long title to fit the given width", () => {
  const longTitle = "x".repeat(200);
  const lines = renderSessionPanel(baseSnapshot({ sessionTitle: longTitle }), 20, theme, 0);
  assert.ok(lines[0]!.length <= 20);
  assert.match(lines[0]!, /…$/);
});

test("todos panel reports an empty state and renders each status glyph", () => {
  assert.deepEqual(renderTodosPanel(baseSnapshot(), 40, theme), ["  (no todos)"]);

  const todos: TodoItem[] = [
    { id: "1", content: "done thing", status: "completed" },
    { id: "2", content: "in flight", status: "in_progress" },
    { id: "3", content: "queued", status: "pending" },
  ];
  const lines = renderTodosPanel(baseSnapshot({ todos }), 40, theme);
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^✓ done thing$/);
  assert.match(lines[1]!, /^● in flight$/);
  assert.match(lines[2]!, /^○ queued$/);
});

test("todos panel returns no lines when every todo is completed", () => {
  const todos: TodoItem[] = [
    { id: "1", content: "done thing", status: "completed" },
    { id: "2", content: "also done", status: "completed" },
  ];
  assert.deepEqual(renderTodosPanel(baseSnapshot({ todos }), 40, theme), []);
});

test("todos panel truncates long content to fit the given width", () => {
  const todos: TodoItem[] = [{ id: "1", content: "y".repeat(100), status: "pending" }];
  const lines = renderTodosPanel(baseSnapshot({ todos }), 10, theme);
  assert.ok(lines[0]!.length <= 10);
});

function agent(overrides: Partial<SubagentEntry> = {}): SubagentEntry {
  return {
    id: "1",
    name: "Investigate bug",
    status: "running",
    startedAt: 0,
    ...overrides,
  };
}

test("subagents panel reports an empty state", () => {
  assert.deepEqual(renderSubagentsPanel(baseSnapshot(), 40, theme, 0), ["  (no subagents)"]);
});

test("subagents panel renders running, completed, failed, and lost blocks distinctly", () => {
  const running = renderSubagentsPanel(
    baseSnapshot({ subagents: [agent({ status: "running" })] }),
    40,
    theme,
    5000,
  ).join("\n");
  assert.match(running, /●.*Investigate bug/);
  assert.match(running, /running/);
  assert.match(running, /5s/);

  const completed = renderSubagentsPanel(
    baseSnapshot({
      subagents: [
        agent({
          status: "completed",
          completedAt: 4000,
          toolUses: 3,
          tokens: 1500,
          durationMs: 4000,
        }),
      ],
    }),
    40,
    theme,
    5000,
  ).join("\n");
  assert.match(completed, /✓.*Investigate bug/);
  assert.match(completed, /complete \(1s ago\)/);
  assert.match(completed, /3 tools · 2k tokens · 4s/);

  const failed = renderSubagentsPanel(
    baseSnapshot({ subagents: [agent({ status: "failed", completedAt: 5000 })] }),
    40,
    theme,
    5000,
  ).join("\n");
  assert.match(failed, /✗.*Investigate bug/);
  assert.match(failed, /failed \(0s ago\)/);

  const lost = renderSubagentsPanel(
    baseSnapshot({ subagents: [agent({ status: "lost" })] }),
    40,
    theme,
    5000,
  ).join("\n");
  assert.match(lost, /Investigate bug/);
  assert.match(lost, /lost/);
});

test("subagents panel shows a queued/steered raw status word and a live stats line with only present fields", () => {
  const queued = renderSubagentsPanel(
    baseSnapshot({ subagents: [agent({ status: "running", rawStatus: "queued" })] }),
    40,
    theme,
    5000,
  ).join("\n");
  assert.match(queued, /queued/);
  assert.doesNotMatch(queued, /\brunning\b/);

  const live = renderSubagentsPanel(
    baseSnapshot({
      subagents: [
        agent({ status: "running", rawStatus: "running", toolUses: 2, tokens: 1500, cost: 0.4567 }),
      ],
    }),
    40,
    theme,
    5000,
  ).join("\n");
  assert.match(live, /2 tools · 2k tokens · \$0\.46 · 5s/);

  const minimal = renderSubagentsPanel(
    baseSnapshot({ subagents: [agent({ status: "running" })] }),
    40,
    theme,
    5000,
  ).join("\n");
  assert.doesNotMatch(minimal, /tools|tokens|\$/);
  assert.match(minimal, /5s/);
});

test("subagents panel shows the type next to the name, and blank-separates multiple agents", () => {
  const typed = agent({ type: "explorer" });
  const other = agent({ id: "2", name: "Second" });
  const lines = renderSubagentsPanel(baseSnapshot({ subagents: [typed, other] }), 40, theme, 0);

  assert.match(lines[0]!, /Investigate bug \(explorer\)/);
  assert.ok(lines.includes(""));
});

test("renderSidebar composes panels with headers, separators, and blank-line spacing", () => {
  const snapshot = baseSnapshot({
    sessionTitle: "Working on the sidebar",
    todos: [{ id: "1", content: "one", status: "pending" }],
  });
  const lines = renderSidebar(snapshot, 30, theme);

  assert.equal(lines[0], "** Session**");
  assert.equal(lines[1], "─".repeat(30));
  assert.ok(lines.some((line) => line === "** Todos (0/1)**"));
  assert.ok(lines.some((line) => line === "** Subagents (0/0)**"));
  assert.ok(lines.includes(""));
  assert.ok(lines.every((line) => line.length <= 30));
});

test("renderSidebar omits the Todos header when every todo is completed", () => {
  const snapshot = baseSnapshot({
    sessionTitle: "Working on the sidebar",
    todos: [{ id: "1", content: "one", status: "completed" }],
  });
  const lines = renderSidebar(snapshot, 30, theme);

  assert.ok(lines.every((line) => !line.includes("Todos")));
});
