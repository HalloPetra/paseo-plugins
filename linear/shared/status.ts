import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { IssueSchema } from "./browse";

export const WorkflowStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  color: z.string(),
  position: z.number(),
});
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

/** Workspace metadata key holding the linked issue identifier (set by the composer button or /link-linear). */
export const LINKED_ISSUE_KEY = "linear.issue";

/** Finds the Linear issue for a workspace; see server/resolve.ts for the order of signals. */
export const resolveWorkspaceIssueRpc = defineRpc({
  name: "linear.workspace.issue",
  input: z.object({
    workspaceId: z.string(),
    /** Explicit link from workspace metadata. */
    linked: z.string().nullable(),
    prUrl: z.string().nullable(),
    branches: z.array(z.string()),
    /** Workspace name/title and PR title. */
    names: z.array(z.string()),
  }),
  output: z.object({ issue: IssueSchema.nullable(), source: z.string().nullable() }),
});

export const listTeamStatesRpc = defineRpc({
  name: "linear.team.states",
  input: z.object({ teamId: z.string() }),
  output: z.object({ states: z.array(WorkflowStateSchema) }),
});

export const setIssueStateRpc = defineRpc({
  name: "linear.issue.set_state",
  input: z.object({ issueId: z.string(), stateId: z.string() }),
  output: z.object({ issue: IssueSchema }),
});
