import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import { isOrchestratorMetadata } from "../shared/orchestrator";

export interface DirectoryAgent {
  id: string;
  title: string | null;
  status: PaseoAgent["status"];
  provider: string;
  model: string | null;
  workspaceId: string;
  createdAt: string;
  pendingPermissions: number;
}

export interface DirectoryWorkspace {
  id: string;
  name: string;
  directory: string | null;
  status: PaseoWorkspace["status"];
  orchestrator: boolean;
  agents: DirectoryAgent[];
}

/** The workspaces of one project, as seen from the agent calling a tool. */
export interface Directory {
  projectId: string;
  projectName: string;
  projectRoot: string;
  /** The caller's own workspace. */
  self: DirectoryWorkspace;
  workspaces: DirectoryWorkspace[];
  agentsById: Map<string, DirectoryAgent>;
}

export async function listAllWorkspaces(paseo: PaseoApi): Promise<PaseoWorkspace[]> {
  const all: PaseoWorkspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    all.push(...page.entries);
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

async function listAllAgents(paseo: PaseoApi): Promise<PaseoAgent[]> {
  const all: PaseoAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    all.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

/** Loads the project that `workspaceId` belongs to. */
export async function loadDirectory(paseo: PaseoApi, workspaceId: string): Promise<Directory> {
  const [allWorkspaces, allAgents] = await Promise.all([listAllWorkspaces(paseo), listAllAgents(paseo)]);
  const own = allWorkspaces.find((workspace) => workspace.id === workspaceId);
  if (!own) throw new Error("Your workspace was not found.");

  const projectWorkspaces = allWorkspaces.filter(
    (workspace) =>
      workspace.projectId === own.projectId &&
      (workspace.id === own.id || (!workspace.archivingAt && !workspace.background && !workspace.internal)),
  );
  const inProject = new Set(projectWorkspaces.map((workspace) => workspace.id));

  const agentsById = new Map<string, DirectoryAgent>();
  for (const agent of allAgents) {
    if (agent.archivedAt || agent.background || agent.internal) continue;
    if (!agent.workspaceId || !inProject.has(agent.workspaceId)) continue;
    agentsById.set(agent.id, {
      id: agent.id,
      title: agent.title,
      status: agent.status,
      provider: agent.provider,
      model: agent.model,
      workspaceId: agent.workspaceId,
      createdAt: agent.createdAt,
      pendingPermissions: agent.pendingPermissions.length,
    });
  }

  const workspaces = projectWorkspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    directory: workspace.workspaceDirectory ?? null,
    status: workspace.status,
    orchestrator: isOrchestratorMetadata(workspace.metadata),
    agents: [...agentsById.values()]
      .filter((agent) => agent.workspaceId === workspace.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  return {
    projectId: own.projectId,
    projectName: own.projectDisplayName,
    projectRoot: own.projectRootPath,
    self: workspaces.find((workspace) => workspace.id === own.id)!,
    workspaces,
    agentsById,
  };
}

/** The agent that speaks for a workspace: its oldest live agent, usually the one it was created with. */
export function primaryAgent(workspace: DirectoryWorkspace): DirectoryAgent | undefined {
  return workspace.agents[0];
}

export function workspaceOf(directory: Directory, agentId: string): DirectoryWorkspace | undefined {
  const workspaceId = directory.agentsById.get(agentId)?.workspaceId;
  return directory.workspaces.find((workspace) => workspace.id === workspaceId);
}

/** "Workspace name", or "Workspace name / agent title" when the workspace has several agents. */
export function agentLabel(directory: Directory, agentId: string): string {
  const agent = directory.agentsById.get(agentId);
  const workspace = workspaceOf(directory, agentId);
  const title = agent?.title ?? agentId.slice(0, 8);
  if (!workspace) return title;
  return workspace.agents.length > 1 ? `${workspace.name} / ${title}` : workspace.name;
}

export interface ResolvedTarget {
  agentId: string;
  label: string;
}

/**
 * Resolves a target inside the project: an agent id, a workspace id, an exact workspace name,
 * or a unique part of a name or directory. Throws with the candidates when it is ambiguous.
 */
export function resolveTarget(directory: Directory, target: string): ResolvedTarget {
  const query = target.trim();
  const lower = query.toLowerCase();

  const agent =
    directory.agentsById.get(query) ??
    [...directory.agentsById.values()].find((candidate) => query.length >= 6 && candidate.id.startsWith(query));
  if (agent) return { agentId: agent.id, label: agentLabel(directory, agent.id) };

  const candidates = directory.workspaces.filter((workspace) => workspace.id !== directory.self.id);
  const exact = candidates.filter((workspace) => workspace.id === query || workspace.name.toLowerCase() === lower);
  const matches =
    exact.length > 0
      ? exact
      : candidates.filter(
          (workspace) =>
            workspace.name.toLowerCase().includes(lower) || workspace.directory?.toLowerCase().endsWith(lower),
        );

  if (matches.length === 0) {
    throw new Error(
      `No workspace or agent in project ${directory.projectName} matches "${target}". Call orchestrator_overview to list them.`,
    );
  }
  if (matches.length > 1) {
    const names = matches.map((workspace) => `"${workspace.name}" (${workspace.id})`).join(", ");
    throw new Error(`"${target}" matches several workspaces: ${names}. Use a workspace id.`);
  }
  const workspace = matches[0]!;
  const primary = primaryAgent(workspace);
  if (!primary) {
    throw new Error(`Workspace "${workspace.name}" has no live agent. Start one with orchestrator_spawn or in Paseo.`);
  }
  return { agentId: primary.id, label: agentLabel(directory, primary.id) };
}
