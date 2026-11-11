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
import { LINKED_ISSUE_KEY, listTeamStatesRpc, resolveWorkspaceIssueRpc, setIssueStateRpc } from "./shared/status";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(linearSettings);
  server.handle(browseIssuesRpc, (input) => browseIssues(input, settings));
  server.handle(listTeamsRpc, () => listTeams(settings));
  server.handle(searchIssuesRpc, (input) => searchIssues(input, settings));
  server.handle(resolveWorkspaceIssueRpc, (input, context) => resolveWorkspaceIssue(input, settings, context));
  server.handle(listTeamStatesRpc, (input) => listTeamStates(input, settings));
  server.handle(setIssueStateRpc, (input) => setIssueState(input, settings));

  // The composer button tags the agent it starts; copy that onto the workspace so the header
  // button finds the issue, unless the workspace is already linked.
  const stopHook = server.addHook("agent.create.after", async ({ agent }, { paseo }) => {
    const linked = agent.metadata[LINKED_ISSUE_KEY];
    if (typeof linked !== "string" || !agent.workspaceId) return;
    const workspace = paseo.workspaces.ref(agent.workspaceId);
    const current = (await workspace.refresh())?.metadata?.[LINKED_ISSUE_KEY];
    if (typeof current === "string" && current) return;
    await workspace.setMetadata({ [LINKED_ISSUE_KEY]: linked });
  });

  return () => stopHook();
}
