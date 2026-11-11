import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { Target } from "../shared/mcp";

/** User settings: deny rules here hide MCP tools from every Claude Code session on this login. */
export function settingsPath(target: Target): string {
  return join(target.configDir, "settings.json");
}

interface Settings {
  permissions?: { deny?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

async function readSettings(path: string): Promise<{ settings: Settings; raw: string | null }> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { settings: {}, raw: null };
    throw error;
  }
  try {
    return { settings: JSON.parse(raw) as Settings, raw };
  } catch {
    throw new Error(`${path} is not valid JSON; fix it before changing tools.`);
  }
}

export async function readDenyRules(target: Target): Promise<string[]> {
  const { settings } = await readSettings(settingsPath(target));
  const deny = settings.permissions?.deny;
  return Array.isArray(deny) ? deny.filter((rule): rule is string => typeof rule === "string") : [];
}

let queue: Promise<unknown> = Promise.resolve();

/** Adds or removes deny rules, keeping every other setting. Writes through symlinks atomically. */
export function updateDenyRules(
  target: Target,
  change: { add?: string[]; remove?: string[] },
): Promise<void> {
  const run = queue.then(async () => {
    const link = settingsPath(target);
    const path = await fs.realpath(link).catch(() => link);
    const { settings } = await readSettings(path);
    const current = Array.isArray(settings.permissions?.deny)
      ? (settings.permissions.deny as unknown[])
      : [];
    const remove = new Set(change.remove ?? []);
    const next = current.filter((rule) => typeof rule !== "string" || !remove.has(rule));
    for (const rule of change.add ?? []) if (!next.includes(rule)) next.push(rule);
    const permissions = { ...(settings.permissions ?? {}) };
    if (next.length) permissions.deny = next;
    else delete permissions.deny;
    const updated: Settings = { ...settings, permissions };
    await fs.mkdir(dirname(path), { recursive: true });
    const temp = `${path}.mcp-plugin-${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(updated, null, 2)}\n`);
    await fs.rename(temp, path);
  });
  queue = run.catch(() => undefined);
  return run;
}
