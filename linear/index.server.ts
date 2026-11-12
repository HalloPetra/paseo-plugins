import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  browseIssues,
  listStateChoices,
  listTeamStates,
  listTeams,
  resolveWorkspaceIssue,
  searchIssues,
  setIssueState,
} from "./server/issues";
import { applyLifecycleStatus } from "./server/lifecycle";
import { browseIssuesRpc, listTeamsRpc } from "./shared/browse";
import { searchIssuesRpc } from "./shared/issues";
import { linearSettings } from "./shared/settings";
import {
  LINKED_ISSUE_KEY,
  listStateChoicesRpc,
  listTeamStatesRpc,
  resolveWorkspaceIssueRpc,
  setIssueStateRpc,
} from "./shared/status";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(linearSettings);
  server.handle(browseIssuesRpc, (input) => browseIssues(input, settings));
  server.handle(listTeamsRpc, () => listTeams(settings));
  server.handle(searchIssuesRpc, (input) => searchIssues(input, settings));
  server.handle(resolveWorkspaceIssueRpc, (input, context) => resolveWorkspaceIssue(input, settings, context));
  server.handle(listTeamStatesRpc, (input) => listTeamStates(input, settings));
  server.handle(setIssueStateRpc, (input) => setIssueState(input, settings));
  server.handle(listStateChoicesRpc, () => listStateChoices(settings));

  // The composer button tags the agent it starts; copy that onto the workspace so the header
  // button finds the issue, unless the workspace is already linked.
  // Also applies the "Workspace started" status rule to the picked issue.
  const stopCreateHook = server.addHook("agent.create.after", async ({ agent }, { paseo }) => {
    const linked = agent.metadata[LINKED_ISSUE_KEY];
    if (typeof linked !== "string") return;
    void applyLifecycleStatus("start", linked, settings);
    if (!agent.workspaceId) return;
    const workspace = paseo.workspaces.ref(agent.workspaceId);
    const current = (await workspace.refresh())?.metadata?.[LINKED_ISSUE_KEY];
    if (typeof current === "string" && current) return;
    await workspace.setMetadata({ [LINKED_ISSUE_KEY]: linked });
  });

  // Only explicit links (composer button or /link-linear) trigger; guessed issues are never written.
  const stopArchiveHook = server.addHook("workspace.archive.after", async ({ workspace }) => {
    await applyLifecycleStatus("archive", workspace.metadata[LINKED_ISSUE_KEY], settings);
  });

  return () => {
    stopCreateHook();
    stopArchiveHook();
  };
}
