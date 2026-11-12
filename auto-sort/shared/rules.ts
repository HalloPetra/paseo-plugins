import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DELAYS = [
  { value: "0", label: "Immediately" },
  { value: "5", label: "After 5 minutes" },
  { value: "30", label: "After 30 minutes" },
  { value: "240", label: "After 4 hours" },
] as const;

export const rulesSettings = defineSettings({
  id: "rules",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Archive a workspace once its pull request is merged. */
    archiveOnMerge: z.boolean().default(true),
    /** Archive a workspace once its pull request is closed without merging. */
    archiveOnClose: z.boolean().default(false),
    /** Minutes between the PR event and archiving; a workspace that changes in between is re-checked. */
    delayMinutes: z.enum(["0", "5", "30", "240"]).default("5"),
    /** Leave workspaces with uncommitted or unpushed changes alone; archiving removes the worktree. */
    keepUnsavedWork: z.boolean().default(true),
    /** Leave pinned workspaces alone, whatever their pull request state. */
    skipPinned: z.boolean().default(true),
  }),
});

export type Rules = z.output<typeof rulesSettings.schema>;

export const ArchiveEntrySchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  project: z.string(),
  reason: z.enum(["merged", "closed"]),
  prNumber: z.number().nullable(),
  at: z.string(),
  error: z.string().nullable(),
});
export type ArchiveEntry = z.output<typeof ArchiveEntrySchema>;

export const PendingEntrySchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  reason: z.enum(["merged", "closed"]),
  dueAt: z.string(),
});

/** Reports the watcher and, as a side effect, starts it: the daemon only hands plugins a client inside a call. */
export const watcherStatusRpc = defineRpc({
  name: "watcher.status",
  input: z.object({}),
  output: z.object({
    watching: z.boolean(),
    workspaces: z.number(),
    pending: z.array(PendingEntrySchema),
    recent: z.array(ArchiveEntrySchema),
  }),
});
