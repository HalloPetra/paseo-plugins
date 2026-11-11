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

/** Finds the Linear issue for a workspace from its PR URL, then its branch names. */
export const resolveWorkspaceIssueRpc = defineRpc({
  name: "linear.workspace.issue",
  input: z.object({ prUrl: z.string().nullable(), branches: z.array(z.string()) }),
  output: z.object({ issue: IssueSchema.nullable() }),
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
