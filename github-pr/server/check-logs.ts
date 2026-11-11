import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { checkLogsItem, type searchCheckLogsRpc } from "../shared/check-logs";
import type { checkLogsRpc } from "../shared/pr";
import { run } from "./gh";

type Json = Record<string, any>;

const CONTEXT_BEFORE = 80;
const CONTEXT_AFTER = 10;
const TAIL_LINES = 200;
const MAX_JOB_CHARS = 30_000;
const MAX_TOTAL_CHARS = 150_000;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z ?/;

/** `gh run view --log` lines are "job\tstep\ttimestamp message". Keep only the message. */
function cleanLine(line: string): string {
  const parts = line.split("\t");
  const message = parts.length >= 3 ? parts.slice(2).join("\t") : line;
  return message.replace(TIMESTAMP, "").replace(ANSI, "");
}

/** The interesting part of a job log: context before the first error through the last error. */
/**
 * Collapse `##[group]…##[endgroup]` blocks without an error to their header (step inputs,
 * env listings, setup chatter) and drop runner action markers.
 */
function collapseGroups(lines: string[]): string[] {
  const out: string[] = [];
  let group: string[] | null = null;
  for (const line of lines) {
    if (/^##\[(start|end)-action\b/.test(line)) continue;
    if (line.startsWith("##[group]")) {
      if (group) out.push(...group);
      group = [line];
      continue;
    }
    if (line.startsWith("##[endgroup]") && group) {
      if (group.some((l) => l.includes("##[error]"))) out.push(...group);
      else out.push(`${group[0]!.replace("##[group]", "▸ ")}${group.length > 1 ? ` (${group.length - 1} lines)` : ""}`);
      group = null;
      continue;
    }
    (group ?? out).push(line);
  }
  if (group) out.push(...group);
  return out;
}

export function excerpt(log: string): string {
  const lines = collapseGroups(log.split("\n").map(cleanLine));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const errors = lines.flatMap((l, i) => (l.includes("##[error]") ? [i] : []));
  let start: number;
  let end: number;
  if (errors.length > 0) {
    start = Math.max(0, errors[0]! - CONTEXT_BEFORE);
    end = Math.min(lines.length, errors[errors.length - 1]! + CONTEXT_AFTER + 1);
  } else {
    start = Math.max(0, lines.length - TAIL_LINES);
    end = lines.length;
  }
  let text = lines.slice(start, end).join("\n");
  if (text.length > MAX_JOB_CHARS) text = "…\n" + text.slice(text.length - MAX_JOB_CHARS);
  return (start > 0 ? `… (${start} earlier lines omitted)\n` : "") + text;
}

function actionsJob(url: string | null): { repo: string; jobId: string } | null {
  const m = url && /github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)/.exec(url);
  return m ? { repo: m[1]!, jobId: m[2]! } : null;
}

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

interface FailingCheck {
  name: string;
  workflow: string | null;
  url: string | null;
  description: string | null;
}

function failingChecks(rollup: Json[]): FailingCheck[] {
  const out: FailingCheck[] = [];
  for (const c of rollup) {
    if (c.__typename === "StatusContext") {
      if (FAILED.has(String(c.state).toUpperCase()))
        out.push({ name: c.context, workflow: null, url: c.targetUrl || null, description: c.description || null });
    } else if (String(c.status).toUpperCase() === "COMPLETED" && FAILED.has(String(c.conclusion).toUpperCase())) {
      out.push({ name: c.name, workflow: c.workflowName || null, url: c.detailsUrl || null, description: String(c.conclusion).toLowerCase() });
    }
  }
  return out;
}

async function jobSection(check: FailingCheck, cwd: string): Promise<string> {
  const title = check.workflow ? `${check.workflow} / ${check.name}` : check.name;
  const header = [`## ${title}`, "", check.url ? `URL: ${check.url}` : null, check.description ? `Result: ${check.description}` : null]
    .filter((l) => l !== null)
    .join("\n");
  const job = actionsJob(check.url);
  if (!job) return `${header}\n\nNo logs available: this check does not run on GitHub Actions. Open its URL for details.`;

  const [annotations, log] = await Promise.all([
    run("gh", ["api", `repos/${job.repo}/check-runs/${job.jobId}/annotations`], cwd)
      .then((out) => JSON.parse(out) as Json[])
      .catch(() => [] as Json[]),
    run("gh", ["run", "view", "--repo", job.repo, "--job", job.jobId, "--log-failed"], cwd)
      .then((out) => (out.trim() ? out : run("gh", ["run", "view", "--repo", job.repo, "--job", job.jobId, "--log"], cwd)))
      .catch((error: unknown) => `Could not fetch the log: ${error instanceof Error ? error.message : String(error)}`),
  ]);

  const notes = annotations
    .filter((a) => a.annotation_level === "failure" || a.annotation_level === "warning")
    .map((a) => `- ${a.annotation_level}${a.path ? ` ${a.path}${a.start_line ? `:${a.start_line}` : ""}` : ""}: ${a.title ? `${a.title}: ` : ""}${a.message}`);
  return [
    header,
    notes.length ? `\n### Annotations\n\n${notes.join("\n")}` : "",
    `\n### Log\n\n\`\`\`text\n${excerpt(log)}\n\`\`\``,
  ].join("\n");
}

async function buildDocument(target: string[], cwd: string) {
  const pr: { number: number; url: string; title: string } & Json = JSON.parse(
    await run("gh", ["pr", "view", ...target, "--json", "number,title,url,headRefName,baseRefName,statusCheckRollup"], cwd),
  );
  const failing = failingChecks(pr.statusCheckRollup ?? []);
  const sections = await Promise.all(failing.map((c) => jobSection(c, cwd)));
  let text = [
    `# Failing checks for PR #${pr.number}: ${pr.title}`,
    "",
    `${pr.url} (${pr.headRefName} → ${pr.baseRefName})`,
    "",
    ...sections.flatMap((s) => [s, ""]),
  ].join("\n");
  if (text.length > MAX_TOTAL_CHARS) text = text.slice(0, MAX_TOTAL_CHARS) + "\n\n… (truncated)";
  return { pr, failing, text };
}

export async function checkLogs({ directory, number }: RpcInput<typeof checkLogsRpc>): Promise<RpcOutput<typeof checkLogsRpc>> {
  const { failing, text } = await buildDocument([String(number)], directory);
  return { text, failing: failing.map(({ name, workflow }) => ({ name, workflow })) };
}

export async function searchCheckLogs({ query }: RpcInput<typeof searchCheckLogsRpc>): Promise<RpcOutput<typeof searchCheckLogsRpc>> {
  const q = query.trim();
  const url = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(q);
  const short = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(q);
  const match = url ?? short;
  if (!match) return { items: [] };
  try {
    const { pr, failing, text } = await buildDocument([match[2]!, "--repo", match[1]!], process.cwd());
    if (failing.length === 0) return { items: [] };
    return { items: [checkLogsItem(pr, text)] };
  } catch (error) {
    console.error("[github-pr] check log search failed", error);
    return { items: [] };
  }
}
