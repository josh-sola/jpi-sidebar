import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vite-plus/test";

import { projectSlug } from "jpi-base";

import { loadTaskTodos } from "../extensions/jpi-sidebar/tasks.ts";

async function tempCwd() {
  return mkdtemp(join(tmpdir(), "jpi-sidebar-tasks-cwd-"));
}

async function tempAgentEnv() {
  const directory = await mkdtemp(join(tmpdir(), "jpi-sidebar-tasks-agent-"));
  return { PI_CODING_AGENT_DIR: directory };
}

async function taskDir(agentDirectory: string, cwd: string) {
  const dir = join(agentDirectory, "jpi", "tasks", projectSlug(cwd));
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeSessionTasks(
  agentDirectory: string,
  cwd: string,
  sessionId: string,
  data: unknown,
) {
  const dir = await taskDir(agentDirectory, cwd);
  const sanitizedSessionId = sessionId.replace(/[^A-Za-z0-9._-]/g, "-");
  await writeFile(join(dir, `session-${sanitizedSessionId}.json`), JSON.stringify(data), "utf8");
}

async function writeProjectTasks(agentDirectory: string, cwd: string, data: unknown) {
  const dir = await taskDir(agentDirectory, cwd);
  await writeFile(join(dir, "project.json"), JSON.stringify(data), "utf8");
}

test("maps subject and status from the session task file, preserving order", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  await writeSessionTasks(env.PI_CODING_AGENT_DIR, cwd, "sess-1", {
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
  await writeSessionTasks(env.PI_CODING_AGENT_DIR, cwd, "sess-1", {
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
  const dir = await taskDir(env.PI_CODING_AGENT_DIR, cwd);
  await writeFile(join(dir, "session-sess-1.json"), "{not valid json", "utf8");

  const todos = await loadTaskTodos(cwd, "sess-1", env);
  assert.equal(todos, undefined);
});

test("falls back to the project file when no session-scoped file exists", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  await writeProjectTasks(env.PI_CODING_AGENT_DIR, cwd, {
    nextId: 2,
    tasks: [{ id: "1", subject: "Shared board task", status: "completed" }],
  });

  const todos = await loadTaskTodos(cwd, "sess-1", env);
  assert.deepEqual(todos, [{ id: "1", content: "Shared board task", status: "completed" }]);
});

test("prefers the session file over the project file when the session file is newer", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  await writeProjectTasks(env.PI_CODING_AGENT_DIR, cwd, {
    nextId: 2,
    tasks: [{ id: "1", subject: "Project task", status: "pending" }],
  });
  await writeSessionTasks(env.PI_CODING_AGENT_DIR, cwd, "sess-1", {
    nextId: 2,
    tasks: [{ id: "1", subject: "Session task", status: "in_progress" }],
  });

  const todos = await loadTaskTodos(cwd, "sess-1", env);
  assert.deepEqual(todos, [{ id: "1", content: "Session task", status: "in_progress" }]);
});

test("sanitizes an unsafe session id before building the session path", async () => {
  const cwd = await tempCwd();
  const env = await tempAgentEnv();
  const sessionId = "sess/weird:id 1";
  await writeSessionTasks(env.PI_CODING_AGENT_DIR, cwd, sessionId, {
    nextId: 2,
    tasks: [{ id: "1", subject: "Sanitized session task", status: "pending" }],
  });

  const todos = await loadTaskTodos(cwd, sessionId, env);
  assert.deepEqual(todos, [{ id: "1", content: "Sanitized session task", status: "pending" }]);
});
