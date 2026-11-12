import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { type browseIssuesRpc, issueAttachmentItem } from "../shared/browse";
import type { searchIssuesRpc } from "../shared/issues";
import type { listTeamStatesRpc, resolveWorkspaceIssueRpc, setIssueStateRpc } from "../shared/status";
import type { linearSettings } from "../shared/settings";
import { createLinearClient } from "./linear";
import { resolveWorkspaceIssue as resolveIssue } from "./resolve";

declare const process: { env: Record<string, string | undefined> };

export type LinearSettings = PluginSettings<typeof linearSettings.schema>;

export async function client(settings: LinearSettings) {
  const state = await settings.read();
  const saved = state.status === "ready" ? state.values.apiKey.trim() : "";
  return createLinearClient({ apiKey: saved || (process.env.LINEAR_API_KEY ?? "") });
}

export async function browseIssues(input: RpcInput<typeof browseIssuesRpc>, settings: LinearSettings) {
  return (await client(settings)).browse(input);
}

export async function listTeams(settings: LinearSettings) {
  return (await client(settings)).teams();
}

/** The "+" menu picker: open issues when empty, any status while searching. */
export async function searchIssues({ query }: RpcInput<typeof searchIssuesRpc>, settings: LinearSettings) {
  const trimmed = query.trim();
  const { issues } = await (await client(settings)).browse({
    query: trimmed,
    teamId: null,
    stateTypes: trimmed ? [] : ["triage", "unstarted", "started"],
    assignee: "any",
    sort: "updated",
  });
  return { items: issues.slice(0, 30).map(issueAttachmentItem) };
}

export async function resolveWorkspaceIssue(
  input: RpcInput<typeof resolveWorkspaceIssueRpc>,
  settings: LinearSettings,
  { paseo }: PluginHandlerContext,
) {
  return resolveIssue(input, await client(settings), paseo);
}

export async function listTeamStates({ teamId }: RpcInput<typeof listTeamStatesRpc>, settings: LinearSettings) {
  return (await client(settings)).teamStates(teamId);
}

export async function listStateChoices(settings: LinearSettings) {
  return (await client(settings)).stateChoices();
}

export async function setIssueState(
  { issueId, stateId }: RpcInput<typeof setIssueStateRpc>,
  settings: LinearSettings,
) {
  return { issue: await (await client(settings)).setIssueState(issueId, stateId) };
}
