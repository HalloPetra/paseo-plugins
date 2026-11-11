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
  team: z.object({ key: z.string() }),
  state: z.object({ name: z.string(), type: z.string(), color: z.string() }),
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
  team { key }
  state { name type color }
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

    async teams() {
      const response = TeamsResponseSchema.parse(await graphql(TEAMS_QUERY));
      throwGraphqlErrors(response.errors);
      if (!response.data) throw new LinearApiError("Linear returned no team data");
      return { teams: response.data.teams.nodes.sort((a, b) => a.key.localeCompare(b.key)) };
    },
  };
}
