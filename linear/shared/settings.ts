import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const linearSettings = defineSettings({
  id: "linear",
  scope: "host",
  version: 1,
  schema: z.object({ apiKey: z.string().default("") }),
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
