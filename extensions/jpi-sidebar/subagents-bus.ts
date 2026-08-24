// Channel names and payload shapes from @tintinweb/pi-subagents (pi.events).
// Mirrors jpi-planter's protocol.ts: parse defensively, trust nothing.

export const SUBAGENT_READY_CHANNEL = "subagents:ready";
export const SUBAGENT_STARTED_CHANNEL = "subagents:started";
export const SUBAGENT_COMPLETED_CHANNEL = "subagents:completed";
export const SUBAGENT_FAILED_CHANNEL = "subagents:failed";

// Matches jpi-planter's staleness window for the same package, same reason.
export const SUBAGENT_STALE_MS = 30 * 60 * 1_000;

export interface SubagentStartedPayload {
  id: string;
  type?: string;
  description?: string;
}

export interface SubagentTokens {
  input: number;
  output: number;
  total: number;
}

export interface SubagentFinishedPayload {
  id: string;
  type?: string;
  description?: string;
  toolUses?: number;
  durationMs?: number;
  tokens?: SubagentTokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseTokens(value: unknown): SubagentTokens | undefined {
  if (!isRecord(value)) return undefined;
  const input = optionalNumber(value.input);
  const output = optionalNumber(value.output);
  const total = optionalNumber(value.total);
  if (input === undefined || output === undefined || total === undefined) return undefined;
  return { input, output, total };
}

export function parseSubagentStarted(data: unknown): SubagentStartedPayload | undefined {
  if (!isRecord(data)) return undefined;
  const id = optionalString(data.id);
  if (!id) return undefined;
  return { id, type: optionalString(data.type), description: optionalString(data.description) };
}

export function parseSubagentFinished(data: unknown): SubagentFinishedPayload | undefined {
  if (!isRecord(data)) return undefined;
  const id = optionalString(data.id);
  if (!id) return undefined;
  return {
    id,
    type: optionalString(data.type),
    description: optionalString(data.description),
    toolUses: optionalNumber(data.toolUses),
    durationMs: optionalNumber(data.durationMs),
    tokens: parseTokens(data.tokens),
  };
}
