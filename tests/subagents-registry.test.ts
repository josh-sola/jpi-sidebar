import assert from "node:assert/strict";
import test from "node:test";

import { getSubagentManager, readLiveStats } from "../extensions/jpi-sidebar/subagents-registry.ts";

const MANAGER_KEY = Symbol.for("pi-subagents:manager");

function withManager<T>(value: unknown, fn: () => T): T {
  const original = (globalThis as unknown as Record<symbol, unknown>)[MANAGER_KEY];
  (globalThis as unknown as Record<symbol, unknown>)[MANAGER_KEY] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete (globalThis as unknown as Record<symbol, unknown>)[MANAGER_KEY];
    else (globalThis as unknown as Record<symbol, unknown>)[MANAGER_KEY] = original;
  }
}

test("getSubagentManager is absent when the global slot is empty, without throwing", () => {
  withManager(undefined, () => {
    assert.equal(getSubagentManager(), undefined);
  });
});

test("getSubagentManager rejects a slot that isn't the expected shape", () => {
  withManager({ getRecord: () => undefined }, () => {
    assert.equal(getSubagentManager(), undefined); // missing hasRunning
  });
  withManager("not an object", () => {
    assert.equal(getSubagentManager(), undefined);
  });
  withManager({ getRecord: "nope", hasRunning: () => true }, () => {
    assert.equal(getSubagentManager(), undefined);
  });
});

test("getSubagentManager accepts a well-shaped registry", () => {
  const manager = { getRecord: () => undefined, hasRunning: () => false };
  withManager(manager, () => {
    assert.equal(getSubagentManager(), manager);
  });
});

test("readLiveStats returns undefined for a garbage or statusless record", () => {
  const manager = { getRecord: () => "not an object", hasRunning: () => false };
  assert.equal(readLiveStats(manager, "a1"), undefined);

  const noStatus = { getRecord: () => ({ toolUses: 3 }), hasRunning: () => false };
  assert.equal(readLiveStats(noStatus, "a1"), undefined);

  const missingRecord = { getRecord: () => undefined, hasRunning: () => false };
  assert.equal(readLiveStats(missingRecord, "a1"), undefined);
});

test("readLiveStats swallows a throwing getRecord instead of propagating", () => {
  const manager = {
    getRecord: () => {
      throw new Error("record evicted mid-read");
    },
    hasRunning: () => false,
  };
  assert.doesNotThrow(() => readLiveStats(manager, "a1"));
  assert.equal(readLiveStats(manager, "a1"), undefined);
});

test("readLiveStats extracts only well-typed fields and computes tokens as input+output+cacheWrite", () => {
  const manager = {
    getRecord: () => ({
      status: "running",
      toolUses: 4,
      compactionCount: 1,
      lifetimeUsage: { input: 10, output: 20, cacheWrite: 5, cacheRead: 100, cost: 0.5 },
    }),
    hasRunning: () => true,
  };
  assert.deepEqual(readLiveStats(manager, "a1"), {
    rawStatus: "running",
    toolUses: 4,
    tokens: 35,
    cost: 0.5,
    compactionCount: 1,
  });
});

test("readLiveStats omits tokens/cost when lifetimeUsage is missing or malformed", () => {
  const noUsage = { getRecord: () => ({ status: "queued" }), hasRunning: () => false };
  assert.deepEqual(readLiveStats(noUsage, "a1"), {
    rawStatus: "queued",
    toolUses: undefined,
    tokens: undefined,
    cost: undefined,
    compactionCount: undefined,
  });

  const partialUsage = { getRecord: () => ({ status: "running", lifetimeUsage: { input: 1 } }), hasRunning: () => true };
  const stats = readLiveStats(partialUsage, "a1");
  assert.equal(stats?.tokens, undefined);
});
