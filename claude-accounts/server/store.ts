import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_ACCOUNT_ID, type Account, type Preferences } from "../shared/accounts";

const storedAccountSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
});

const stateSchema = z.object({
  version: z.literal(1),
  accounts: z.array(storedAccountSchema),
  activeId: z.string(),
  /** Account id → ISO time the account's usage limit resets. */
  limitedUntil: z.record(z.string(), z.string()),
  autoSwitch: z.boolean(),
  resumePrompt: z.string(),
});
export type State = z.infer<typeof stateSchema>;
type StoredAccount = z.infer<typeof storedAccountSchema>;

export const DEFAULT_RESUME_PROMPT =
  "The previous turn stopped because a usage limit was reached. Continue where you left off.";

const DEFAULT_STATE: State = {
  version: 1,
  accounts: [{ id: DEFAULT_ACCOUNT_ID, label: "Default login", createdAt: new Date(0).toISOString() }],
  activeId: DEFAULT_ACCOUNT_ID,
  limitedUntil: {},
  autoSwitch: true,
  resumePrompt: DEFAULT_RESUME_PROMPT,
};

/** Never shared between accounts: they hold the login itself. */
function isPerAccountEntry(name: string): boolean {
  return name === ".credentials.json" || name.startsWith(".claude.json");
}

const pluginHome = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "claude-accounts");
const statePath = join(pluginHome, "state.json");
const accountsDir = join(pluginHome, "accounts");

/** The config dir Claude Code uses without this plugin. History and settings live here. */
export const sharedConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

export function configDirFor(id: string): string {
  return id === DEFAULT_ACCOUNT_ID ? sharedConfigDir : join(accountsDir, id);
}

function globalConfigPath(id: string): string {
  // Claude Code keeps its global config beside the config dir only when CLAUDE_CONFIG_DIR is set.
  if (id === DEFAULT_ACCOUNT_ID && !process.env.CLAUDE_CONFIG_DIR) {
    return join(homedir(), ".claude.json");
  }
  return join(configDirFor(id), ".claude.json");
}

export interface Profile {
  email: string | null;
  plan: string | null;
}

/** The signed-in Claude account, from the profile Claude Code caches in its global config. */
export function readProfile(id: string): Profile {
  try {
    const raw = JSON.parse(readFileSync(globalConfigPath(id), "utf8")) as {
      oauthAccount?: { emailAddress?: unknown; planDisplayName?: unknown };
    };
    const email = raw.oauthAccount?.emailAddress;
    const plan = raw.oauthAccount?.planDisplayName;
    return {
      email: typeof email === "string" && email ? email : null,
      plan: typeof plan === "string" && plan ? plan : null,
    };
  } catch {
    return { email: null, plan: null };
  }
}

/**
 * Links everything in the shared config dir (settings, history, projects, skills, plugins) into an
 * account's config dir, so a session started on one account resumes on another. The login files
 * stay per account. Existing entries are left alone. Synchronous because it runs inside the
 * session-open hook and touches only a few directory entries.
 */
export function linkSharedEntries(id: string): void {
  if (id === DEFAULT_ACCOUNT_ID) return;
  const dir = configDirFor(id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  mkdirSync(join(sharedConfigDir, "projects"), { recursive: true });
  for (const name of readdirSync(sharedConfigDir)) {
    if (isPerAccountEntry(name)) continue;
    const target = join(dir, name);
    try {
      lstatSync(target);
      continue;
    } catch {
      // Missing: link it.
    }
    try {
      symlinkSync(join(sharedConfigDir, name), target);
    } catch (error) {
      console.error(`Could not link ${name} into account ${id}`, error);
    }
  }
}

let cached: State | null = null;

export async function readState(): Promise<State> {
  if (cached) return cached;
  let state = DEFAULT_STATE;
  try {
    const parsed = stateSchema.safeParse(JSON.parse(await fs.readFile(statePath, "utf8")));
    if (parsed.success) state = parsed.data;
    else console.error("Ignoring invalid state file", parsed.error.message);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Could not read state file", error);
    }
  }
  if (!state.accounts.some((account) => account.id === DEFAULT_ACCOUNT_ID)) {
    state = { ...state, accounts: [DEFAULT_STATE.accounts[0]!, ...state.accounts] };
  }
  if (!state.accounts.some((account) => account.id === state.activeId)) {
    state = { ...state, activeId: DEFAULT_ACCOUNT_ID };
  }
  cached = state;
  return state;
}

let writing: Promise<void> = Promise.resolve();

/** Applies `change` to the latest state and persists it. Updates are serialized. */
export function updateState(change: (state: State) => State): Promise<State> {
  const run = writing.then(async () => {
    const next = change(await readState());
    cached = next;
    await fs.mkdir(pluginHome, { recursive: true, mode: 0o700 });
    const tmp = `${statePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(tmp, statePath);
    return next;
  });
  writing = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function limitedUntil(state: State, id: string, now = Date.now()): string | null {
  const until = state.limitedUntil[id];
  return until && Date.parse(until) > now ? until : null;
}

export function isSignedIn(id: string): boolean {
  if (readProfile(id).email) return true;
  // The default login may predate the oauthAccount field; trust that it works.
  return id === DEFAULT_ACCOUNT_ID;
}

export function describeAccount(state: State, account: StoredAccount): Account {
  const profile = readProfile(account.id);
  return {
    id: account.id,
    label: account.label,
    isDefault: account.id === DEFAULT_ACCOUNT_ID,
    configDir: configDirFor(account.id),
    email: profile.email,
    plan: profile.plan,
    limitedUntil: limitedUntil(state, account.id),
    active: state.activeId === account.id,
  };
}

export function preferencesOf(state: State): Preferences {
  return { autoSwitch: state.autoSwitch, resumePrompt: state.resumePrompt };
}

export function labelOf(state: State, id: string): string {
  return state.accounts.find((account) => account.id === id)?.label ?? id;
}

function slug(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${base || "account"}-${randomBytes(3).toString("hex")}`;
}

export async function addAccount(label: string): Promise<Account> {
  const account: StoredAccount = {
    id: slug(label.trim()),
    label: label.trim(),
    createdAt: new Date().toISOString(),
  };
  const state = await updateState((state) => ({
    ...state,
    accounts: [...state.accounts, account],
  }));
  linkSharedEntries(account.id);
  return describeAccount(state, account);
}

export async function renameAccount(id: string, label: string): Promise<void> {
  await updateState((state) => {
    if (!state.accounts.some((account) => account.id === id)) {
      throw new Error(`Unknown account ${id}`);
    }
    return {
      ...state,
      accounts: state.accounts.map((account) =>
        account.id === id ? { ...account, label: label.trim() } : account,
      ),
    };
  });
}

export async function removeAccount(id: string): Promise<void> {
  if (id === DEFAULT_ACCOUNT_ID) throw new Error("The default login cannot be removed.");
  await updateState((state) => {
    const { [id]: _removed, ...limited } = state.limitedUntil;
    return {
      ...state,
      accounts: state.accounts.filter((account) => account.id !== id),
      activeId: state.activeId === id ? DEFAULT_ACCOUNT_ID : state.activeId,
      limitedUntil: limited,
    };
  });
  const dir = configDirFor(id);
  // Only ever delete inside the plugin's own accounts directory. fs.rm does not follow the
  // symlinks into the shared config dir; it removes the links themselves.
  if (dir.startsWith(accountsDir + "/") && existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
