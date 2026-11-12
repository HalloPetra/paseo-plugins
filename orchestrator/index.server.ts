import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { onTurnEnded, rememberPaseo, sweep } from "./server/relay";
import { flushStore } from "./server/store";
import { orchestratorTools } from "./server/tools";
import { listAllWorkspaces } from "./server/directory";
import { isOrchestratorMetadata, projectOrchestratorRpc } from "./shared/orchestrator";

/** Retries queued deliveries and catches turn ends missed while the plugin was reloading. */
const SWEEP_MS = 15_000;

/** Whether each workspace is an orchestrator. The role is set at creation and never changes. */
const roles = new Map<string, boolean>();

async function isOrchestratorWorkspace(paseo: PaseoApi, workspaceId: string): Promise<boolean> {
  const known = roles.get(workspaceId);
  if (known !== undefined) return known;
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  const isOrchestrator = isOrchestratorMetadata(workspace?.metadata);
  roles.set(workspaceId, isOrchestrator);
  return isOrchestrator;
}

export default function contribute(server: PluginServerContext) {
  // Only agents in the orchestrator workspace get the tools; other workspaces receive messages as plain prompts.
  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    rememberPaseo(paseo);
    // `background` is newer than the SDK types this builds against.
    const background = (request as { background?: boolean }).background === true;
    if (background || request.purpose === "history" || !request.workspaceId) return;
    if (!(await isOrchestratorWorkspace(paseo, request.workspaceId))) return;
    return { ...request, tools: [...request.tools, ...orchestratorTools] };
  });

  // The setup-row toggle marks the workspace; name and pin it once it exists.
  server.addHook("workspace.create.after", async ({ workspace }, { paseo }) => {
    const isOrchestrator = isOrchestratorMetadata(workspace.metadata);
    roles.set(workspace.id, isOrchestrator);
    if (!isOrchestrator) return;
    const handle = paseo.workspaces.ref(workspace.id);
    await Promise.all([handle.setTitle("Orchestrator"), handle.setPinned(true)]).catch((error) =>
      console.error("[orchestrator] Setting up the orchestrator workspace failed", error),
    );
  });

  server.handle(projectOrchestratorRpc, async ({ projectId }, { paseo }) => {
    const workspaces = await listAllWorkspaces(paseo);
    const existing = workspaces.find(
      (workspace) => workspace.projectId === projectId && !workspace.archivingAt && isOrchestratorMetadata(workspace.metadata),
    );
    return { workspace: existing ? { id: existing.id, name: existing.name } : null };
  });

  server.addHook("agent.turn.after", async ({ agent, outcome }, { paseo }) => {
    rememberPaseo(paseo);
    await onTurnEnded(paseo, agent.id, outcome);
  });

  let sweeping = false;
  const timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    sweep()
      .catch((error) => console.error("[orchestrator] Sweep failed", error))
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_MS);

  return async () => {
    clearInterval(timer);
    await flushStore();
  };
}
