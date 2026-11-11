import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A small disk cache so spaces, folders, and meeting attendees survive plugin reloads and daemon
 * restarts. Entries are grouped by a hash of the API key; the key itself is never written.
 */
const pluginHome = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "granola");
const cachePath = join(pluginHome, "cache.json");
const VERSION = 1;
/** Attendee lists kept per account; the oldest are dropped past this. */
const MAX_NOTES = 2000;

export interface CachedPerson {
  email: string;
  name: string | null;
}

export interface NoteMeta {
  /** The note's `updated_at`; a newer one means the attendees may have changed. */
  updatedAt: string;
  people: CachedPerson[];
}

export interface Locations {
  at: number;
  spaces: { id: string; name: string }[];
  folders: { id: string; name: string; parentId: string | null; spaceId: string | null }[];
}

interface Account {
  locations?: Locations;
  notes: Record<string, NoteMeta>;
}

interface CacheFile {
  version: number;
  accounts: Record<string, Account>;
}

let loaded: Promise<CacheFile> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

function load(): Promise<CacheFile> {
  loaded ??= fs
    .readFile(cachePath, "utf8")
    .then((text) => {
      const parsed = JSON.parse(text) as CacheFile;
      return parsed.version === VERSION && parsed.accounts ? parsed : { version: VERSION, accounts: {} };
    })
    .catch(() => ({ version: VERSION, accounts: {} }));
  return loaded;
}

export function accountId(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export async function account(apiKey: string): Promise<Account> {
  const file = await load();
  const id = accountId(apiKey);
  file.accounts[id] ??= { notes: {} };
  return file.accounts[id]!;
}

/** Writes soon after the last change; several updates in a burst become one write. */
export function scheduleSave(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writing = writing.then(save, save);
  }, 500);
}

async function save(): Promise<void> {
  const file = await load();
  for (const acc of Object.values(file.accounts)) {
    const ids = Object.keys(acc.notes);
    if (ids.length <= MAX_NOTES) continue;
    ids
      .sort((a, b) => acc.notes[a]!.updatedAt.localeCompare(acc.notes[b]!.updatedAt))
      .slice(0, ids.length - MAX_NOTES)
      .forEach((id) => delete acc.notes[id]);
  }
  try {
    await fs.mkdir(pluginHome, { recursive: true, mode: 0o700 });
    const tmp = `${cachePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, cachePath);
  } catch (error) {
    console.error("Could not write the Granola cache", error);
  }
}

/** Flushes a pending write; called when the plugin stops. */
export async function flush(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    writing = writing.then(save, save);
  }
  await writing;
}
