import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const checkSchema = z.object({
  name: z.string(),
  workflow: z.string().nullable(),
  // Normalized: success | failure | pending | skipped | neutral
  status: z.enum(["success", "failure", "pending", "skipped", "neutral"]),
  detail: z.string().nullable(),
  url: z.string().nullable(),
});

export const commentSchema = z.object({
  id: z.string(),
  kind: z.enum(["comment", "review", "inline"]),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string().nullable(),
  reviewState: z.string().nullable(),
  path: z.string().nullable(),
  line: z.number().nullable(),
});

export const prSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  author: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  mergeable: z.string(),
  mergeStateStatus: z.string(),
  reviewDecision: z.string().nullable(),
  checks: z.array(checkSchema),
  comments: z.array(commentSchema),
});

export type PullRequest = z.infer<typeof prSchema>;
export type Check = z.infer<typeof checkSchema>;
export type PrComment = z.infer<typeof commentSchema>;

export const getPrRpc = defineRpc({
  name: "pr.get",
  input: z.object({ directory: z.string() }),
  output: z.object({
    pr: prSchema.nullable(),
    branch: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
