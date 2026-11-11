import {
  type EditableScope,
  type ImportCandidate,
  type RemovableScope,
  permissionPrefix,
  type Server,
  type ServerStatus,
  type Status,
  type Target,
} from "../shared/mcp";
import { type ProbedServer, probe, runMcpCli } from "./claude";
import { readDenyRules, settingsPath } from "./settings";
import { readSharedServers, SHARED_PREFIX, updateSharedServers } from "./shared-store";
import { forgetCachedServer, writeCachedStatus } from "./status-cache";
import {
  listTargets,
  type McpServerConfig,
  projectKey,
  readGlobalConfig,
  targetById,
} from "./targets";

const STATUSES: readonly ServerStatus[] = ["connected", "pending", "needs-auth", "failed", "disabled", "hidden"];

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function summarize(config: McpServerConfig | undefined): string {
  if (!config) return "";
  const url = stringOf(config.url);
  if (url) return url;
  const command = stringOf(config.command);
  const args = Array.isArray(config.args) ? config.args.map(String) : [];
  return [command, ...args].filter(Boolean).join(" ");
}

function storedConfigs(target: Target, cwd: string) {
  const config = readGlobalConfig(target);
  return {
    user: config.mcpServers ?? {},
    local: config.projects?.[projectKey(cwd)]?.mcpServers ?? {},
  };
}

function describe(
  probed: ProbedServer,
  stored: McpServerConfig | undefined,
  deny: Set<string>,
  scopeOverride?: string,
): Server {
  const prefix = permissionPrefix(probed.name);
  const serverDenied = deny.has(prefix) || deny.has(`${prefix}__*`);
  const transport = probed.transport ?? stringOf(probed.config?.type) ?? "stdio";
  const headersHelper = stringOf(stored?.headersHelper);
  const status = STATUSES.includes(probed.status as ServerStatus)
    ? (probed.status as ServerStatus)
    : "unknown";
  const info = probed.serverInfo?.name
    ? [probed.serverInfo.name, probed.serverInfo.version].filter(Boolean).join(" ")
    : null;
  return {
    name: probed.name,
    label: probed.name.startsWith(SHARED_PREFIX) ? probed.name.slice(SHARED_PREFIX.length) : probed.name,
    scope: scopeOverride ?? probed.scope ?? probed.source ?? "unknown",
    status,
    error: probed.error ?? null,
    transport,
    summary: summarize(stored ?? probed.config),
    serverInfo: info,
    serverDenied,
    tools: (probed.tools ?? []).map((tool) => {
      const fullName = `${prefix}__${tool.name}`;
      return {
        name: tool.name,
        fullName,
        readOnly: Boolean(tool.annotations?.readOnly),
        destructive: Boolean(tool.annotations?.destructive),
        denied: serverDenied || deny.has(fullName),
      };
    }),
    config: stored ? JSON.stringify(stored, null, 2) : null,
    headersHelper,
    canLogin: transport !== "stdio" && !headersHelper,
  };
}

function importCandidates(target: Target): ImportCandidate[] {
  const own = readGlobalConfig(target).mcpServers ?? {};
  const candidates: ImportCandidate[] = [];
  for (const other of listTargets()) {
    if (other.id === target.id) continue;
    const names = Object.keys(readGlobalConfig(other).mcpServers ?? {}).filter((name) => !(name in own));
    if (names.length) candidates.push({ fromTargetId: other.id, fromLabel: other.label, names });
  }
  return candidates;
}

const inFlight = new Map<string, Promise<Status>>();

async function buildStatus(target: Target, cwd: string, before: Record<string, unknown>[]): Promise<Status> {
  const [result, deny] = await Promise.all([probe(target, cwd, before), readDenyRules(target)]);
  const stored = storedConfigs(target, cwd);
  const shared = readSharedServers() ?? {};
  const denySet = new Set(deny);
  const servers = result.servers.map((server) => {
    if (server.name.startsWith(SHARED_PREFIX)) {
      return describe(server, shared[server.name.slice(SHARED_PREFIX.length)], denySet, "shared");
    }
    const scope = server.scope ?? server.source;
    const config =
      scope === "user" ? stored.user[server.name] : scope === "local" ? stored.local[server.name] : undefined;
    return describe(server, config, denySet);
  });
  // Claude Code drops a plugin server whose URL a claude.ai connector already serves.
  for (const [label, config] of Object.entries(shared)) {
    const name = `${SHARED_PREFIX}${label}`;
    if (servers.some((server) => server.name === name)) continue;
    const url = stringOf(config.url);
    const connector = url ? result.servers.find((server) => stringOf(server.config?.url) === url) : undefined;
    const hidden = describe(
      { name, status: "hidden", config, transport: stringOf(config.type) ?? "stdio" },
      config,
      denySet,
      "shared",
    );
    servers.push({
      ...hidden,
      status: "hidden",
      error: connector
        ? `Not loaded on this login: ${connector.name} serves the same URL.`
        : "Not loaded on this login. Refresh, or check that the shared plugin is enabled.",
      canLogin: false,
    });
  }
  return {
    servers,
    importable: importCandidates(target),
    settingsPath: settingsPath(target),
    probedAt: new Date().toISOString(),
    partial: result.partial,
  };
}

export function getStatus(targetId: string, cwd: string): Promise<Status> {
  const key = `${targetId}\0${cwd}`;
  const running = inFlight.get(key);
  if (running) return running;
  const promise = buildStatus(targetById(targetId), cwd, [])
    .then((status) => {
      writeCachedStatus(targetId, cwd, status);
      return status;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Enables or disables a server for one project, as /mcp does, and reports the result. */
export function toggleServer(targetId: string, cwd: string, name: string, enabled: boolean): Promise<Status> {
  return buildStatus(targetById(targetId), cwd, [
    { subtype: "mcp_toggle", serverName: name, enabled },
  ]).then((status) => {
    writeCachedStatus(targetId, cwd, status);
    return status;
  });
}

function parseConfig(json: string): McpServerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`The server config is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The server config must be a JSON object.");
  }
  return parsed as McpServerConfig;
}

async function addServer(target: Target, cwd: string, name: string, scope: EditableScope, config: McpServerConfig) {
  if (scope === "shared") {
    await updateSharedServers((servers) => {
      if (name in servers) throw new Error(`A shared server named ${name} already exists.`);
      return { ...servers, [name]: config };
    });
    return;
  }
  await runMcpCli(target, cwd, ["add-json", "-s", scope, name, JSON.stringify(config)]);
}

async function deleteServer(target: Target, cwd: string, name: string, scope: RemovableScope) {
  if (scope === "shared") {
    await updateSharedServers((servers) => {
      const { [name]: _removed, ...rest } = servers;
      return rest;
    });
    return;
  }
  await runMcpCli(target, cwd, ["remove", "-s", scope, name]);
}

function storedConfig(target: Target, cwd: string, scope: EditableScope, name: string) {
  if (scope === "shared") return (readSharedServers() ?? {})[name];
  return storedConfigs(target, cwd)[scope][name];
}

export async function saveServer(input: {
  targetId: string;
  cwd: string;
  name: string;
  scope: EditableScope;
  config: string;
  replaces?: { name: string; scope: EditableScope };
}): Promise<void> {
  const target = targetById(input.targetId);
  const name = input.name.trim();
  if (!/^[a-zA-Z0-9_.:-]+$/.test(name)) {
    throw new Error("Use letters, numbers, dots, dashes, colons, or underscores in the name.");
  }
  const config = parseConfig(input.config);
  if (!input.replaces) {
    await addServer(target, input.cwd, name, input.scope, config);
    return;
  }
  const previous = storedConfig(target, input.cwd, input.replaces.scope, input.replaces.name);
  await deleteServer(target, input.cwd, input.replaces.name, input.replaces.scope);
  try {
    await addServer(target, input.cwd, name, input.scope, config);
  } catch (error) {
    if (previous) {
      await addServer(target, input.cwd, input.replaces.name, input.replaces.scope, previous).catch(
        (restoreError) => console.error("Could not restore the previous server config", restoreError),
      );
    }
    throw error;
  }
}

/**
 * Removes a server and signs it out first, so no OAuth token outlives it. `name` is the configured
 * name; shared servers sign out on every login, since each keeps its own token.
 */
export async function removeServer(targetId: string, cwd: string, name: string, scope: RemovableScope) {
  const target = targetById(targetId);
  // Logout fails when there are no stored credentials, which is fine.
  if (scope === "shared") {
    for (const login of listTargets()) {
      await runMcpCli(login, cwd, ["logout", `${SHARED_PREFIX}${name}`]).catch(() => undefined);
    }
  } else {
    await runMcpCli(target, cwd, ["logout", name]).catch(() => undefined);
  }
  await deleteServer(target, cwd, name, scope);
  forgetCachedServer(targetId, name, scope);
}

/** Copies user-scope servers from another login. OAuth sign-ins do not carry over. */
export async function importServers(targetId: string, fromTargetId: string, names: string[]) {
  const target = targetById(targetId);
  const from = readGlobalConfig(targetById(fromTargetId)).mcpServers ?? {};
  const own = readGlobalConfig(target).mcpServers ?? {};
  const imported: string[] = [];
  for (const name of names) {
    const config = from[name];
    if (!config || name in own) continue;
    await addServer(target, target.configDir, name, "user", config);
    imported.push(name);
  }
  return { imported };
}
