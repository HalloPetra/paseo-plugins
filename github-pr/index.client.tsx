import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PANEL_ID, contributeHeaderButtons } from "./client/header-buttons";
import { PrPanel } from "./client/pr-panel";
import { checkLogsAttachments } from "./shared/check-logs";

export default function contribute(client: PluginClientContext) {
  // Required for composer.addAttachment; also adds "Failing check logs" to the composer's "+" menu.
  client.addAttachmentSource(checkLogsAttachments);
  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Pull request",
    icon: "GitPullRequest",
    locations: ["explorer", "workspace"],
    Component: PrPanel,
  });
  client.addCommandCenterItem({
    id: "open-pull-request",
    title: "Show pull request",
    icon: "GitPullRequest",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID, { location: "explorer" });
    },
  });
  const removeHeaderButtons = contributeHeaderButtons(client);
  return () => {
    removeHeaderButtons();
  };
}
