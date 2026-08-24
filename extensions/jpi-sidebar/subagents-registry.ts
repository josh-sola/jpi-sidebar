// Cross-extension registry published by @tintinweb/pi-subagents at
// globalThis[Symbol.for("pi-subagents:manager")]. There is no change
// notification for the fields we read, so callers must poll; this module
// only ever calls getRecord/hasRunning on it, never spawn/waitForAll.

const MANAGER_KEY = Symbol.for("pi-subagents:manager");

export interface SubagentManagerRegistry {
  getRecord(id: string): unknown;
  hasRunning(): boolean;
}

export interface LiveSubagentStats {
  rawStatus: string;
  toolUses?: number;
  tokens?: number;
  cost?: number;
  compactionCount?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Sum of the token components the record itself sums for display (input + output + cacheWrite). */
function parseLifetimeTokens(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const input = optionalNumber(usage.input);
  const output = optionalNumber(usage.output);
  const cacheWrite = optionalNumber(usage.cacheWrite);
  if (input === undefined || output === undefined || cacheWrite === undefined) return undefined;
  return input + output + cacheWrite;
}

export function getSubagentManager(): SubagentManagerRegistry | undefined {
  const candidate = (globalThis as unknown as Record<symbol, unknown>)[MANAGER_KEY];
  if (!isRecord(candidate)) return undefined;
  if (typeof candidate.getRecord !== "function" || typeof candidate.hasRunning !== "function") return undefined;
  return candidate as unknown as SubagentManagerRegistry;
}

export function readLiveStats(mgr: SubagentManagerRegistry, id: string): LiveSubagentStats | undefined {
  let record: unknown;
  try {
    record = mgr.getRecord(id);
  } catch {
    return undefined;
  }
  if (!isRecord(record)) return undefined;

  const rawStatus = typeof record.status === "string" ? record.status : undefined;
  if (!rawStatus) return undefined;

  return {
    rawStatus,
    toolUses: optionalNumber(record.toolUses),
    tokens: parseLifetimeTokens(record.lifetimeUsage),
    cost: isRecord(record.lifetimeUsage) ? optionalNumber(record.lifetimeUsage.cost) : undefined,
    compactionCount: optionalNumber(record.compactionCount),
  };
}
