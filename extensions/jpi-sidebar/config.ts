import { Config, j } from "jpi-base";

const MIN_WIDTH = 10;
const MAX_WIDTH = 120;
const DEFAULT_WIDTH = 40;
const MIN_LINGER_SECONDS = 0;
const MAX_LINGER_SECONDS = 600;
const DEFAULT_LINGER_SECONDS = 30;

const sidebarSchema = j.node({
  fields: {
    enabled: j.boolean().default(true).describe("show the sidebar in fullscreen sessions"),
    width: j.number().default(DEFAULT_WIDTH).describe("sidebar width in columns, 10-120"),
    linger: j
      .number()
      .default(DEFAULT_LINGER_SECONDS)
      .describe("seconds a finished todo or subagent stays visible, 0-600"),
  },
});

export type SidebarSchema = typeof sidebarSchema;

export function createSidebarConfig(env?: NodeJS.ProcessEnv, homeDirectory?: string): Config<SidebarSchema> {
  return new Config("sidebar", sidebarSchema, env, homeDirectory);
}

export interface SidebarSettings {
  enabled: boolean;
  width: number;
  linger: number;
}

export interface LoadedSidebarSettings extends SidebarSettings {
  path: string;
  issues: string[];
}

function sanitizeWidth(value: number, issues: string[]): number {
  if (!Number.isFinite(value) || value < MIN_WIDTH || value > MAX_WIDTH) {
    issues.push(`width ${value} is out of range ${MIN_WIDTH}-${MAX_WIDTH}; using the default ${DEFAULT_WIDTH}`);
    return DEFAULT_WIDTH;
  }
  return value;
}

function sanitizeLinger(value: number, issues: string[]): number {
  if (!Number.isFinite(value) || value < MIN_LINGER_SECONDS || value > MAX_LINGER_SECONDS) {
    issues.push(
      `linger ${value} is out of range ${MIN_LINGER_SECONDS}-${MAX_LINGER_SECONDS}; using the default ${DEFAULT_LINGER_SECONDS}`,
    );
    return DEFAULT_LINGER_SECONDS;
  }
  return value;
}

export async function loadSidebarSettings(config: Config<SidebarSchema>): Promise<LoadedSidebarSettings> {
  const { value, issues } = await config.load();
  const collectedIssues = [...issues];
  const width = sanitizeWidth(value.width, collectedIssues);
  const linger = sanitizeLinger(value.linger, collectedIssues);
  return { enabled: value.enabled, width, linger, path: config.path, issues: collectedIssues };
}
