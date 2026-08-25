import assert from "node:assert/strict";
import { test } from "vite-plus/test";

import {
  parseSubagentFinished,
  parseSubagentStarted,
} from "../extensions/jpi-sidebar/subagents-bus.ts";

test("parseSubagentStarted requires a non-empty string id and passes through optional fields", () => {
  assert.deepEqual(parseSubagentStarted({ id: "a1", type: "explorer", description: "Survey" }), {
    id: "a1",
    type: "explorer",
    description: "Survey",
  });
  assert.deepEqual(parseSubagentStarted({ id: "a1" }), {
    id: "a1",
    type: undefined,
    description: undefined,
  });
  assert.equal(parseSubagentStarted({ id: "" }), undefined);
  assert.equal(parseSubagentStarted({ type: "explorer" }), undefined);
  assert.equal(parseSubagentStarted("not an object"), undefined);
  assert.equal(parseSubagentStarted(null), undefined);
  assert.equal(parseSubagentStarted([{ id: "a1" }]), undefined);
});

test("parseSubagentFinished tolerates a garbage tokens field and only accepts a fully-numeric one", () => {
  const full = parseSubagentFinished({
    id: "a1",
    toolUses: 4,
    durationMs: 1234,
    tokens: { input: 10, output: 20, total: 30 },
  });
  assert.deepEqual(full, {
    id: "a1",
    type: undefined,
    description: undefined,
    toolUses: 4,
    durationMs: 1234,
    tokens: { input: 10, output: 20, total: 30 },
  });

  const partialTokens = parseSubagentFinished({ id: "a1", tokens: { input: 10 } });
  assert.equal(partialTokens?.tokens, undefined);

  const noTokens = parseSubagentFinished({ id: "a1" });
  assert.equal(noTokens?.tokens, undefined);

  assert.equal(parseSubagentFinished({}), undefined);
});
