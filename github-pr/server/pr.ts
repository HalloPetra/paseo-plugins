import { execFile } from "node:child_process";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { Check, PrComment, getPrRpc } from "../shared/pr";

// The daemon may not inherit the login shell PATH, so include common gh locations.
const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
  .filter(Boolean)
  .join(":");

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, env: { ...process.env, PATH, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" }, maxBuffer: 20 * 1024 * 1024, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

const PR_FIELDS = [
  "number", "title", "body", "url", "state", "isDraft", "author", "headRefName", "baseRefName",
  "additions", "deletions", "changedFiles", "mergeable", "mergeStateStatus", "reviewDecision",
  "statusCheckRollup", "comments", "reviews",
].join(",");

type Json = Record<string, any>;

function normalizeCheck(raw: Json): Check {
  // CheckRun: { __typename: "CheckRun", name, status, conclusion, detailsUrl, workflowName }
  // StatusContext: { __typename: "StatusContext", context, state, targetUrl, description }
  if (raw.__typename === "StatusContext") {
    const state = String(raw.state ?? "").toUpperCase();
    return {
      name: raw.context ?? "status",
      workflow: null,
      status:
        state === "SUCCESS" ? "success"
        : state === "FAILURE" || state === "ERROR" ? "failure"
        : "pending",
      detail: raw.description || null,
      url: raw.targetUrl || null,
    };
  }
  const status = String(raw.status ?? "").toUpperCase();
  const conclusion = String(raw.conclusion ?? "").toUpperCase();
  let normalized: Check["status"] = "pending";
  if (status === "COMPLETED") {
    if (conclusion === "SUCCESS") normalized = "success";
    else if (conclusion === "SKIPPED") normalized = "skipped";
    else if (conclusion === "NEUTRAL") normalized = "neutral";
    else normalized = "failure";
  }
  return {
    name: raw.name ?? "check",
    workflow: raw.workflowName || null,
    status: normalized,
    detail: status === "COMPLETED" ? conclusion.toLowerCase() || null : status.toLowerCase() || null,
    url: raw.detailsUrl || null,
  };
}

const CHECK_ORDER: Record<Check["status"], number> = { failure: 0, pending: 1, success: 2, neutral: 3, skipped: 4 };

async function inlineComments(cwd: string, number: number): Promise<PrComment[]> {
  try {
    const out = await run(
      "gh",
      ["api", "--paginate", `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`],
      cwd,
    );
    // --paginate concatenates JSON arrays; normalize "][" boundaries.
    const items: Json[] = JSON.parse(`[${out.trim().replace(/\]\s*\[/g, ",").replace(/^\[|\]$/g, "")}]`);
    return items.map((c) => ({
      id: `inline-${c.id}`,
      kind: "inline" as const,
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      createdAt: c.created_at ?? "",
      url: c.html_url ?? null,
      reviewState: null,
      path: c.path ?? null,
      line: typeof c.line === "number" ? c.line : typeof c.original_line === "number" ? c.original_line : null,
    }));
  } catch (error) {
    console.error("[github-pr] inline comments failed", error);
    return [];
  }
}

export async function getPr({ directory }: RpcInput<typeof getPrRpc>): Promise<RpcOutput<typeof getPrRpc>> {
  let branch: string | null = null;
  try {
    branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], directory)).trim() || null;
  } catch {
    return { pr: null, branch: null, error: "This workspace is not a git repository." };
  }

  let raw: Json;
  try {
    raw = JSON.parse(await run("gh", ["pr", "view", "--json", PR_FIELDS], directory));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no pull requests found|no open pull requests/i.test(message)) {
      return { pr: null, branch, error: null };
    }
    return { pr: null, branch, error: message };
  }

  const comments: PrComment[] = [
    ...((raw.comments ?? []) as Json[]).map((c, i) => ({
      id: c.id ?? `comment-${i}`,
      kind: "comment" as const,
      author: c.author?.login ?? "unknown",
      body: c.body ?? "",
      createdAt: c.createdAt ?? "",
      url: c.url ?? null,
      reviewState: null,
      path: null,
      line: null,
    })),
    ...((raw.reviews ?? []) as Json[])
      // Skip empty "COMMENTED" reviews; those are just containers for inline comments.
      .filter((r) => (r.body ?? "").trim() !== "" || r.state !== "COMMENTED")
      .map((r, i) => ({
        id: r.id ?? `review-${i}`,
        kind: "review" as const,
        author: r.author?.login ?? "unknown",
        body: r.body ?? "",
        createdAt: r.submittedAt ?? "",
        url: null,
        reviewState: r.state ?? null,
        path: null,
        line: null,
      })),
    ...(await inlineComments(directory, raw.number)),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const checks = ((raw.statusCheckRollup ?? []) as Json[])
    .map(normalizeCheck)
    .sort((a, b) => CHECK_ORDER[a.status] - CHECK_ORDER[b.status] || a.name.localeCompare(b.name));

  return {
    branch,
    error: null,
    pr: {
      number: raw.number,
      title: raw.title ?? "",
      body: raw.body ?? "",
      url: raw.url ?? "",
      state: raw.state ?? "UNKNOWN",
      isDraft: Boolean(raw.isDraft),
      author: raw.author?.login ?? "unknown",
      headRefName: raw.headRefName ?? "",
      baseRefName: raw.baseRefName ?? "",
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changedFiles: raw.changedFiles ?? 0,
      mergeable: raw.mergeable ?? "UNKNOWN",
      mergeStateStatus: raw.mergeStateStatus ?? "UNKNOWN",
      reviewDecision: raw.reviewDecision || null,
      checks,
      comments,
    },
  };
}
