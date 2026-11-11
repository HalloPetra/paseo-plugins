import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { LoginState, Target } from "../shared/mcp";
import { findClaude, runMcpCli } from "./claude";
import { envFor } from "./targets";

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const RESULT_TTL_MS = 2 * 60 * 1000;
const URL_PATTERN = /https:\/\/[^\s"'<>]+/;

interface Login {
  state: LoginState;
  child: ChildProcess | null;
  timer: NodeJS.Timeout | null;
}

const logins = new Map<string, Login>();

function finish(login: Login, status: LoginState["status"]): void {
  if (login.state.status !== "running") return;
  login.state = { ...login.state, status };
  if (login.timer) clearTimeout(login.timer);
  login.timer = null;
  const child = login.child;
  login.child = null;
  if (child && child.exitCode === null) child.kill();
  const id = login.state.id;
  setTimeout(() => {
    if (logins.get(id) === login) logins.delete(id);
  }, RESULT_TTL_MS).unref();
}

/**
 * Runs `claude mcp login`, which opens the browser on the daemon machine and waits for the OAuth
 * callback. The printed URL is surfaced too, for when the browser does not open.
 */
export async function startLogin(
  target: Target,
  cwd: string,
  name: string,
  logoutFirst: boolean,
): Promise<LoginState> {
  for (const login of logins.values()) {
    if (login.state.server === name && login.state.status === "running") finish(login, "canceled");
  }
  if (logoutFirst) {
    // Fails when there are no stored credentials, which is fine.
    await runMcpCli(target, cwd, ["logout", name]).catch(() => undefined);
  }
  const login: Login = {
    state: {
      id: randomBytes(8).toString("hex"),
      server: name,
      status: "running",
      url: null,
      output: "",
    },
    child: null,
    timer: null,
  };
  logins.set(login.state.id, login);
  const child = spawn(findClaude(), ["mcp", "login", name], {
    cwd,
    env: envFor(target),
    stdio: ["ignore", "pipe", "pipe"],
  });
  login.child = child;
  const append = (chunk: Buffer) => {
    const output = (login.state.output + chunk.toString("utf8")).slice(-4000);
    const url = login.state.url ?? output.match(URL_PATTERN)?.[0] ?? null;
    login.state = { ...login.state, output, url };
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (error) => {
    login.state = { ...login.state, output: `${login.state.output}\n${error.message}`.trim() };
    finish(login, "failed");
  });
  child.on("exit", (code) => finish(login, code === 0 ? "succeeded" : "failed"));
  login.timer = setTimeout(() => finish(login, "failed"), LOGIN_TIMEOUT_MS);
  login.timer.unref();
  return login.state;
}

export function loginState(id: string): LoginState {
  const login = logins.get(id);
  if (!login) throw new Error("This sign-in has expired.");
  return login.state;
}

export function cancelLogin(id: string): void {
  const login = logins.get(id);
  if (login) finish(login, "canceled");
}

export function cancelAllLogins(): void {
  for (const login of logins.values()) finish(login, "canceled");
}
