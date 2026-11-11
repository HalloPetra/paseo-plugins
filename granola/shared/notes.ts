import { defineAttachmentSource, defineRpc, PluginAttachmentItemSchema, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";
import { GRANOLA_ICON } from "./icon";
import { RANGES, SORTS } from "./settings";

export const NOTE_SOURCE_ID = "transcripts";

export const NoteSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string().nullable(),
  /** Calendar start time, else when the note was created. */
  meetingAt: z.string(),
  updatedAt: z.string(),
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

export const browseNotesRpc = defineRpc({
  name: "granola.notes.browse",
  input: z.object({
    query: z.string(),
    participant: z.string(),
    range: z.enum(RANGES),
    spaceId: z.string().nullable(),
    folderId: z.string().nullable(),
    sort: z.enum(SORTS),
  }),
  output: z.object({
    notes: z.array(NoteSummarySchema),
    /** More notes match than were scanned. */
    truncated: z.boolean(),
    /** The search API was unavailable, so the query matched titles and owners only. */
    titleOnly: z.boolean(),
  }),
});

export const SpaceSchema = z.object({ id: z.string(), name: z.string() });
export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  spaceId: z.string().nullable(),
});
export type Space = z.infer<typeof SpaceSchema>;
export type Folder = z.infer<typeof FolderSchema>;

export const listLocationsRpc = defineRpc({
  name: "granola.locations.list",
  input: z.object({}),
  output: z.object({ spaces: z.array(SpaceSchema), folders: z.array(FolderSchema) }),
});

export const PersonSchema = z.object({ email: z.string(), name: z.string().nullable(), meetings: z.number() });
export type Person = z.infer<typeof PersonSchema>;

/** People from recent meetings' attendees and invitees, most frequent first. */
export const listPeopleRpc = defineRpc({
  name: "granola.people.list",
  input: z.object({ range: z.enum(RANGES), spaceId: z.string().nullable(), folderId: z.string().nullable() }),
  output: z.object({ people: z.array(PersonSchema) }),
});

/** Fetches the note with its full transcript, as the attachment the composer sends. */
export const noteAttachmentRpc = defineRpc({
  name: "granola.notes.attachment",
  input: z.object({ noteId: z.string() }),
  output: z.object({ item: PluginAttachmentItemSchema }),
});

export const searchNotesRpc = defineRpc({
  name: "granola.notes.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const noteAttachments = defineAttachmentSource({
  id: NOTE_SOURCE_ID,
  title: "Granola",
  icon: GRANOLA_ICON,
  pickerTitle: "Attach Granola transcript",
  searchPlaceholder: "Search meeting titles and summaries",
  search: searchNotesRpc,
});
