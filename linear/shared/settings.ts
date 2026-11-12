import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Workspace lifecycle events that can move the linked issue to a status. */
export const LIFECYCLE_EVENTS = [
  {
    key: "start",
    label: "Workspace started",
    hint: "When you start a chat with an issue picked from the Linear button",
  },
  {
    key: "archive",
    label: "Workspace archived",
    hint: "When a workspace linked to an issue is archived",
  },
] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number]["key"];

/** Event -> workflow state name (matched per team, ignoring case); null leaves the status alone. */
const StatusRulesSchema = z.object({
  start: z.string().nullable().default(null),
  archive: z.string().nullable().default(null),
});

export const linearSettings = defineSettings({
  id: "linear",
  scope: "host",
  version: 2,
  schema: z.object({
    apiKey: z.string().default(""),
    statusRules: StatusRulesSchema.default({ start: null, archive: null }),
  }),
  migrate: (values) => {
    const apiKey =
      values && typeof values === "object" && typeof (values as { apiKey?: unknown }).apiKey === "string"
        ? (values as { apiKey: string }).apiKey
        : "";
    return { apiKey, statusRules: { start: null, archive: null } };
  },
});

/** Issue picker filters, kept per device. */
export const pickerPreferences = defineSettings({
  id: "picker",
  scope: "device",
  version: 1,
  schema: z.object({
    teamId: z.string().nullable().default(null),
    stateTypes: z
      .array(z.enum(["triage", "backlog", "unstarted", "started", "completed", "canceled"]))
      .default(["triage", "unstarted", "started"]),
    assignee: z.enum(["any", "me", "unassigned"]).default("any"),
    sort: z.enum(["updated", "created", "priority"]).default("updated"),
  }),
});
