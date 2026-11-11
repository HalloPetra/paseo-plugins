import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Issue } from "../shared/browse";
import { LINKED_ISSUE_KEY, type resolveWorkspaceIssueRpc } from "../shared/status";
import type { createLinearClient } from "./linear";

type Linear = ReturnType<typeof createLinearClient>;
type Paseo = PluginHandlerContext["paseo"];
type Input = RpcInput<typeof resolveWorkspaceIssueRpc>;
export interface Resolution {
  issue: Issue | null;
  source: string | null;
}

/** `PROD-7238`, `prod-7238`; the key is checked against the workspace's real team keys. */
const IDENTIFIER = /\b([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,6})\b/g;
/** A bare number with Linear context: "linear issue 7238", "linear-6849", "issue #123". */
const CONTEXT_NUMBER = /\b(?:linear|issue|ticket)(?:[\s_:#-]+(?:issue|ticket))?[\s_:#-]*#?(\d{2,6})\b/gi;

const CACHE_MS = 10 * 60_000;
/** "No issue" needs the agent timelines to establish; check those less often. */
const MISS_CACHE_MS = 30 * 60_000;
const TEAMS_MS = 10 * 60_000;
const MAX_AGENTS = 4;

/** Which identifier a workspace maps to. The issue itself is always fetched fresh for its status. */
const resolved = new Map<string, { identifier: string | null; source: string | null; at: number }>();
let teamKeys: { keys: Set<string>; at: number } | null = null;

async function knownTeamKeys(linear: Linear): Promise<Set<string>> {
  if (!teamKeys || Date.now() - teamKeys.at > TEAMS_MS) {
    const { teams } = await linear.teams();
    teamKeys = { keys: new Set(teams.map((team) => team.key.toUpperCase())), at: Date.now() };
  }
  return teamKeys.keys;
}

function identifiersIn(text: string, keys: Set<string>): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(IDENTIFIER)) {
    const key = match[1].toUpperCase();
    if (keys.has(key)) found.push(`${key}-${Number(match[2])}`);
  }
  return found;
}

function contextNumbersIn(text: string): number[] {
  return [...text.matchAll(CONTEXT_NUMBER)].map((match) => Number(match[1]));
}

/** Tries `KEY-n` for every team; when several exist, the most recently updated wins. */
async function issueForNumber(linear: Linear, keys: Set<string>, number: number): Promise<Issue | null> {
  const found = (await Promise.all([...keys].map((key) => linear.issue(`${key}-${number}`)))).filter(
    (issue): issue is Issue => issue !== null,
  );
  return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

async function firstExisting(linear: Linear, identifiers: Iterable<string>): Promise<Issue | null> {
  for (const identifier of new Set(identifiers)) {
    const issue = await linear.issue(identifier);
    if (issue) return issue;
  }
  return null;
}

interface AgentEvidence {
  /** Identifiers stored on agents by the composer button. */
  linked: string[];
  /** Weighted mentions: identifier -> score. */
  scores: Map<string, number>;
  numbers: Map<number, number>;
}

/** Reads how the workspace's first agents started: the first message and its Linear tool calls. */
async function agentEvidence(paseo: Paseo, workspaceId: string, keys: Set<string>): Promise<AgentEvidence> {
  const evidence: AgentEvidence = { linked: [], scores: new Map(), numbers: new Map() };
  const { entries } = await paseo.agents.list({ filter: { includeArchived: true } });
  const agents = entries
    .map((entry) => entry.agent)
    .filter((agent) => agent.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, MAX_AGENTS);

  const add = (text: string, weight: number) => {
    for (const identifier of identifiersIn(text, keys)) {
      evidence.scores.set(identifier, (evidence.scores.get(identifier) ?? 0) + weight);
    }
    for (const number of contextNumbersIn(text)) {
      evidence.numbers.set(number, (evidence.numbers.get(number) ?? 0) + weight);
    }
  };

  for (const agent of agents) {
    const linked = agent.metadata?.[LINKED_ISSUE_KEY];
    if (typeof linked === "string") evidence.linked.push(linked);
    let page;
    try {
      page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: 0 });
    } catch (error) {
      console.warn(`[linear] could not read timeline of agent ${agent.id}`, error);
      continue;
    }
    // Only the first turn: the message that started the chat and the Linear lookups it caused.
    // Later discussion often mentions other issues and would cause false matches.
    let userMessages = 0;
    for (const { item } of page.entries) {
      if (item.type === "user_message") {
        userMessages += 1;
        if (userMessages > 1) break;
        add(item.text, 10);
      } else if (item.type === "tool_call" && /linear/i.test(item.name)) {
        add(JSON.stringify(item.detail), 4);
      }
    }
  }
  return evidence;
}

function ranked<T>(scores: Map<T, number>): T[] {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
}

/**
 * Signals, strongest first:
 * 1. an explicit link (workspace metadata, or an agent the composer button tagged),
 * 2. the issue Linear links to the PR,
 * 3. an identifier in the branch, PR title or workspace name,
 * 4. Linear's own branch matching,
 * 5. "linear issue 7238"-style numbers in those names,
 * 6. the first message of the workspace's agents and the Linear tool calls in that first turn.
 */
async function findIdentifier(input: Input, linear: Linear, paseo: Paseo): Promise<Resolution> {
  if (input.linked) {
    const issue = await linear.issue(input.linked);
    if (issue) return { issue, source: "link" };
  }
  const keys = await knownTeamKeys(linear);
  const texts = [...input.branches, ...input.names];

  if (input.prUrl) {
    const issue = await linear.resolveWorkspaceIssue({ prUrl: input.prUrl, branches: [] });
    if (issue) return { issue, source: "pull request" };
  }

  const named = await firstExisting(linear, texts.flatMap((text) => identifiersIn(text, keys)));
  if (named) return { issue: named, source: "name" };

  if (input.branches.length > 0) {
    const issue = await linear.resolveWorkspaceIssue({ prUrl: null, branches: input.branches });
    if (issue) return { issue, source: "branch" };
  }

  for (const number of new Set(texts.flatMap(contextNumbersIn))) {
    const issue = await issueForNumber(linear, keys, number);
    if (issue) return { issue, source: "name" };
  }

  const evidence = await agentEvidence(paseo, input.workspaceId, keys);
  const tagged = await firstExisting(linear, evidence.linked);
  if (tagged) return { issue: tagged, source: "link" };
  const mentioned = await firstExisting(linear, ranked(evidence.scores).slice(0, 3));
  if (mentioned) return { issue: mentioned, source: "agent" };
  for (const number of ranked(evidence.numbers).slice(0, 3)) {
    const issue = await issueForNumber(linear, keys, number);
    if (issue) return { issue, source: "agent" };
  }
  return { issue: null, source: null };
}

export async function resolveWorkspaceIssue(input: Input, linear: Linear, paseo: Paseo): Promise<Resolution> {
  const cacheKey = JSON.stringify(input);
  const cached = resolved.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.identifier ? CACHE_MS : MISS_CACHE_MS)) {
    // Known mapping: only refresh the issue itself, so status changes in Linear show up.
    if (!cached.identifier) return { issue: null, source: null };
    const issue = await linear.issue(cached.identifier);
    if (issue) return { issue, source: cached.source };
  }
  const result = await findIdentifier(input, linear, paseo);
  resolved.set(cacheKey, { identifier: result.issue?.identifier ?? null, source: result.source, at: Date.now() });
  return result;
}
