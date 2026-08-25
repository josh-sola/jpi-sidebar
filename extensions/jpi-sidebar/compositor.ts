import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Synchronized-output bracket that marks a composed frame from pi's renderer.
const FRAME_MARKER = "\x1b[?2026";
const SYNC_BEGIN = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";
const SAVE_CURSOR = "\x1b7"; // DECSC
const RESTORE_CURSOR = "\x1b8"; // DECRC
const AUTOWRAP_OFF = "\x1b[?7l";
const AUTOWRAP_ON = "\x1b[?7h";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const SEPARATOR_GLYPH = "│";

export interface CompositorTerminal {
  write(data: string): void;
  columns: number;
  rows: number;
}

export interface CompositorTui {
  readonly mode: string;
  readonly terminal: CompositorTerminal;
}

export interface SidebarCompositorOptions {
  /** Configured sidebar width; read fresh every paint so runtime changes apply immediately. */
  getWidth(): number;
  renderBand(width: number, rows: number): string[];
}

function moveTo(row: number, column: number): string {
  return `\x1b[${row};${column}H`;
}

function findOwnerDescriptor(target: object, key: string): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function readDescriptorValue(
  descriptor: PropertyDescriptor | undefined,
  thisArg: unknown,
  fallback: number,
): number {
  if (!descriptor) return fallback;
  if (typeof descriptor.get === "function") return descriptor.get.call(thisArg) as number;
  return typeof descriptor.value === "number" ? descriptor.value : fallback;
}

// Below this, narrowing the app further makes it unusable; better to hide the sidebar.
const MIN_APP_WIDTH = 20;

/** Single source of truth for the getter and paint() so they can't disagree per frame. */
export function isSidebarUsable(rawColumns: number, sidebarWidth: number): boolean {
  return rawColumns - sidebarWidth - 1 >= MIN_APP_WIDTH;
}

/** App width when the sidebar reserves `sidebarWidth` columns plus a 1-column separator. */
export function computeAppWidth(rawColumns: number, sidebarWidth: number): number {
  return isSidebarUsable(rawColumns, sidebarWidth) ? rawColumns - sidebarWidth - 1 : rawColumns;
}

function fitToWidth(line: string, width: number): string {
  const truncated = truncateToWidth(line, width, "");
  const pad = width - visibleWidth(truncated);
  return pad > 0 ? truncated + " ".repeat(pad) : truncated;
}

/**
 * Reserves the right edge of pi's fullscreen terminal for a sidebar band and
 * repaints it into every frame pi's own renderer writes.
 */
export class SidebarCompositor {
  private readonly tui: CompositorTui;
  private readonly getWidth: () => number;
  private readonly renderBand: (width: number, rows: number) => string[];

  private installed = false;
  private rawColumnsDescriptor: PropertyDescriptor | undefined;
  private ownColumnsDescriptor: PropertyDescriptor | undefined;
  private ownWriteDescriptor: PropertyDescriptor | undefined;
  private originalWrite: ((data: string) => void) | undefined;

  private dirty = true;
  private cachedLines: string[] = [];
  private cachedWidth = -1;
  private cachedRows = -1;

  constructor(tui: CompositorTui, options: SidebarCompositorOptions) {
    this.tui = tui;
    this.getWidth = options.getWidth;
    this.renderBand = options.renderBand;
  }

  /** Fails closed: any capability gap leaves the terminal untouched. */
  install(): boolean {
    if (this.installed) return true;
    if (this.tui.mode !== "fullscreen") return false;

    const terminal = this.tui.terminal as unknown as Record<string, unknown>;
    if (!terminal || typeof terminal.write !== "function") return false;
    if (typeof terminal.columns !== "number" || typeof terminal.rows !== "number") return false;

    const ownColumnsDescriptor = Object.getOwnPropertyDescriptor(terminal, "columns");
    if (ownColumnsDescriptor && ownColumnsDescriptor.configurable === false) return false;
    const ownWriteDescriptor = Object.getOwnPropertyDescriptor(terminal, "write");
    if (ownWriteDescriptor && ownWriteDescriptor.configurable === false) return false;

    // Every check above must pass before any defineProperty below runs, or a
    // throw partway through would leave one property patched and one not.
    this.rawColumnsDescriptor = findOwnerDescriptor(terminal, "columns");
    this.ownColumnsDescriptor = ownColumnsDescriptor;
    this.ownWriteDescriptor = ownWriteDescriptor;
    this.originalWrite = (terminal.write as (data: string) => void).bind(terminal);

    const getWidth = this.getWidth;
    const rawColumnsDescriptor = this.rawColumnsDescriptor;
    Object.defineProperty(terminal, "columns", {
      configurable: true,
      enumerable: ownColumnsDescriptor?.enumerable ?? true,
      get(): number {
        const raw = readDescriptorValue(rawColumnsDescriptor, terminal, 80);
        return computeAppWidth(raw, getWidth());
      },
    });

    const originalWrite = this.originalWrite;
    const self = this;
    Object.defineProperty(terminal, "write", {
      configurable: true,
      enumerable: this.ownWriteDescriptor?.enumerable ?? false,
      writable: true,
      value(data: string) {
        if (typeof data === "string" && data.includes(FRAME_MARKER)) {
          originalWrite(data + self.paint());
        } else {
          originalWrite(data);
        }
      },
    });

    this.installed = true;
    this.dirty = true;
    return true;
  }

  /** Marks the cached band stale; the next painted frame re-renders it. */
  invalidate(): void {
    this.dirty = true;
  }

  private paint(): string {
    const terminal = this.tui.terminal;
    const rawColumns = readDescriptorValue(this.rawColumnsDescriptor, terminal, terminal.columns);
    const rows = terminal.rows;
    const width = this.getWidth();

    if (!isSidebarUsable(rawColumns, width)) return "";

    if (this.dirty || width !== this.cachedWidth || rows !== this.cachedRows) {
      this.cachedLines = this.renderBand(width, rows);
      this.cachedWidth = width;
      this.cachedRows = rows;
      this.dirty = false;
    }

    const appWidth = computeAppWidth(rawColumns, width);
    const separatorColumn = appWidth + 1;
    const bandColumn = separatorColumn + 1;

    let out = `${SYNC_BEGIN}${SAVE_CURSOR}${AUTOWRAP_OFF}`;
    for (let row = 1; row <= rows; row += 1) {
      const line = fitToWidth(this.cachedLines[row - 1] ?? "", width);
      out += `${moveTo(row, separatorColumn)}${DIM}${SEPARATOR_GLYPH}${RESET}`;
      out += `${moveTo(row, bandColumn)}${line}`;
    }
    out += `${AUTOWRAP_ON}${RESTORE_CURSOR}${SYNC_END}`;
    return out;
  }

  /** Idempotent: safe to call repeatedly, including without a prior install(). */
  dispose(): void {
    if (!this.installed) return;
    const terminal = this.tui.terminal as unknown as Record<string, unknown>;

    if (this.ownColumnsDescriptor) {
      Object.defineProperty(terminal, "columns", this.ownColumnsDescriptor);
    } else {
      delete terminal.columns;
    }

    if (this.ownWriteDescriptor) {
      Object.defineProperty(terminal, "write", this.ownWriteDescriptor);
    } else {
      delete terminal.write;
    }

    this.installed = false;
  }
}
