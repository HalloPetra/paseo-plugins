import { promises as fs, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServerConfig } from "./targets";

/**
 * A local Claude Code plugin whose .mcp.json every profile loads: the profiles share
 * ~/.claude/settings.json (which enables it) and ~/.claude/plugins. Claude Code names its
 * servers plugin:shared:<name> and reads edits to the file on the next session.
 */
export const SHARED_PREFIX = "plugin:shared:";
export const sharedMcpPath = join(homedir(), ".claude", "shared-mcp", "shared", ".mcp.json");

export function readSharedServers(): Record<string, McpServerConfig> | null {
  try {
    const parsed = JSON.parse(readFileSync(sharedMcpPath, "utf8")) as { mcpServers?: Record<string, McpServerConfig> };
    return parsed.mcpServers ?? {};
  } catch {
    return null;
  }
}

let queue: Promise<unknown> = Promise.resolve();

export function updateSharedServers(
  change: (servers: Record<string, McpServerConfig>) => Record<string, McpServerConfig>,
): Promise<void> {
  const run = queue.then(async () => {
    const current = readSharedServers();
    if (current === null) {
      throw new Error(`The shared MCP plugin is not set up (${sharedMcpPath} is missing).`);
    }
    const next = change({ ...current });
    await fs.mkdir(dirname(sharedMcpPath), { recursive: true });
    const temp = `${sharedMcpPath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify({ mcpServers: next }, null, 2)}\n`);
    await fs.rename(temp, sharedMcpPath);
  });
  queue = run.catch(() => undefined);
  return run;
}
