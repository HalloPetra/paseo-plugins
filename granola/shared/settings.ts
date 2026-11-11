import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const RANGES = ["week", "month", "quarter", "any"] as const;
export type DateRange = (typeof RANGES)[number];

export const SORTS = ["newest", "oldest", "updated"] as const;
export type NoteSort = (typeof SORTS)[number];

export const granolaSettings = defineSettings({
  id: "granola",
  scope: "host",
  version: 1,
  schema: z.object({
    apiKey: z.string().default(""),
    /** Add Granola's AI summary above the transcript. */
    includeSummary: z.boolean().default(true),
  }),
});

/** Note picker filters, kept per device. */
export const pickerPreferences = defineSettings({
  id: "picker",
  scope: "device",
  version: 1,
  schema: z.object({
    range: z.enum(RANGES).default("month"),
    spaceId: z.string().nullable().default(null),
    folderId: z.string().nullable().default(null),
    sort: z.enum(SORTS).default("newest"),
    /** Calendar participant, matched by email. */
    participant: z.object({ email: z.string(), name: z.string().nullable() }).nullable().default(null),
  }),
});
