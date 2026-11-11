import { promises as fs, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { permissionPrefix, type Status, statusSchema } from "../shared/mcp";

/** The last probe per login and project, kept across plugin reloads and daemon restarts. */
const cachePath = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "mcp-plugin", "status-cache.json");
const MAX_ENTRIES = 50;

let entries: Map<string, Status> | null = null;
let writing: Promise<unknown> = Promise.resolve();

function load(): Map<string, Status> {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      const parsed = statusSchema.safeParse(value);
      if (parsed.success) entries.set(key, parsed.data);
    }
  } catch {
    // No cache yet.
  }
  return entries;
}

function persist(): void {
  const snapshot = Object.fromEntries(load());
  writing = writing
    .then(async () => {
      await fs.mkdir(dirname(cachePath), { recursive: true });
      const temp = `${cachePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(snapshot));
      await fs.rename(temp, cachePath);
    })
    .catch((error) => console.error("Could not save the MCP status cache", error));
}

export function cacheKey(targetId: string, cwd: string): string {
  return `${targetId}\0${cwd}`;
}

export function readCachedStatus(targetId: string, cwd: string): Status | null {
  return load().get(cacheKey(targetId, cwd)) ?? null;
}

export function writeCachedStatus(targetId: string, cwd: string, status: Status): void {
  const map = load();
  const key = cacheKey(targetId, cwd);
  map.delete(key);
  map.set(key, status);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
  persist();
}

/** Drops a removed server from every cached probe on this login. */
export function forgetCachedServer(targetId: string, name: string, scope: string): void {
  const map = load();
  let changed = false;
  for (const [key, status] of map) {
    if (!key.startsWith(`${targetId}\0`) && scope !== "shared") continue;
    const servers = status.servers.filter((server) => !(server.label === name && server.scope === scope));
    if (servers.length !== status.servers.length) {
      map.set(key, { ...status, servers });
      changed = true;
    }
  }
  if (changed) persist();
}

/** Deny rules can change without a new probe; apply the current ones to a cached result. */
export function withDenyRules(status: Status, deny: string[]): Status {
  const rules = new Set(deny);
  return {
    ...status,
    servers: status.servers.map((server) => {
      const prefix = permissionPrefix(server.name);
      const serverDenied = rules.has(prefix) || rules.has(`${prefix}__*`);
      return {
        ...server,
        serverDenied,
        tools: server.tools.map((tool) => ({ ...tool, denied: serverDenied || rules.has(tool.fullName) })),
      };
    }),
  };
}
