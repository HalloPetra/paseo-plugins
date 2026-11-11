import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Project, Target } from "../shared/mcp";

export const DEFAULT_TARGET_ID = "default";

/** The config dir Claude Code uses without CLAUDE_CONFIG_DIR overrides from Paseo. */
const defaultConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const accountsHome = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "claude-accounts");

interface AccountsState {
  activeId?: string;
  accounts?: { id: string; label: string }[];
}

function readAccountsState(): AccountsState | null {
  try {
    return JSON.parse(readFileSync(join(accountsHome, "state.json"), "utf8")) as AccountsState;
  } catch {
    return null;
  }
}

/** The default login plus every account the Claude accounts plugin manages. */
export function listTargets(): Target[] {
  const state = readAccountsState();
  const activeId = state?.activeId ?? DEFAULT_TARGET_ID;
  const targets: Target[] = [
    {
      id: DEFAULT_TARGET_ID,
      label: "Default login",
      configDir: defaultConfigDir,
      isDefault: true,
      active: activeId === DEFAULT_TARGET_ID,
    },
  ];
  for (const account of state?.accounts ?? []) {
    if (account.id === DEFAULT_TARGET_ID) {
      targets[0] = { ...targets[0], label: account.label || targets[0].label };
      continue;
    }
    const configDir = join(accountsHome, "accounts", account.id);
    if (!existsSync(configDir)) continue;
    targets.push({
      id: account.id,
      label: account.label || account.id,
      configDir,
      isDefault: false,
      active: account.id === activeId,
    });
  }
  return targets;
}

export function targetById(id: string): Target {
  const target = listTargets().find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown Claude login ${id}`);
  return target;
}

export function envFor(target: Target): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (target.isDefault) {
    if (!process.env.CLAUDE_CONFIG_DIR) delete env.CLAUDE_CONFIG_DIR;
    return env;
  }
  return { ...env, CLAUDE_CONFIG_DIR: target.configDir };
}

/** Claude Code keeps its global config beside the config dir only when CLAUDE_CONFIG_DIR is set. */
export function globalConfigPath(target: Target): string {
  if (target.isDefault && !process.env.CLAUDE_CONFIG_DIR) return join(homedir(), ".claude.json");
  return join(target.configDir, ".claude.json");
}

export type McpServerConfig = Record<string, unknown>;

export interface GlobalConfig {
  mcpServers?: Record<string, McpServerConfig>;
  projects?: Record<
    string,
    { mcpServers?: Record<string, McpServerConfig>; disabledMcpServers?: string[] }
  >;
}

export function readGlobalConfig(target: Target): GlobalConfig {
  try {
    return JSON.parse(readFileSync(globalConfigPath(target), "utf8")) as GlobalConfig;
  } catch {
    return {};
  }
}

/** Claude Code keys projects by their resolved path. */
export function projectKey(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

function tildify(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Projects Claude Code has opened with this login, those with MCP settings first. */
export function listProjects(target: Target): Project[] {
  const config = readGlobalConfig(target);
  const home = homedir();
  const projects: Project[] = [];
  for (const [path, project] of Object.entries(config.projects ?? {})) {
    if (path === home || !existsSync(path)) continue;
    const hasMcp =
      Object.keys(project.mcpServers ?? {}).length > 0 ||
      (project.disabledMcpServers ?? []).length > 0;
    projects.push({ path, label: `${basename(path)} · ${tildify(path)}`, hasMcp });
  }
  projects.sort((a, b) => Number(b.hasMcp) - Number(a.hasMcp) || a.path.localeCompare(b.path));
  return [{ path: home, label: "Home · ~", hasMcp: false }, ...projects];
}
