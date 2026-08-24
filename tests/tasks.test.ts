import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadTaskTodos } from "../extensions/jpi-sidebar/tasks.ts";

async function tempCwd() {
  return mkdtemp(join(tmpdir(), "jpi-sidebar-tasks-cwd-"));
}

async function tempAgentEnv() {
  const directory = await mkdtemp(join(tmpdir(), "jpi-sidebar-tasks-agent-"));
  return { PI_CODING_AGENT_DIR: directory };
}

async function writeSessionTasks(cwd: string, sessionId: string, data: unknown) {
  const dir = join(cwd, ".pi", "tasks");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `tasks-${sessionId}.json`), JSON.stringify(data), "utf8");
}

test("maps subject and status from the workspace-session task file, preserving order", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  await writeSessionTasks(cwd, "sess-1", {
    nextId: 3,
    tasks: [
      { id: "1", subject: "Write tests", status: "in_progress" },
      { id: "2", subject: "Ship it", status: "pending" },
    ],
  });

  const todos = await loadTaskTodos(cwd, "sess-1", env);
  assert.deepEqual(todos, [
    { id: "1", content: "Write tests", status: "in_progress" },
    { id: "2", content: "Ship it", status: "pending" },
  ]);
});

test("falls back to activeForm then description when subject is missing", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  await writeSessionTasks(cwd, "sess-1", {
    nextId: 3,
    tasks: [
      { id: "1", activeForm: "Writing tests", status: "pending" },
      { id: "2", description: "Only a description" },
    ],
  });

  const todos = await loadTaskTodos(cwd, "sess-1", env);
  assert.deepEqual(todos, [
    { id: "1", content: "Writing tests", status: "pending" },
    { id: "2", content: "Only a description", status: "pending" },
  ]);
});

test("returns undefined (keep the previous list) when no candidate file exists", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  assert.equal(await loadTaskTodos(cwd, "no-such-session", env), undefined);
});

test("survives a corrupt task file by returning undefined instead of throwing", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  const dir = join(cwd, ".pi", "tasks");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tasks-sess-1.json"), "{not valid json", "utf8");

  const todos = await loadTaskTodos(cwd, "sess-1", env);
  assert.equal(todos, undefined);
});

test("falls back to the shared workspace board when no session-scoped file exists", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  const dir = join(cwd, ".pi", "tasks");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "tasks.json"),
    JSON.stringify({ nextId: 2, tasks: [{ id: "1", subject: "Shared board task", status: "completed" }] }),
    "utf8",
  );

  const todos = await loadTaskTodos(cwd, "sess-1", env);
  assert.deepEqual(todos, [{ id: "1", content: "Shared board task", status: "completed" }]);
});
