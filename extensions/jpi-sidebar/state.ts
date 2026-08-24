import { SUBAGENT_STALE_MS, type SubagentFinishedPayload, type SubagentStartedPayload } from "./subagents-bus.ts";

const TODO_TOOL_PATTERN = /todo/i;
// pi-tasks tool names (TaskCreate, TaskUpdate, ...) — gates the /todo/i
// fallback so it never double-counts todos pi-tasks already manages via file.
export const TASK_TOOL_PATTERN = /^Task[A-Z]/;
// Heuristic fallback only: exact "task"/"agent", or a "dispatch*" prefix.
// Deliberately narrower than "starts with task" so it can't match pi-tasks's
// TaskCreate/TaskUpdate/etc, which are a different package entirely.
const SUBAGENT_TOOL_EXACT = /^(task|agent)$/i;
const SUBAGENT_TOOL_PREFIX = /^dispatch/i;
const TPS_WINDOW_MS = 2000;
const TITLE_MAX_LENGTH = 60;

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export type SubagentStatus = "running" | "completed" | "failed" | "lost";

export interface SubagentEntry {
  id: string;
  name: string;
  type?: string;
  status: SubagentStatus;
  startedAt: number;
  completedAt?: number;
  toolUses?: number;
  /** Total tokens from the bus's final stats; unset for heuristic entries. */
  tokens?: number;
  durationMs?: number;
}

export interface SidebarSnapshot {
  sessionTitle: string | null;
  modelName: string | null;
  modelProvider: string | null;
  contextTokens: number | null;
  contextPercent: number | null;
  contextWindow: number | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turnCount: number;
  activeTool: { name: string; startedAt: number } | null;
  sessionStartMs: number;
  liveTps: number | null;
  lastTps: number | null;
  lastTurnMs: number | null;
  todos: TodoItem[];
  subagents: SubagentEntry[];
}

interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

interface MessageContentPart {
  type?: string;
  text?: string;
}

interface MessageLike {
  role?: string;
  stopReason?: string;
  usage?: UsageLike;
  content?: string | MessageContentPart[];
}

interface BranchEntryLike {
  type?: string;
  message?: MessageLike;
}

export interface ModelInfo {
  id?: string;
  name?: string;
  provider?: string;
}

export interface ContextUsageInput {
  getContextUsage?(): { tokens?: number | null; contextWindow?: number | null; percent?: number | null } | undefined;
  model?: ModelInfo;
}

export interface SessionStartInput extends ContextUsageInput {
  sessionManager?: {
    getSessionName?(): string | undefined;
    getBranch?(): BranchEntryLike[];
  };
}

export interface BeforeAgentStartInput {
  prompt?: string;
}

export interface MessageEventInput {
  message?: MessageLike;
}

export interface ToolCallInput {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
}

export interface ToolResultInput {
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

export interface ToolExecutionStartInput {
  toolName?: string;
}

export interface ModelSelectInput {
  model?: ModelInfo;
}

function firstText(content: MessageLike["content"]): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (Array.isArray(content)) {
    const part = content.find((candidate) => candidate?.type === "text" && Boolean(candidate.text?.trim()));
    return part?.text?.trim();
  }
  return undefined;
}

function textLength(content: MessageLike["content"]): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce(
      (sum, part) => sum + (part?.type === "text" && typeof part.text === "string" ? part.text.length : 0),
      0,
    );
  }
  return 0;
}

function truncateTitle(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? text.trim();
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 1)}…` : line;
}

export function parseTodos(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null;

  const record = input as Record<string, unknown>;
  const raw = record.todos ?? record.items ?? record.list ?? input;
  if (!Array.isArray(raw)) return null;

  const result: TodoItem[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const content = typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : null;
    if (!content) continue;

    const rawStatus = typeof item.status === "string" ? item.status : "pending";
    const status: TodoStatus =
      rawStatus === "in_progress" || rawStatus === "active"
        ? "in_progress"
        : rawStatus === "completed" || rawStatus === "done"
          ? "completed"
          : "pending";
    const id = typeof item.id === "string" ? item.id : String(result.length);

    result.push({ id, content, status });
  }
  return result;
}

export function extractSubagentName(input: unknown): string {
  if (!input || typeof input !== "object") return "subagent";
  const record = input as Record<string, unknown>;
  const name = record.name ?? record.title ?? record.description ?? record.task;
  if (typeof name !== "string" || !name.trim()) return "subagent";
  return name.split("\n")[0]!.slice(0, TITLE_MAX_LENGTH);
}

function isHeuristicSubagentTool(toolName: string): boolean {
  return SUBAGENT_TOOL_EXACT.test(toolName) || SUBAGENT_TOOL_PREFIX.test(toolName);
}

/**
 * Accumulates sidebar state from official pi extension events, plus (when
 * present) the pi-subagents event bus and pi-tasks's task file. Every
 * mutating method mirrors one event; `snapshot()` is the only way panels
 * read it.
 */
export class SidebarState {
  private readonly now: () => number;

  private title: string | null = null;
  private modelName: string | null = null;
  private modelProvider: string | null = null;
  private contextTokens: number | null = null;
  private contextPercent: number | null = null;
  private contextWindow: number | null = null;
  private tokensIn = 0;
  private tokensOut = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private cost = 0;
  private turnCount = 0;
  private activeTool: { name: string; startedAt: number } | null = null;
  private sessionStartMs: number;
  private agentStartMs: number | null = null;
  private msgStartMs: number | null = null;
  private liveTps: number | null = null;
  private lastTps: number | null = null;
  private lastTurnMs: number | null = null;
  private tpsSamples: { t: number; tokens: number }[] = [];
  private todos: TodoItem[] = [];
  private readonly subagents = new Map<string, SubagentEntry>();
  // Sticky once true: a real subagents:* event proves the precise mechanism
  // works, so the misattribution-prone tool-name heuristic stands down for
  // the rest of the process, not just until the next session resets state.
  private busActive = false;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.sessionStartMs = now();
  }

  onSessionStart(ctx: SessionStartInput): void {
    this.sessionStartMs = this.now();
    this.todos = [];
    this.subagents.clear();
    this.turnCount = 0;
    this.activeTool = null;
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.cacheRead = 0;
    this.cacheWrite = 0;
    this.cost = 0;
    this.title = ctx.sessionManager?.getSessionName?.() ?? null;

    const branch = ctx.sessionManager?.getBranch?.() ?? [];
    let turns = 0;
    for (const entry of branch) {
      if (entry?.type !== "message") continue;
      const message = entry.message;
      if (message?.role === "user") {
        turns += 1;
        if (this.title === null) {
          const text = firstText(message.content);
          if (text) this.title = truncateTitle(text);
        }
        continue;
      }
      if (message?.role !== "assistant") continue;
      if (message.stopReason === "error" || message.stopReason === "aborted") continue;
      const usage = message.usage;
      this.tokensIn += usage?.input ?? 0;
      this.tokensOut += usage?.output ?? 0;
      this.cacheRead += usage?.cacheRead ?? 0;
      this.cacheWrite += usage?.cacheWrite ?? 0;
      this.cost += usage?.cost?.total ?? 0;
    }
    this.turnCount = turns;

    this.applyContextUsage(ctx);
  }

  onSessionShutdown(): void {
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.cacheRead = 0;
    this.cacheWrite = 0;
    this.cost = 0;
    this.turnCount = 0;
    this.activeTool = null;
    this.agentStartMs = null;
    this.msgStartMs = null;
    this.liveTps = null;
    this.lastTps = null;
    this.lastTurnMs = null;
    this.tpsSamples = [];
    this.title = null;
    this.todos = [];
    this.subagents.clear();
  }

  onBeforeAgentStart(event: BeforeAgentStartInput, ctx: ContextUsageInput): void {
    if (this.title === null && typeof event.prompt === "string" && event.prompt.trim()) {
      this.title = truncateTitle(event.prompt);
    }
    this.applyContextUsage(ctx);
  }

  onAgentStart(ctx: ContextUsageInput): void {
    this.agentStartMs = this.now();
    this.msgStartMs = null;
    this.applyContextUsage(ctx);
  }

  onAgentEnd(ctx: ContextUsageInput): void {
    this.applyContextUsage(ctx);
  }

  onTurnEnd(ctx: ContextUsageInput): void {
    this.turnCount += 1;
    this.activeTool = null;
    if (this.agentStartMs !== null) {
      this.lastTurnMs = this.now() - this.agentStartMs;
      this.agentStartMs = null;
    }
    this.applyContextUsage(ctx);
  }

  onModelSelect(event: ModelSelectInput, ctx: ContextUsageInput): void {
    if (event.model?.name) this.modelName = event.model.name;
    else if (event.model?.id) this.modelName = event.model.id;
    if (event.model?.provider) this.modelProvider = event.model.provider;

    this.msgStartMs = null;
    this.liveTps = null;
    this.lastTps = null;
    this.lastTurnMs = null;
    this.tpsSamples = [];
    this.applyContextUsage(ctx);
  }

  onMessageStart(event: MessageEventInput): void {
    if (event.message?.role !== "assistant") return;
    this.msgStartMs = this.now();
    this.liveTps = null;
    this.tpsSamples = [];
  }

  onMessageUpdate(event: MessageEventInput): void {
    if (event.message?.role !== "assistant") return;
    const now = this.now();
    if (this.msgStartMs === null) this.msgStartMs = now;

    const usageOut = event.message.usage?.output ?? 0;
    const tokens = usageOut > 0 ? usageOut : Math.round(textLength(event.message.content) / 4);
    if (tokens <= 0) return;

    this.tpsSamples.push({ t: now, tokens });
    while (this.tpsSamples.length > 1 && now - this.tpsSamples[0]!.t > TPS_WINDOW_MS) {
      this.tpsSamples.shift();
    }

    if (this.tpsSamples.length >= 2) {
      const oldest = this.tpsSamples[0]!;
      const elapsedMs = now - oldest.t;
      const deltaTokens = tokens - oldest.tokens;
      if (elapsedMs > 0 && deltaTokens > 0) {
        this.liveTps = Math.round(deltaTokens / (elapsedMs / 1000));
      }
    }
  }

  onMessageEnd(event: MessageEventInput): void {
    const message = event.message;
    if (message?.role !== "assistant") return;
    if (message.stopReason === "error" || message.stopReason === "aborted") return;

    const usage = message.usage;
    this.tokensIn += usage?.input ?? 0;
    this.tokensOut += usage?.output ?? 0;
    this.cacheRead += usage?.cacheRead ?? 0;
    this.cacheWrite += usage?.cacheWrite ?? 0;
    this.cost += usage?.cost?.total ?? 0;

    const out = usage?.output ?? 0;
    const elapsed = this.msgStartMs !== null ? this.now() - this.msgStartMs : null;
    if (elapsed !== null && elapsed > 50 && out > 0) {
      this.lastTps = Math.round(out / (elapsed / 1000));
    }
    this.liveTps = null;
    this.msgStartMs = null;
  }

  /** Vanilla todo tools only — pi-tasks tools reload from its own file instead (see tasks.ts). */
  onToolCall(event: ToolCallInput): void {
    const toolName = event.toolName ?? "";
    const toolCallId = event.toolCallId ?? toolName;

    if (!TASK_TOOL_PATTERN.test(toolName) && TODO_TOOL_PATTERN.test(toolName)) {
      const parsed = parseTodos(event.input);
      if (parsed !== null) this.todos = parsed;
      return;
    }

    if (!this.busActive && isHeuristicSubagentTool(toolName)) {
      this.subagents.set(toolCallId, {
        id: toolCallId,
        name: extractSubagentName(event.input),
        status: "running",
        startedAt: this.now(),
      });
    }
  }

  /** Closes a heuristic-created entry by toolCallId. Bus entries close via onSubagentFinished instead. */
  onToolResult(event: ToolResultInput): void {
    const toolCallId = event.toolCallId ?? event.toolName ?? "";
    const active = this.subagents.get(toolCallId);
    if (!active) return;

    active.status = event.isError ? "failed" : "completed";
    active.completedAt = this.now();
  }

  onToolExecutionStart(event: ToolExecutionStartInput): void {
    this.activeTool = { name: event.toolName ?? "", startedAt: this.now() };
  }

  onToolExecutionEnd(): void {
    this.activeTool = null;
  }

  /** Any subagents:* bus event, including the payload-less `ready` signal. */
  markSubagentBusActive(): void {
    this.busActive = true;
  }

  onSubagentStarted(payload: SubagentStartedPayload): void {
    this.busActive = true;
    this.subagents.set(payload.id, {
      id: payload.id,
      name: payload.description ?? payload.id,
      type: payload.type,
      status: "running",
      startedAt: this.now(),
    });
  }

  onSubagentFinished(payload: SubagentFinishedPayload, status: "completed" | "failed"): void {
    this.busActive = true;
    const existing = this.subagents.get(payload.id);
    this.subagents.set(payload.id, {
      id: payload.id,
      name: payload.description ?? existing?.name ?? payload.id,
      type: payload.type ?? existing?.type,
      status,
      startedAt: existing?.startedAt ?? this.now(),
      completedAt: this.now(),
      toolUses: payload.toolUses,
      tokens: payload.tokens?.total,
      durationMs: payload.durationMs,
    });
  }

  /** Wholesale replacement from a pi-tasks file reload; see tasks.ts. */
  setTodos(todos: TodoItem[]): void {
    this.todos = todos;
  }

  private applyContextUsage(ctx: ContextUsageInput): void {
    const usage = ctx.getContextUsage?.();
    if (usage) {
      this.contextTokens = typeof usage.tokens === "number" ? usage.tokens : null;
      this.contextPercent = typeof usage.percent === "number" ? usage.percent : null;
      this.contextWindow = typeof usage.contextWindow === "number" ? usage.contextWindow : null;
    }
    const model = ctx.model;
    if (model?.name) this.modelName = model.name;
    else if (model?.id) this.modelName = model.id;
    if (model?.provider) this.modelProvider = model.provider;
  }

  snapshot(): SidebarSnapshot {
    const now = this.now();
    // Staleness is derived at read time rather than timer-driven, so a
    // sidebar that isn't being painted doesn't need a live timer at all.
    const subagents = [...this.subagents.values()].map((entry) =>
      entry.status === "running" && now - entry.startedAt > SUBAGENT_STALE_MS
        ? { ...entry, status: "lost" as const }
        : entry,
    );

    return {
      sessionTitle: this.title,
      modelName: this.modelName,
      modelProvider: this.modelProvider,
      contextTokens: this.contextTokens,
      contextPercent: this.contextPercent,
      contextWindow: this.contextWindow,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      cacheRead: this.cacheRead,
      cacheWrite: this.cacheWrite,
      cost: this.cost,
      turnCount: this.turnCount,
      activeTool: this.activeTool,
      sessionStartMs: this.sessionStartMs,
      liveTps: this.liveTps,
      lastTps: this.lastTps,
      lastTurnMs: this.lastTurnMs,
      todos: [...this.todos],
      subagents,
    };
  }
}
