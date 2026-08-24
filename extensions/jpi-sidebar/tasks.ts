import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getAgentDirectory } from "jpi-base";

import type { TodoItem, TodoStatus } from "./state.ts";

interface RawTask {
  id?: unknown;
  subject?: unknown;
  description?: unknown;
  activeForm?: unknown;
  status?: unknown;
}

// Mirrors @tintinweb/pi-tasks's task-paths.ts projectKey(), so a session-global
// file resolves to the same path pi-tasks itself wrote it to.
function projectKey(cwd: string): string {
  return `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function candidatePaths(cwd: string, sessionId: string, env?: NodeJS.ProcessEnv, homeDirectory?: string): string[] {
  const agentDirectory = getAgentDirectory(env, homeDirectory);
  return [
    join(cwd, ".pi", "tasks", `tasks-${sessionId}.json`),
    join(agentDirectory, "tasks", "sessions", projectKey(cwd), `tasks-${sessionId}.json`),
    join(cwd, ".pi", "tasks", "tasks.json"),
  ];
}

async function newestExisting(paths: string[]): Promise<string | undefined> {
  const stats = await Promise.all(
    paths.map(async (path) => {
      try {
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );
  const existing = stats.filter((entry): entry is { path: string; mtimeMs: number } => entry !== undefined);
  if (existing.length === 0) return undefined;
  return existing.reduce((newest, entry) => (entry.mtimeMs > newest.mtimeMs ? entry : newest)).path;
}

function normalizeStatus(status: unknown): TodoStatus {
  return status === "in_progress" || status === "completed" ? status : "pending";
}

function toTodoItem(raw: RawTask, index: number): TodoItem | undefined {
  const content =
    (typeof raw.subject === "string" && raw.subject) ||
    (typeof raw.activeForm === "string" && raw.activeForm) ||
    (typeof raw.description === "string" && raw.description) ||
    undefined;
  if (!content) return undefined;
  const id = typeof raw.id === "string" && raw.id ? raw.id : String(index);
  return { id, content, status: normalizeStatus(raw.status) };
}

/**
 * Reloads the todo list from a pi-tasks store file. Returns `undefined` (keep
 * the previous list) when no candidate file exists, or it can't be read or
 * parsed — pi-tasks itself treats a bad file the same way.
 */
export async function loadTaskTodos(
  cwd: string,
  sessionId: string,
  env?: NodeJS.ProcessEnv,
  homeDirectory?: string,
): Promise<TodoItem[] | undefined> {
  const path = await newestExisting(candidatePaths(cwd, sessionId, env, homeDirectory));
  if (!path) return undefined;

  try {
    const text = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return undefined;
    const tasks = (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return undefined;

    const items: TodoItem[] = [];
    tasks.forEach((task, index) => {
      if (!task || typeof task !== "object") return;
      const item = toTodoItem(task as RawTask, index);
      if (item) items.push(item);
    });
    return items;
  } catch {
    return undefined;
  }
}
