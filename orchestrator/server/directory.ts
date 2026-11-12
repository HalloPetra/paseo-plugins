import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";

export interface DirectoryAgent {
  id: string;
  title: string | null;
  status: PaseoAgent["status"];
  provider: string;
  model: string | null;
  workspaceId: string | null;
  createdAt: string;
  lastActivityAt: string;
  pendingPermissions: number;
}

export interface DirectoryWorkspace {
  id: string;
  name: string;
  projectId: string;
  project: string;
  directory: string | null;
  kind: PaseoWorkspace["workspaceKind"];
  status: PaseoWorkspace["status"];
  agents: DirectoryAgent[];
}

export interface Directory {
  workspaces: DirectoryWorkspace[];
  /** Agents outside any workspace. */
  looseAgents: DirectoryAgent[];
  agentsById: Map<string, DirectoryAgent>;
}

async function listAllWorkspaces(paseo: PaseoApi): Promise<PaseoWorkspace[]> {
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

function toAgent(agent: PaseoAgent): DirectoryAgent {
  return {
    id: agent.id,
    title: agent.title,
    status: agent.status,
    provider: agent.provider,
    model: agent.model,
    workspaceId: agent.workspaceId ?? null,
    createdAt: agent.createdAt,
    lastActivityAt: agent.lastUserMessageAt ?? agent.updatedAt,
    pendingPermissions: agent.pendingPermissions.length,
  };
}

export async function loadDirectory(paseo: PaseoApi): Promise<Directory> {
  const [workspaces, agents] = await Promise.all([listAllWorkspaces(paseo), listAllAgents(paseo)]);
  const live = agents.filter((agent) => !agent.archivedAt && !agent.background && !agent.internal);
  const agentsById = new Map(live.map((agent) => [agent.id, toAgent(agent)]));
  const byWorkspace = new Map<string, DirectoryAgent[]>();
  const looseAgents: DirectoryAgent[] = [];
  for (const agent of agentsById.values()) {
    if (!agent.workspaceId) {
      looseAgents.push(agent);
      continue;
    }
    const list = byWorkspace.get(agent.workspaceId) ?? [];
    list.push(agent);
    byWorkspace.set(agent.workspaceId, list);
  }
  const result: DirectoryWorkspace[] = workspaces
    .filter((workspace) => !workspace.archivingAt && !workspace.background && !workspace.internal)
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      projectId: workspace.projectId,
      project: workspace.projectDisplayName,
      directory: workspace.workspaceDirectory ?? null,
      kind: workspace.workspaceKind,
      status: workspace.status,
      agents: (byWorkspace.get(workspace.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
  return { workspaces: result, looseAgents, agentsById };
}

/** The agent that speaks for a workspace: its oldest live agent, usually the one it was created with. */
export function primaryAgent(workspace: DirectoryWorkspace): DirectoryAgent | undefined {
  return workspace.agents[0];
}

export function workspaceOf(directory: Directory, agentId: string): DirectoryWorkspace | undefined {
  const workspaceId = directory.agentsById.get(agentId)?.workspaceId;
  return workspaceId ? directory.workspaces.find((workspace) => workspace.id === workspaceId) : undefined;
}

/** "Workspace name / agent title", for envelopes and listings. */
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
 * Resolves a target: an agent id, a workspace id, an exact workspace name, or a unique
 * part of one. Throws with the candidates when it is ambiguous or unknown.
 */
export function resolveTarget(directory: Directory, target: string): ResolvedTarget {
  const query = target.trim();
  const lower = query.toLowerCase();

  const agent = directory.agentsById.get(query) ?? [...directory.agentsById.values()].find(
    (candidate) => query.length >= 6 && candidate.id.startsWith(query),
  );
  if (agent) return { agentId: agent.id, label: agentLabel(directory, agent.id) };

  const exact = directory.workspaces.filter(
    (workspace) => workspace.id === query || workspace.name.toLowerCase() === lower,
  );
  const matches = exact.length > 0
    ? exact
    : directory.workspaces.filter(
        (workspace) => workspace.name.toLowerCase().includes(lower) || workspace.directory?.toLowerCase().endsWith(lower),
      );

  if (matches.length === 0) {
    throw new Error(`No workspace or agent matches "${target}". Call orchestrator_overview to list them.`);
  }
  if (matches.length > 1) {
    const names = matches.map((workspace) => `"${workspace.name}" (${workspace.id})`).join(", ");
    throw new Error(`"${target}" matches several workspaces: ${names}. Use a workspace id.`);
  }
  const workspace = matches[0]!;
  const primary = primaryAgent(workspace);
  if (!primary) {
    throw new Error(
      `Workspace "${workspace.name}" has no running agent to receive messages. Start one with orchestrator_spawn or in Paseo.`,
    );
  }
  return { agentId: primary.id, label: agentLabel(directory, primary.id) };
}
