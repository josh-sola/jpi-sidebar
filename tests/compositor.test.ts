import assert from "node:assert/strict";
import test from "node:test";

import { computeAppWidth, isSidebarUsable, SidebarCompositor } from "../extensions/jpi-sidebar/compositor.ts";

// Mirrors the real terminal's shape: columns/write live on the prototype, not
// as own properties, exactly like pi's ProcessTerminal.
class FakeTerminal {
  writes: string[] = [];
  private columnsValue: number;
  private rowsValue: number;

  constructor(columns: number, rows: number) {
    this.columnsValue = columns;
    this.rowsValue = rows;
  }

  get columns(): number {
    return this.columnsValue;
  }

  get rows(): number {
    return this.rowsValue;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  setColumns(columns: number): void {
    this.columnsValue = columns;
  }
}

function moveTo(row: number, column: number): string {
  return `\x1b[${row};${column}H`;
}

function makeCompositor(terminal: FakeTerminal, mode = "fullscreen", width = 40, lines: string[] = ["line1", "line2"]) {
  const tui = { mode, terminal: terminal as unknown as { write(data: string): void; columns: number; rows: number } };
  const compositor = new SidebarCompositor(tui, {
    getWidth: () => width,
    renderBand: () => lines,
  });
  return { tui, compositor };
}

test("install refuses regular mode and leaves the terminal untouched", () => {
  const terminal = new FakeTerminal(100, 24);
  const { compositor } = makeCompositor(terminal, "regular");
  assert.equal(compositor.install(), false);
  assert.equal(terminal.columns, 100);
  assert.equal(Object.getOwnPropertyDescriptor(terminal, "write"), undefined);
});

test("install refuses a terminal without a write function", () => {
  const terminal = { columns: 100, rows: 24 } as unknown as FakeTerminal;
  const { compositor } = makeCompositor(terminal);
  assert.equal(compositor.install(), false);
});

test("install refuses a non-configurable own columns descriptor", () => {
  const terminal = new FakeTerminal(100, 24);
  Object.defineProperty(terminal, "columns", { value: 100, configurable: false, enumerable: true, writable: false });
  const { compositor } = makeCompositor(terminal);
  assert.equal(compositor.install(), false);
});

test("install narrows terminal.columns to reserve the sidebar width plus a separator", () => {
  const terminal = new FakeTerminal(100, 24);
  const { compositor } = makeCompositor(terminal, "fullscreen", 40);
  assert.equal(compositor.install(), true);
  assert.equal(terminal.columns, computeAppWidth(100, 40));
  assert.equal(terminal.columns, 59);
});

test("the narrowed width tracks getWidth() live, without reinstalling", () => {
  const terminal = new FakeTerminal(100, 24);
  let width = 40;
  const tui = { mode: "fullscreen", terminal: terminal as unknown as { write(data: string): void; columns: number; rows: number } };
  const compositor = new SidebarCompositor(tui, { getWidth: () => width, renderBand: () => [] });
  compositor.install();
  assert.equal(terminal.columns, 59);
  width = 50;
  assert.equal(terminal.columns, 49);
});

test("a bracketed frame gets the sidebar band appended; a plain write passes through untouched", () => {
  const terminal = new FakeTerminal(100, 24);
  const { compositor } = makeCompositor(terminal);
  compositor.install();

  terminal.write("no sync bracket here");
  assert.equal(terminal.writes.at(-1), "no sync bracket here");

  terminal.write("\x1b[?2026hcontent\x1b[?2026l");
  const painted = terminal.writes.at(-1)!;
  assert.ok(painted.startsWith("\x1b[?2026hcontent\x1b[?2026l"));
  assert.ok(painted.length > "\x1b[?2026hcontent\x1b[?2026l".length);
});

test("the appended paint string has the expected escapes and column positions", () => {
  const terminal = new FakeTerminal(100, 24);
  const { compositor } = makeCompositor(terminal, "fullscreen", 40, ["hello", "world"]);
  compositor.install();

  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  const painted = terminal.writes.at(-1)!;

  // appWidth = computeAppWidth(100, 40) = 59, separator at 60, band at 61.
  assert.ok(painted.includes("\x1b[?2026h"));
  assert.ok(painted.includes("\x1b7"));
  assert.ok(painted.includes("\x1b[?7l"));
  assert.ok(painted.includes("\x1b[?7h"));
  assert.ok(painted.includes("\x1b8"));
  assert.ok(painted.endsWith("\x1b[?2026l"));
  assert.ok(painted.includes(`${moveTo(1, 60)}\x1b[2m│`));
  assert.ok(painted.includes(moveTo(1, 61)));
  assert.ok(painted.includes(moveTo(24, 60)));
  assert.ok(painted.includes(moveTo(24, 61)));
  assert.ok(painted.includes("hello"));
  assert.ok(painted.includes("world"));
});

test("the band is cached across writes until invalidate() is called", () => {
  const terminal = new FakeTerminal(100, 24);
  let lines = ["first"];
  const tui = { mode: "fullscreen", terminal: terminal as unknown as { write(data: string): void; columns: number; rows: number } };
  let renderCount = 0;
  const compositor = new SidebarCompositor(tui, {
    getWidth: () => 40,
    renderBand: () => {
      renderCount += 1;
      return lines;
    },
  });
  compositor.install();

  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.equal(renderCount, 1);

  lines = ["second"];
  compositor.invalidate();
  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.equal(renderCount, 2);
  assert.ok(terminal.writes.at(-1)!.includes("second"));
});

test("a resize (rows or columns changed) forces a re-render even without invalidate()", () => {
  const terminal = new FakeTerminal(100, 24);
  const tui = { mode: "fullscreen", terminal: terminal as unknown as { write(data: string): void; columns: number; rows: number } };
  let renderCount = 0;
  const compositor = new SidebarCompositor(tui, {
    getWidth: () => 40,
    renderBand: () => {
      renderCount += 1;
      return ["x"];
    },
  });
  compositor.install();
  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.equal(renderCount, 1);

  (terminal as unknown as { rowsValue: number }).rowsValue = 30;
  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.equal(renderCount, 2);
});

test("dispose restores the original descriptor and write function exactly, and is idempotent", () => {
  const terminal = new FakeTerminal(100, 24);
  const { compositor } = makeCompositor(terminal);
  compositor.install();

  compositor.dispose();
  assert.equal(Object.getOwnPropertyDescriptor(terminal, "columns"), undefined);
  assert.equal(Object.getOwnPropertyDescriptor(terminal, "write"), undefined);
  assert.equal(terminal.columns, 100);

  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.equal(terminal.writes.at(-1), "\x1b[?2026hframe\x1b[?2026l");

  assert.doesNotThrow(() => compositor.dispose());
});

test("install refuses a non-configurable own write descriptor without touching columns", () => {
  const terminal = new FakeTerminal(100, 24);
  const boundWrite = terminal.write.bind(terminal);
  Object.defineProperty(terminal, "write", {
    value: boundWrite,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  const { compositor } = makeCompositor(terminal);

  let installed: boolean | undefined;
  assert.doesNotThrow(() => {
    installed = compositor.install();
  });
  assert.equal(installed, false);
  assert.equal(Object.getOwnPropertyDescriptor(terminal, "columns"), undefined);
  assert.equal(terminal.columns, 100);
});

test("columns getter passes the raw width through unnarrowed below the minimum app width", () => {
  // 50 - 40 - 1 = 9, under MIN_APP_WIDTH (20).
  const terminal = new FakeTerminal(50, 24);
  const { compositor } = makeCompositor(terminal, "fullscreen", 40);
  compositor.install();
  assert.equal(isSidebarUsable(50, 40), false);
  assert.equal(terminal.columns, 50);
});

test("paint() draws nothing below the minimum app width", () => {
  const terminal = new FakeTerminal(50, 24);
  const { compositor } = makeCompositor(terminal, "fullscreen", 40);
  compositor.install();

  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.equal(terminal.writes.at(-1), "\x1b[?2026hframe\x1b[?2026l");
});

test("the getter and paint() flip together when the raw width crosses the minimum threshold", () => {
  const terminal = new FakeTerminal(58, 24); // 58 - 40 - 1 = 17, unusable
  const { compositor } = makeCompositor(terminal, "fullscreen", 40);
  compositor.install();

  assert.equal(terminal.columns, 58);
  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.equal(terminal.writes.at(-1), "\x1b[?2026hframe\x1b[?2026l");

  terminal.setColumns(61); // 61 - 40 - 1 = 20, usable again
  assert.equal(terminal.columns, 20);
  terminal.write("\x1b[?2026hframe\x1b[?2026l");
  assert.ok(terminal.writes.at(-1)!.length > "\x1b[?2026hframe\x1b[?2026l".length);
});
