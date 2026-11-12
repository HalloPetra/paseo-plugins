import type { PluginClientContext } from "@getpaseo/plugin/client";
import { OrchestratorMessageCard, messageSchema } from "./client/message-card";
import { OrchestratorToggle } from "./client/orchestrator-toggle";
import { parseBatch } from "./shared/envelope";

export default function contribute(client: PluginClientContext) {
  // Messages from other workspaces arrive as prompts; show them as cards instead of raw envelopes.
  const removeTransformer = client.addTimelineTransformer({
    id: "orchestrator-message",
    query: { itemType: "user_message" },
    transform({ item }) {
      const envelopes = parseBatch(item.text);
      if (!envelopes) return undefined;
      return {
        // No `id`: Paseo derives `<sourceItemId>/<index>`, unique per prompt.
        items: envelopes.map((envelope) => ({
          type: "plugin" as const,
          kind: "orchestrator-message",
          version: 1,
          data: {
            kind: envelope.kind,
            from: envelope.from,
            threadId: envelope.threadId,
            expectsReply: envelope.expectsReply,
            body: envelope.body,
          },
        })),
      };
    },
  });
  const removeRenderer = client.addTimelineRenderer({
    kind: "orchestrator-message",
    version: 1,
    schema: messageSchema,
    Component: OrchestratorMessageCard,
  });
  const removeToggle = client.addNewWorkspaceItem({ id: "orchestrator", Component: OrchestratorToggle });
  return () => {
    removeTransformer();
    removeRenderer();
    removeToggle();
  };
}
