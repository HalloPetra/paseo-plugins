import type { PluginServerContext } from "@getpaseo/plugin/server";
import { browseIssues, listTeams, searchIssues } from "./server/issues";
import { browseIssuesRpc, listTeamsRpc } from "./shared/browse";
import { searchIssuesRpc } from "./shared/issues";
import { linearSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(linearSettings);
  server.handle(browseIssuesRpc, (input) => browseIssues(input, settings));
  server.handle(listTeamsRpc, () => listTeams(settings));
  server.handle(searchIssuesRpc, (input) => searchIssues(input, settings));
  return () => {};
}
