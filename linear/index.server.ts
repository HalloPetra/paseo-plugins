import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  browseIssues,
  listTeamStates,
  listTeams,
  resolveWorkspaceIssue,
  searchIssues,
  setIssueState,
} from "./server/issues";
import { browseIssuesRpc, listTeamsRpc } from "./shared/browse";
import { searchIssuesRpc } from "./shared/issues";
import { linearSettings } from "./shared/settings";
import { listTeamStatesRpc, resolveWorkspaceIssueRpc, setIssueStateRpc } from "./shared/status";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(linearSettings);
  server.handle(browseIssuesRpc, (input) => browseIssues(input, settings));
  server.handle(listTeamsRpc, () => listTeams(settings));
  server.handle(searchIssuesRpc, (input) => searchIssues(input, settings));
  server.handle(resolveWorkspaceIssueRpc, (input) => resolveWorkspaceIssue(input, settings));
  server.handle(listTeamStatesRpc, (input) => listTeamStates(input, settings));
  server.handle(setIssueStateRpc, (input) => setIssueState(input, settings));
  return () => {};
}
