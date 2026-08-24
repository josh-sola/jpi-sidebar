import assert from "node:assert/strict";
import test from "node:test";

import { extractSubagentName, parseTodos, SidebarState } from "../extensions/jpi-sidebar/state.ts";

function makeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
      return current;
    },
  };
}

function usage(input: number, output: number, extra: Partial<{ cacheRead: number; cacheWrite: number; cost: number }> = {}) {
  return {
    input,
    output,
    cacheRead: extra.cacheRead ?? 0,
    cacheWrite: extra.cacheWrite ?? 0,
    cost: { total: extra.cost ?? 0 },
  };
}

test("a fresh session has empty totals and no title", () => {
  const state = new SidebarState(makeClock().now);
  state.onSessionStart({});
  const snapshot = state.snapshot();
  assert.equal(snapshot.sessionTitle, null);
  assert.equal(snapshot.tokensIn, 0);
  assert.equal(snapshot.turnCount, 0);
  assert.deepEqual(snapshot.todos, []);
  assert.deepEqual(snapshot.subagents, []);
});

test("session_start seeds totals and title from a resumed branch, skipping error and aborted messages", () => {
  const clock = makeClock();
  const state = new SidebarState(clock.now);

  state.onSessionStart({
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "user", content: "  Fix the flaky test\nmore detail" } },
        { type: "message", message: { role: "assistant", usage: usage(10, 20, { cost: 0.01 }) } },
        { type: "message", message: { role: "user", content: "second prompt" } },
        { type: "message", message: { role: "assistant", stopReason: "error", usage: usage(100, 100) } },
        { type: "message", message: { role: "assistant", stopReason: "aborted", usage: usage(100, 100) } },
        { type: "message", message: { role: "assistant", usage: usage(5, 15, { cacheRead: 3, cacheWrite: 2, cost: 0.02 }) } },
        { type: "thinking_level_change" },
      ],
    },
  });

  const snapshot = state.snapshot();
  assert.equal(snapshot.sessionTitle, "Fix the flaky test");
  assert.equal(snapshot.turnCount, 2);
  assert.equal(snapshot.tokensIn, 15);
  assert.equal(snapshot.tokensOut, 35);
  assert.equal(snapshot.cacheRead, 3);
  assert.equal(snapshot.cacheWrite, 2);
  assert.equal(snapshot.cost, 0.03);
});

test("before_agent_start only sets the title when one is not already known", () => {
  const state = new SidebarState();
  state.onSessionStart({});
  state.onBeforeAgentStart({ prompt: "first prompt here" }, {});
  assert.equal(state.snapshot().sessionTitle, "first prompt here");

  state.onBeforeAgentStart({ prompt: "second prompt" }, {});
  assert.equal(state.snapshot().sessionTitle, "first prompt here");
});

test("applyContextUsage updates model and context fields from ctx", () => {
  const state = new SidebarState();
  state.onSessionStart({
    model: { name: "Sonnet 5", provider: "anthropic" },
    getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000, percent: 0.5 }),
  });
  const snapshot = state.snapshot();
  assert.equal(snapshot.modelName, "Sonnet 5");
  assert.equal(snapshot.modelProvider, "anthropic");
  assert.equal(snapshot.contextTokens, 1000);
  assert.equal(snapshot.contextWindow, 200_000);
  assert.equal(snapshot.contextPercent, 0.5);
});

test("model_select falls back to id when name is absent and resets speed stats", () => {
  const state = new SidebarState();
  state.onSessionStart({});
  state.onModelSelect({ model: { id: "gpt-5.6" } }, {});
  assert.equal(state.snapshot().modelName, "gpt-5.6");
});

test("todo tool calls replace the todo list on valid shapes and are ignored on invalid ones", () => {
  const state = new SidebarState();
  state.onSessionStart({});

  state.onToolCall({ toolName: "todo_write", input: { todos: [{ content: "write tests", status: "in_progress" }] } });
  assert.deepEqual(state.snapshot().todos, [{ id: "0", content: "write tests", status: "in_progress" }]);

  state.onToolCall({ toolName: "todo_write", input: "not an object" });
  assert.deepEqual(state.snapshot().todos, [{ id: "0", content: "write tests", status: "in_progress" }]);
});

test("subagent tool calls open an entry, log activity while active, and close on tool_result", () => {
  const clock = makeClock();
  const state = new SidebarState(clock.now);
  state.onSessionStart({});

  state.onToolCall({ toolName: "task", toolCallId: "call-1", input: { description: "Refactor the parser\nmore" } });
  let snapshot = state.snapshot();
  assert.equal(snapshot.subagents.length, 1);
  assert.equal(snapshot.subagents[0]!.name, "Refactor the parser");
  assert.equal(snapshot.subagents[0]!.status, "running");

  clock.advance(10);
  state.onToolCall({ toolName: "bash", toolCallId: "call-2", input: { command: "ls" } });
  snapshot = state.snapshot();
  assert.equal(snapshot.subagents[0]!.toolCount, 1);
  assert.equal(snapshot.subagents[0]!.toolLog.length, 1);
  assert.match(snapshot.subagents[0]!.toolLog[0]!, /^bash: /);

  state.onToolResult({ toolCallId: "call-1", isError: false });
  snapshot = state.snapshot();
  assert.equal(snapshot.subagents[0]!.status, "completed");
  assert.equal(typeof snapshot.subagents[0]!.completedAt, "number");

  // Tool calls after completion are no longer attributed to the closed subagent.
  state.onToolCall({ toolName: "bash", toolCallId: "call-3", input: {} });
  assert.equal(state.snapshot().subagents[0]!.toolCount, 1);
});

test("a failed subagent tool_result is marked failed", () => {
  const state = new SidebarState();
  state.onSessionStart({});
  state.onToolCall({ toolName: "dispatch_agent", toolCallId: "call-1", input: { name: "Investigate bug" } });
  state.onToolResult({ toolCallId: "call-1", isError: true });
  assert.equal(state.snapshot().subagents[0]!.status, "failed");
});

test("active tool tracking starts and clears with execution events", () => {
  const clock = makeClock();
  const state = new SidebarState(clock.now);
  state.onSessionStart({});
  state.onToolExecutionStart({ toolName: "bash" });
  assert.deepEqual(state.snapshot().activeTool, { name: "bash", startedAt: 0 });
  state.onToolExecutionEnd();
  assert.equal(state.snapshot().activeTool, null);
});

test("message_end accumulates usage and skips error/aborted messages", () => {
  const state = new SidebarState();
  state.onSessionStart({});

  state.onMessageEnd({ message: { role: "assistant", usage: usage(10, 20, { cost: 0.05 }) } });
  state.onMessageEnd({ message: { role: "assistant", stopReason: "error", usage: usage(999, 999) } });
  state.onMessageEnd({ message: { role: "user" } });

  const snapshot = state.snapshot();
  assert.equal(snapshot.tokensIn, 10);
  assert.equal(snapshot.tokensOut, 20);
  assert.equal(snapshot.cost, 0.05);
});

test("live tokens-per-second is computed from a 2s sliding window during streaming", () => {
  const clock = makeClock();
  const state = new SidebarState(clock.now);
  state.onSessionStart({});

  state.onMessageStart({ message: { role: "assistant" } });
  state.onMessageUpdate({ message: { role: "assistant", usage: { output: 10 } } });
  assert.equal(state.snapshot().liveTps, null); // only one sample so far

  clock.advance(1000);
  state.onMessageUpdate({ message: { role: "assistant", usage: { output: 30 } } });
  assert.equal(state.snapshot().liveTps, 20); // (30-10) tokens over 1s
});

test("message_end sets last turns-per-second and clears the live one", () => {
  const clock = makeClock();
  const state = new SidebarState(clock.now);
  state.onSessionStart({});

  state.onMessageStart({ message: { role: "assistant" } });
  clock.advance(500);
  state.onMessageEnd({ message: { role: "assistant", usage: usage(0, 100) } });

  const snapshot = state.snapshot();
  assert.equal(snapshot.liveTps, null);
  assert.equal(snapshot.lastTps, 200);
});

test("turn_end tracks the elapsed time since agent_start and clears the active tool", () => {
  const clock = makeClock();
  const state = new SidebarState(clock.now);
  state.onSessionStart({});
  state.onAgentStart({});
  state.onToolExecutionStart({ toolName: "bash" });
  clock.advance(250);
  state.onTurnEnd({});

  const snapshot = state.snapshot();
  assert.equal(snapshot.lastTurnMs, 250);
  assert.equal(snapshot.turnCount, 1);
  assert.equal(snapshot.activeTool, null);
});

test("session_shutdown resets all mutable state back to empty", () => {
  const state = new SidebarState();
  state.onSessionStart({});
  state.onToolCall({ toolName: "task", toolCallId: "1", input: {} });
  state.onMessageEnd({ message: { role: "assistant", usage: usage(1, 1) } });
  state.onSessionShutdown();

  const snapshot = state.snapshot();
  assert.equal(snapshot.sessionTitle, null);
  assert.equal(snapshot.tokensIn, 0);
  assert.deepEqual(snapshot.subagents, []);
});

test("parseTodos accepts content or text fields, normalizes status, and falls back to an index id", () => {
  assert.deepEqual(parseTodos({ todos: [{ content: "a" }, { text: "b", status: "done" }] }), [
    { id: "0", content: "a", status: "pending" },
    { id: "1", content: "b", status: "completed" },
  ]);
  assert.deepEqual(parseTodos({ items: [{ id: "x", content: "c", status: "active" }] }), [
    { id: "x", content: "c", status: "in_progress" },
  ]);
  assert.deepEqual(parseTodos([{ content: "bare array" }]), [{ id: "0", content: "bare array", status: "pending" }]);
});

test("parseTodos returns null for shapes it cannot recognize", () => {
  assert.equal(parseTodos("nope"), null);
  assert.equal(parseTodos(null), null);
  assert.equal(parseTodos({ unrelated: true }), null);
});

test("extractSubagentName prefers name/title/description/task and falls back to a generic label", () => {
  assert.equal(extractSubagentName({ name: "Named task" }), "Named task");
  assert.equal(extractSubagentName({ description: "Multi\nline" }), "Multi");
  assert.equal(extractSubagentName({}), "subagent");
  assert.equal(extractSubagentName("nope"), "subagent");
});
