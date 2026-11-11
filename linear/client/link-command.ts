import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LINKED_ISSUE_KEY } from "../shared/status";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,6}$/;
const FROM_URL = /linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d{1,6})/i;

/** `/link-linear PROD-123` (or a Linear URL) links the workspace; `/link-linear none` unlinks it. */
export function addLinkCommand(client: PluginClientContext) {
  return client.addSlashCommand({
    name: "link-linear",
    description: "Link this workspace to a Linear issue",
    argumentHint: "<PROD-123 | issue URL | none>",
    context: "workspace",
    async onSubmit({ args, workspace, paseo }) {
      const value = args.trim();
      const handle = paseo.workspaces.ref(workspace.id);
      if (/^(none|unlink|-)$/i.test(value)) {
        await handle.setMetadata({ [LINKED_ISSUE_KEY]: null });
        return;
      }
      const identifier = IDENTIFIER.test(value) ? value : FROM_URL.exec(value)?.[1];
      if (!identifier) throw new Error("Use an issue identifier like PROD-123, a Linear issue URL, or none");
      await handle.setMetadata({ [LINKED_ISSUE_KEY]: identifier.toUpperCase() });
    },
  });
}
