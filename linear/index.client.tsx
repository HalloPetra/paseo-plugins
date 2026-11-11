import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LinearComposerItem } from "./client/composer-item";
import { startHeaderStatus } from "./client/header-status";
import { LinearSettings } from "./client/settings";
import { issueAttachments } from "./shared/issues";

export default function contribute(client: PluginClientContext) {
  // Required for composer.addAttachment; it also adds "Linear issue" to the "+" menu.
  client.addAttachmentSource(issueAttachments);
  client.addComposerItem({ id: "linear-issue", Component: LinearComposerItem });
  client.addSettingsScreen({ id: "linear", title: "Linear", icon: "KeyRound", Component: LinearSettings });
  const stopHeaderStatus = startHeaderStatus(client);
  return () => stopHeaderStatus();
}
