import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vite-plus/test";

import { createSidebarConfig, loadSidebarSettings } from "../extensions/jpi-sidebar/config.ts";

async function tempEnv() {
  const directory = await mkdtemp(join(tmpdir(), "jpi-sidebar-config-"));
  return { PI_CODING_AGENT_DIR: directory };
}

test("defaults are enabled with width 40 and linger 30 when jpi.kdl has no sidebar section yet", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);

  const result = await loadSidebarSettings(config);
  assert.deepEqual(result, { enabled: true, width: 40, linger: 30, path: config.path, issues: [] });
});

test("an existing stanza written before linger existed gets the default via the schema, not an issue", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await writeFile(
    config.path,
    ["sidebar {", "  enabled #true", "  width 55", "}"].join("\n"),
    "utf8",
  );

  const result = await loadSidebarSettings(config);
  assert.equal(result.linger, 30);
  assert.equal(result.width, 55);
  assert.deepEqual(result.issues, []);
});

test("an out-of-range linger falls back to the default and reports an issue", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await writeFile(config.path, ["sidebar {", "  linger 601", "}"].join("\n"), "utf8");

  const result = await loadSidebarSettings(config);
  assert.equal(result.linger, 30);
  assert.match(result.issues[0]!, /linger 601 is out of range 0-600/);
});

test("a negative linger also falls back to the default", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await writeFile(config.path, ["sidebar {", "  linger -1", "}"].join("\n"), "utf8");

  const result = await loadSidebarSettings(config);
  assert.equal(result.linger, 30);
  assert.match(result.issues[0]!, /linger -1 is out of range 0-600/);
});

test("linger 0 is in range and is not clamped away", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await writeFile(config.path, ["sidebar {", "  linger 0", "}"].join("\n"), "utf8");

  const result = await loadSidebarSettings(config);
  assert.equal(result.linger, 0);
  assert.deepEqual(result.issues, []);
});

test("an out-of-range width falls back to the default and reports an issue", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await writeFile(
    config.path,
    ["sidebar {", "  enabled #true", "  width 500", "}"].join("\n"),
    "utf8",
  );

  const result = await loadSidebarSettings(config);
  assert.equal(result.width, 40);
  assert.match(result.issues[0]!, /width 500 is out of range 10-120/);
});

test("a too-small width also falls back to the default", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await writeFile(config.path, ["sidebar {", "  width 1", "}"].join("\n"), "utf8");

  const result = await loadSidebarSettings(config);
  assert.equal(result.width, 40);
  assert.match(result.issues[0]!, /width 1 is out of range 10-120/);
});

test("a saved width persists into jpi.kdl and is picked up by a fresh load", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await loadSidebarSettings(config); // seeds jpi.kdl with the section and defaults

  const saveResult = await config.save({ width: 55 });
  assert.deepEqual(saveResult.issues, []);

  const text = await readFile(config.path, "utf8");
  assert.match(text, /width 55/);

  const reloaded = await loadSidebarSettings(createSidebarConfig(env));
  assert.equal(reloaded.width, 55);
  assert.equal(reloaded.enabled, true);
});

test("saving a value into a hand-written jpi.kdl only touches that value's line", async () => {
  const env = await tempEnv();
  const config = createSidebarConfig(env);
  await writeFile(
    config.path,
    [
      "// my notes on this file",
      "sidebar {",
      "  // keep the sidebar on by default",
      "  enabled #true",
      "  width 40",
      "}",
    ].join("\n"),
    "utf8",
  );

  const saveResult = await config.save({ width: 72 });
  assert.deepEqual(saveResult.issues, []);

  const text = await readFile(config.path, "utf8");
  assert.match(text, /\/\/ my notes on this file/);
  assert.match(text, /\/\/ keep the sidebar on by default/);
  assert.match(text, /width 72/);
  assert.doesNotMatch(text, /width 40/);

  const reloaded = await loadSidebarSettings(config);
  assert.equal(reloaded.width, 72);
  assert.equal(reloaded.enabled, true);
});
