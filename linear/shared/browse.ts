import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const;
export type StateType = (typeof STATE_TYPES)[number];

export const SORTS = ["updated", "created", "priority"] as const;
export type IssueSort = (typeof SORTS)[number];

export const ASSIGNEES = ["any", "me", "unassigned"] as const;
export type AssigneeFilter = (typeof ASSIGNEES)[number];

export const IssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  teamKey: z.string(),
  number: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  state: z.object({ name: z.string(), type: z.string(), color: z.string() }),
  priority: z.number(),
  priorityLabel: z.string(),
  assignee: z.string().nullable(),
  project: z.string().nullable(),
  labels: z.array(z.object({ name: z.string(), color: z.string() })),
  updatedAt: z.string(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const browseIssuesRpc = defineRpc({
  name: "linear.issues.browse",
  input: z.object({
    query: z.string(),
    teamId: z.string().nullable(),
    stateTypes: z.array(z.enum(STATE_TYPES)),
    assignee: z.enum(ASSIGNEES),
    sort: z.enum(SORTS),
  }),
  output: z.object({ issues: z.array(IssueSchema) }),
});

export const listTeamsRpc = defineRpc({
  name: "linear.teams.list",
  input: z.object({}),
  output: z.object({
    teams: z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), color: z.string().nullable() })),
  }),
});

/** Linear priority: 1 urgent … 4 low, 0 none. Sort "none" last. */
export function priorityRank(priority: number): number {
  return priority === 0 ? 5 : priority;
}

/** The issue as a Markdown document: what an attached issue sends to the agent. */
export function issueMarkdown(issue: Issue): string {
  const meta = [
    `- **Status:** ${issue.state.name}`,
    issue.priority !== 0 ? `- **Priority:** ${issue.priorityLabel}` : null,
    issue.assignee ? `- **Assignee:** ${issue.assignee}` : null,
    issue.project ? `- **Project:** ${issue.project}` : null,
    issue.labels.length > 0 ? `- **Labels:** ${issue.labels.map((label) => label.name).join(", ")}` : null,
    `- **Link:** ${issue.url}`,
  ].filter((line): line is string => line !== null);
  const description = issue.description?.trim() || "_No description._";
  return [`# ${issue.identifier}: ${issue.title}`, meta.join("\n"), "## Description", description].join("\n\n") + "\n";
}

export function issueSubtitle(issue: Issue): string {
  return [issue.state.name, issue.priority !== 0 ? issue.priorityLabel : null, issue.assignee]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** The attachment Paseo stores and sends; `text` is the Markdown document. */
export function issueAttachmentItem(issue: Issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    subtitle: issueSubtitle(issue),
    url: issue.url,
    text: issueMarkdown(issue),
    resourceType: "issue",
  };
}
