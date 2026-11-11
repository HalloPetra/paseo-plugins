import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_ACCOUNT_ID, type LoginState } from "../shared/accounts";
import {
  addAccount,
  configDirFor,
  readProfile,
  readState,
  removeAccount,
  updateState,
} from "./store";

const execFileAsync = promisify(execFile);

/** A sign-in nobody finishes is abandoned after this long. */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
/** Finished sign-ins stay readable this long so the client sees the outcome. */
const RESULT_TTL_MS = 2 * 60 * 1000;
const URL_PATTERN = /https:\/\/\S+\/oauth\/authorize\?\S+/;

interface Login {
  state: LoginState;
  child: ChildProcessWithoutNullStreams | null;
  /** Created for this sign-in: removed again unless it succeeds. */
  createdAccount: boolean;
  /** Name the account after its email once signed in. */
  autoLabel: boolean;
  output: string;
  /** Length of `output` when a code was last submitted. */
  submittedAt: number | null;
  timer: NodeJS.Timeout | null;
}

const logins = new Map<string, Login>();

/** The daemon's PATH often lacks the user's shell additions, so look in the usual install spots. */
function findClaude(): string {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),
    join(homedir(), ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = join(dir, process.platform === "win32" ? "claude.exe" : "claude");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  throw new Error("Claude Code is not installed on the daemon machine (no `claude` on PATH).");
}

function envFor(accountId: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (accountId === DEFAULT_ACCOUNT_ID) {
    // Matches how agents run on the default login: Claude Code's own default location.
    return env;
  }
  return { ...env, CLAUDE_CONFIG_DIR: configDirFor(accountId) };
}

function finish(login: Login, patch: Partial<LoginState>): void {
  if (login.timer) clearTimeout(login.timer);
  login.timer = null;
  login.state = { ...login.state, ...patch };
  const child = login.child;
  login.child = null;
  if (child && child.exitCode === null) child.kill();
  const id = login.state.id;
  setTimeout(() => {
    if (logins.get(id) === login) logins.delete(id);
  }, RESULT_TTL_MS).unref();
}

async function discard(login: Login): Promise<void> {
  if (login.createdAccount) {
    await removeAccount(login.state.accountId).catch((error) =>
      console.error("Could not remove an abandoned account", error),
    );
  }
}

async function confirmSignIn(login: Login): Promise<void> {
  const { accountId } = login.state;
  let profile = readProfile(accountId);
  if (!profile.email) {
    // Older Claude Code versions write the profile lazily; ask the CLI instead.
    try {
      const { stdout } = await execFileAsync(findClaude(), ["auth", "status", "--json"], {
        env: envFor(accountId),
        timeout: 15_000,
      });
      const status = JSON.parse(stdout) as {
        loggedIn?: boolean;
        email?: string;
        subscriptionType?: string;
      };
      if (status.loggedIn) {
        profile = { email: status.email ?? null, plan: status.subscriptionType ?? null };
      }
    } catch (error) {
      console.error("Could not read auth status", error);
    }
  }
  if (!profile.email) {
    finish(login, { status: "failed", error: "Claude Code did not report a signed-in account." });
    await discard(login);
    return;
  }

  const state = await readState();
  const duplicate = state.accounts.find(
    (account) => account.id !== accountId && readProfile(account.id).email === profile.email,
  );
  if (duplicate && login.createdAccount) {
    finish(login, {
      status: "failed",
      error: `${profile.email} is already connected as "${duplicate.label}".`,
    });
    await discard(login);
    return;
  }

  if (login.autoLabel) {
    await updateState((current) => ({
      ...current,
      accounts: current.accounts.map((account) =>
        account.id === accountId ? { ...account, label: profile.email! } : account,
      ),
      // A fresh login is not limited, whatever the old one was.
      limitedUntil: Object.fromEntries(
        Object.entries(current.limitedUntil).filter(([id]) => id !== accountId),
      ),
    }));
  }
  finish(login, { status: "signed-in", email: profile.email, plan: profile.plan });
}

/** Starts `claude auth login` for an account, creating a new one when `accountId` is omitted. */
export async function startLogin(accountId?: string): Promise<LoginState> {
  const claude = findClaude();
  let createdAccount = false;
  let autoLabel = false;
  if (!accountId) {
    accountId = (await addAccount("New account")).id;
    createdAccount = true;
    autoLabel = true;
  } else {
    const state = await readState();
    if (!state.accounts.some((account) => account.id === accountId)) {
      throw new Error(`Unknown account ${accountId}`);
    }
  }

  // One sign-in per account at a time.
  for (const login of logins.values()) {
    if (login.state.accountId === accountId && login.child) {
      finish(login, { status: "canceled" });
    }
  }

  const child = spawn(claude, ["auth", "login", "--claudeai"], {
    env: envFor(accountId),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const login: Login = {
    state: {
      id: randomBytes(8).toString("hex"),
      accountId,
      status: "starting",
      url: null,
      email: null,
      plan: null,
      error: null,
    },
    child,
    createdAccount,
    autoLabel,
    output: "",
    submittedAt: null,
    timer: null,
  };
  logins.set(login.state.id, login);

  const onOutput = (chunk: Buffer) => {
    login.output = (login.output + chunk.toString("utf8")).slice(-8000);
    const url = URL_PATTERN.exec(login.output)?.[0];
    if (url && !login.state.url) {
      login.state = { ...login.state, status: "waiting", url };
    }
    // A rejected code: Claude Code reports it and keeps the process waiting for another.
    if (login.submittedAt !== null && login.state.status === "verifying") {
      const reply = login.output.slice(login.submittedAt);
      const problem = reply
        .split(/\r?\n/)
        .map((line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim())
        .find((line) => /invalid|error|fail|expired/i.test(line));
      if (problem) {
        login.submittedAt = null;
        login.state = { ...login.state, status: "waiting", error: problem };
      }
    }
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  child.on("error", (error) => {
    finish(login, { status: "failed", error: error.message });
    void discard(login);
  });
  child.on("exit", (code) => {
    if (login.child !== child) return; // Already finished: canceled or timed out.
    login.child = null;
    if (code === 0) {
      login.state = { ...login.state, status: "verifying" };
      void confirmSignIn(login);
      return;
    }
    const lastLine = login.output
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
      .trim()
      .split("\n")
      .pop()
      ?.replace(/^.*Paste code here if prompted >\s*/, "")
      .replace(/^Login failed:\s*/, "")
      .trim();
    finish(login, {
      status: "failed",
      error: lastLine && !URL_PATTERN.test(lastLine) ? lastLine : `Sign-in ended (exit ${code}).`,
    });
    void discard(login);
  });
  login.timer = setTimeout(() => {
    finish(login, { status: "failed", error: "Sign-in timed out." });
    void discard(login);
  }, LOGIN_TIMEOUT_MS);

  return login.state;
}

function get(loginId: string): Login {
  const login = logins.get(loginId);
  if (!login) throw new Error("This sign-in has expired. Start again.");
  return login;
}

export function loginState(loginId: string): LoginState {
  return get(loginId).state;
}

/** Feeds the code from the browser's fallback page to `claude auth login`. */
export function submitCode(loginId: string, code: string): LoginState {
  const login = get(loginId);
  if (!login.child) throw new Error("This sign-in is no longer waiting for a code.");
  login.submittedAt = login.output.length;
  login.child.stdin.write(`${code.trim()}\n`);
  login.state = { ...login.state, status: "verifying", error: null };
  return login.state;
}

export async function cancelLogin(loginId: string): Promise<void> {
  const login = logins.get(loginId);
  if (!login || !login.child) return;
  finish(login, { status: "canceled" });
  await discard(login);
}

export function cancelAllLogins(): void {
  for (const login of logins.values()) {
    if (login.child) {
      finish(login, { status: "canceled" });
      void discard(login);
    }
  }
}
