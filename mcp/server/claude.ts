import { execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { envFor, type McpServerConfig } from "./targets";
import type { Target } from "../shared/mcp";

/** The daemon's PATH often lacks the user's shell additions, so look in the usual install spots. */
export function findClaude(): string {
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

/** Runs `claude mcp ...` and rejects with its output when it fails. */
export function runMcpCli(target: Target, cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      findClaude(),
      ["mcp", ...args],
      { cwd, env: envFor(target), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = `${stderr}\n${stdout}`.trim() || error.message;
          reject(new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export interface ProbedTool {
  name: string;
  annotations?: { readOnly?: boolean; destructive?: boolean };
}

export interface ProbedServer {
  name: string;
  status: string;
  error?: string;
  scope?: string;
  source?: string;
  transport?: string;
  config?: McpServerConfig;
  serverInfo?: { name?: string; version?: string };
  tools?: ProbedTool[];
}

export interface ProbeResult {
  servers: ProbedServer[];
  partial: boolean;
}

const PROBE_DEADLINE_MS = 20_000;
const POLL_MS = 750;

/**
 * Opens a headless Claude Code session without sending a prompt, so nothing is billed. Its control
 * protocol reports every MCP server with live status and tools, and toggles servers the way /mcp
 * does. `before` runs control requests first, such as a toggle.
 */
export function probe(
  target: Target,
  cwd: string,
  before: Record<string, unknown>[] = [],
): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      findClaude(),
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--settings",
        JSON.stringify({ disableAllHooks: true }),
      ],
      { cwd, env: envFor(target), stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "";
    let stderr = "";
    let settled = false;
    let counter = 0;
    let latest: ProbedServer[] | null = null;
    const pending = new Map<string, (response: Record<string, unknown>) => void>();
    const waiters = new Map<string, (error: Error) => void>();

    const finish = (error: Error | null, result?: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.stdin.end();
      setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 500).unref();
      if (error) reject(error);
      else resolve(result!);
    };

    const request = (body: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolveRequest, rejectRequest) => {
        const id = `req-${++counter}`;
        pending.set(id, resolveRequest);
        waiters.set(id, rejectRequest);
        child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: id, request: body })}\n`);
      });

    const deadline = setTimeout(() => {
      if (latest) finish(null, { servers: latest, partial: true });
      else finish(new Error(`Claude Code did not report MCP status in time. ${stderr.trim()}`.trim()));
    }, PROBE_DEADLINE_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message: { type?: string; response?: Record<string, unknown> };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type !== "control_response" || !message.response) continue;
        const id = String(message.response.request_id);
        const resolveRequest = pending.get(id);
        const rejectRequest = waiters.get(id);
        pending.delete(id);
        waiters.delete(id);
        if (message.response.subtype === "error") {
          rejectRequest?.(new Error(String(message.response.error ?? "Claude Code request failed")));
        } else {
          resolveRequest?.((message.response.response as Record<string, unknown>) ?? {});
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(`Claude Code exited (${code}). ${stderr.trim()}`.trim()));
    });

    void (async () => {
      await request({ subtype: "initialize" });
      for (const body of before) await request(body);
      while (!settled) {
        const response = await request({ subtype: "mcp_status" });
        latest = (response.mcpServers as ProbedServer[] | undefined) ?? [];
        if (!latest.some((server) => server.status === "pending")) {
          finish(null, { servers: latest, partial: false });
          return;
        }
        await new Promise((wait) => setTimeout(wait, POLL_MS));
      }
    })().catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}
