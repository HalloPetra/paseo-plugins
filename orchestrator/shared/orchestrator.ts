import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Workspace metadata key that marks a project's orchestrator workspace. */
export const ROLE_KEY = "orchestrator.role";
export const ORCHESTRATOR_ROLE = "orchestrator";

export function isOrchestratorMetadata(metadata: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return metadata?.[ROLE_KEY] === ORCHESTRATOR_ROLE;
}

/** The project's existing orchestrator workspace, if any; a project has at most one. */
export const projectOrchestratorRpc = defineRpc({
  name: "orchestrator.project",
  input: z.object({ projectId: z.string() }),
  output: z.object({
    workspace: z.object({ id: z.string(), name: z.string() }).nullable(),
  }),
});
