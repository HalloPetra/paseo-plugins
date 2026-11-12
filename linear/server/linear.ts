import { z } from "zod";
import {
  type AssigneeFilter,
  type Issue,
  type IssueSort,
  type StateType,
  priorityRank,
} from "../shared/browse";

const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  number: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  priority: z.number(),
  priorityLabel: z.string(),
  updatedAt: z.string(),
  team: z.object({ id: z.string(), key: z.string() }),
  state: z.object({ id: z.string(), name: z.string(), type: z.string(), color: z.string() }),
  assignee: z.object({ displayName: z.string() }).nullable(),
  project: z.object({ name: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) }),
});
type LinearIssue = z.infer<typeof LinearIssueSchema>;

const GraphqlErrorsSchema = z.array(z.object({ message: z.string() }).passthrough()).optional();
const ExactIssueResponseSchema = z.object({
  data: z.object({ issue: LinearIssueSchema.nullable() }).nullable().optional(),
  errors: GraphqlErrorsSchema,
});
const IssuesResponseSchema = z.object({
  data: z
    .object({ issues: z.object({ nodes: z.array(LinearIssueSchema) }) })
    .nullable()
    .optional(),
  errors: GraphqlErrorsSchema,
});
const TeamsResponseSchema = z.object({
  data: z
    .object({
      teams: z.object({
        nodes: z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), color: z.string().nullable() })),
      }),
    })
    .nullable()
    .optional(),
  errors: GraphqlErrorsSchema,
});

const WorkflowStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  color: z.string(),
  position: z.number(),
});
const AttachmentsForUrlResponseSchema = z.object({
  data: z
    .object({ attachmentsForURL: z.object({ nodes: z.array(z.object({ issue: LinearIssueSchema.nullable() })) }) })
    .nullable()
    .optional(),
  errors: GraphqlErrorsSchema,
});
const BranchSearchResponseSchema = z.object({
  data: z.object({ issueVcsBranchSearch: LinearIssueSchema.nullable() }).nullable().optional(),
  errors: GraphqlErrorsSchema,
});
const WorkflowStatesResponseSchema = z.object({
  data: z.object({ workflowStates: z.object({ nodes: z.array(WorkflowStateSchema) }) }).nullable().optional(),
  errors: GraphqlErrorsSchema,
});
const IssueUpdateResponseSchema = z.object({
  data: z
    .object({ issueUpdate: z.object({ success: z.boolean(), issue: LinearIssueSchema.nullable() }) })
    .nullable()
    .optional(),
  errors: GraphqlErrorsSchema,
});

const ISSUE_FIELDS = `
  id
  identifier
  number
  title
  description
  url
  priority
  priorityLabel
  updatedAt
  team { id key }
  state { id name type color }
  assignee { displayName }
  project { name }
  labels { nodes { name color } }
`;

const EXACT_ISSUE_QUERY = `
  query PaseoLinearIssue($id: String!) {
    issue(id: $id) { ${ISSUE_FIELDS} }
  }
`;

const ISSUES_QUERY = `
  query PaseoLinearIssues($filter: IssueFilter, $first: Int!, $orderBy: PaginationOrderBy) {
    issues(first: $first, filter: $filter, orderBy: $orderBy) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`;

const TEAMS_QUERY = `
  query PaseoLinearTeams {
    teams(first: 100) { nodes { id key name color } }
  }
`;

const ATTACHMENTS_FOR_URL_QUERY = `
  query PaseoLinearIssueForUrl($url: String!) {
    attachmentsForURL(url: $url, first: 5) { nodes { issue { ${ISSUE_FIELDS} } } }
  }
`;

const BRANCH_SEARCH_QUERY = `
  query PaseoLinearIssueForBranch($branchName: String!) {
    issueVcsBranchSearch(branchName: $branchName) { ${ISSUE_FIELDS} }
  }
`;

const WORKFLOW_STATES_QUERY = `
  query PaseoLinearStates($teamId: ID!) {
    workflowStates(first: 100, filter: { team: { id: { eq: $teamId } } }) {
      nodes { id name type color position }
    }
  }
`;

const ALL_WORKFLOW_STATES_QUERY = `
  query PaseoLinearAllStates {
    workflowStates(first: 250) {
      nodes { id name type color position }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation PaseoLinearSetState($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { ${ISSUE_FIELDS} } }
  }
`;

const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/i;

export interface BrowseOptions {
  query: string;
  teamId: string | null;
  stateTypes: StateType[];
  assignee: AssigneeFilter;
  sort: IssueSort;
}

export class LinearApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearApiError";
  }
}

function toIssue(issue: LinearIssue): Issue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    teamId: issue.team.id,
    teamKey: issue.team.key,
    number: issue.number,
    title: issue.title,
    description: issue.description,
    url: issue.url,
    state: issue.state,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    assignee: issue.assignee?.displayName ?? null,
    project: issue.project?.name ?? null,
    labels: issue.labels.nodes,
    updatedAt: issue.updatedAt,
  };
}

function byPriority(a: Issue, b: Issue): number {
  return priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt.localeCompare(a.updatedAt);
}

function describeHttpFailure(status: number): string {
  if (status === 401 || status === 403)
    return "Linear rejected the API key. Update it in Settings → Plugins → Linear";
  if (status === 429) return "Linear rate limit reached. Try again shortly";
  return `Linear API request failed with HTTP ${status}`;
}

function throwGraphqlErrors(errors: Array<{ message: string }> | undefined): void {
  if (!errors || errors.length === 0) return;
  throw new LinearApiError(errors.map((error) => error.message).join("; "));
}

// Linear's workflow order: triage, backlog, todo, in progress, done, canceled.
const STATE_TYPE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
function stateTypeRank(type: string): number {
  const index = STATE_TYPE_ORDER.indexOf(type);
  return index === -1 ? STATE_TYPE_ORDER.length : index;
}

export function createLinearClient(options: { apiKey: string; endpoint?: string; request?: typeof fetch }) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new LinearApiError(
      "Set a Linear API key in Settings → Plugins → Linear (or LINEAR_API_KEY in the daemon environment)",
    );
  }
  const endpoint = options.endpoint ?? "https://api.linear.app/graphql";
  const request = options.request ?? fetch;

  async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    const response = await request(endpoint, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new LinearApiError(describeHttpFailure(response.status));
    return response.json();
  }

  async function findExact(identifier: string): Promise<Issue[]> {
    const response = ExactIssueResponseSchema.parse(await graphql(EXACT_ISSUE_QUERY, { id: identifier }));
    throwGraphqlErrors(response.errors);
    return response.data?.issue ? [toIssue(response.data.issue)] : [];
  }

  async function listIssues(filter: Record<string, unknown>, first: number, orderBy: "updatedAt" | "createdAt") {
    const response = IssuesResponseSchema.parse(
      await graphql(ISSUES_QUERY, { filter: Object.keys(filter).length ? filter : null, first, orderBy }),
    );
    throwGraphqlErrors(response.errors);
    if (!response.data) throw new LinearApiError("Linear returned no issue data");
    return response.data.issues.nodes.map(toIssue);
  }

  return {
    async browse(options: BrowseOptions): Promise<{ issues: Issue[] }> {
      const normalized = options.query.trim();
      if (LINEAR_IDENTIFIER.test(normalized)) {
        return { issues: await findExact(normalized.toUpperCase()) };
      }
      const filter: Record<string, unknown> = {};
      if (options.teamId) filter.team = { id: { eq: options.teamId } };
      if (options.stateTypes.length > 0) filter.state = { type: { in: options.stateTypes } };
      if (options.assignee === "me") filter.assignee = { isMe: { eq: true } };
      if (options.assignee === "unassigned") filter.assignee = { null: true };
      if (/^\d+$/.test(normalized)) {
        filter.number = { eq: Number(normalized) };
      } else if (normalized) {
        filter.title = { containsIgnoreCase: normalized };
      }
      const orderBy = options.sort === "created" ? "createdAt" : "updatedAt";
      const issues = await listIssues(filter, options.sort === "priority" ? 100 : 50, orderBy);
      if (options.sort === "priority") issues.sort(byPriority);
      return { issues };
    },

    /** The issue Linear links to a PR (its GitHub integration), else the one matching a branch. */
    async resolveWorkspaceIssue(input: { prUrl: string | null; branches: string[] }): Promise<Issue | null> {
      if (input.prUrl) {
        const response = AttachmentsForUrlResponseSchema.parse(await graphql(ATTACHMENTS_FOR_URL_QUERY, { url: input.prUrl }));
        throwGraphqlErrors(response.errors);
        const linked = response.data?.attachmentsForURL.nodes.find((node) => node.issue)?.issue;
        if (linked) return toIssue(linked);
      }
      for (const branchName of input.branches) {
        const response = BranchSearchResponseSchema.parse(await graphql(BRANCH_SEARCH_QUERY, { branchName }));
        throwGraphqlErrors(response.errors);
        const issue = response.data?.issueVcsBranchSearch;
        if (issue) return toIssue(issue);
      }
      return null;
    },

    async teamStates(teamId: string) {
      const response = WorkflowStatesResponseSchema.parse(await graphql(WORKFLOW_STATES_QUERY, { teamId }));
      throwGraphqlErrors(response.errors);
      if (!response.data) throw new LinearApiError("Linear returned no workflow states");
      const states = response.data.workflowStates.nodes.sort(
        (a, b) => stateTypeRank(a.type) - stateTypeRank(b.type) || a.position - b.position,
      );
      return { states };
    },

    /** One state per name across every team (first team wins its icon and color), ordered by type then position. */
    async stateChoices() {
      const response = WorkflowStatesResponseSchema.parse(await graphql(ALL_WORKFLOW_STATES_QUERY));
      throwGraphqlErrors(response.errors);
      if (!response.data) throw new LinearApiError("Linear returned no workflow states");
      const sorted = response.data.workflowStates.nodes.sort(
        (a, b) => stateTypeRank(a.type) - stateTypeRank(b.type) || a.position - b.position,
      );
      const states: { name: string; type: string; color: string }[] = [];
      const seen = new Set<string>();
      for (const state of sorted) {
        const key = state.name.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        states.push({ name: state.name, type: state.type, color: state.color });
      }
      return { states };
    },

    async setIssueState(issueId: string, stateId: string): Promise<Issue> {
      const response = IssueUpdateResponseSchema.parse(await graphql(ISSUE_UPDATE_MUTATION, { id: issueId, stateId }));
      throwGraphqlErrors(response.errors);
      const result = response.data?.issueUpdate;
      if (!result?.success || !result.issue) throw new LinearApiError("Linear did not update the issue");
      return toIssue(result.issue);
    },

    /** One issue by identifier (ENG-123) or id; null when it does not exist or is not visible. */
    async issue(idOrIdentifier: string): Promise<Issue | null> {
      try {
        return (await findExact(idOrIdentifier))[0] ?? null;
      } catch (error) {
        if (error instanceof LinearApiError && /not found|Entity not found/i.test(error.message)) return null;
        throw error;
      }
    },

    async teams() {
      const response = TeamsResponseSchema.parse(await graphql(TEAMS_QUERY));
      throwGraphqlErrors(response.errors);
      if (!response.data) throw new LinearApiError("Linear returned no team data");
      return { teams: response.data.teams.nodes.sort((a, b) => a.key.localeCompare(b.key)) };
    },
  };
}
