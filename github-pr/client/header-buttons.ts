import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { PrHeaderIcon } from "./header-button";
import { trackHeaderButton, untrackHeaderButton } from "./header-labels";

export const PANEL_ID = "pull-request";

/** Adds a PR button to the header of every git workspace, kept in sync with the workspace list. */
export function contributeHeaderButtons(client: PluginClientContext) {
  const buttons = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();

  const register = (workspace: { id: string; projectKind?: string }) => {
    if (lifetime.signal.aborted || buttons.has(workspace.id)) return;
    if (workspace.projectKind && workspace.projectKind !== "git") return;
    const workspaceId = workspace.id;
    const registration = client.addHeaderButton({
      id: "pull-request",
      workspaceId,
      button: {
        title: "Pull request",
        icon: PrHeaderIcon,
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel(PANEL_ID, { workspaceId, location: "explorer" });
          },
        },
      },
    });
    buttons.set(workspaceId, registration);
    trackHeaderButton(workspaceId, registration);
  };
  const unregister = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
    untrackHeaderButton(workspaceId);
  };
  const removeAll = () => {
    for (const [id, button] of buttons) {
      button.remove();
      untrackHeaderButton(id);
    }
    buttons.clear();
  };

  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) {
        void subscription.release();
        return;
      }
      const unsubscribe = subscription.subscribe({
        snapshot: ({ entries }) => {
          const ids = new Set(entries.map((w) => w.id));
          for (const id of [...buttons.keys()]) if (!ids.has(id)) unregister(id);
          for (const workspace of entries) register(workspace);
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "upsert") register(update.workspace);
          else unregister(update.id);
        },
      });
      lifetime.signal.addEventListener("abort", () => {
        unsubscribe();
        void subscription.release();
      });
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("[github-pr] workspace observation failed", error);
    });

  return () => {
    lifetime.abort();
    removeAll();
  };
}
