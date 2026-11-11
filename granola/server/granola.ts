import { z } from "zod";

const BASE_URL = "https://public-api.granola.ai/v1";

const UserSchema = z.object({ name: z.string().nullable(), email: z.string() });

const NoteSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  owner: UserSchema,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
});
export type GranolaNoteSummary = z.infer<typeof NoteSummarySchema>;

const ListNotesSchema = z.object({
  notes: z.array(NoteSummarySchema),
  hasMore: z.boolean(),
  cursor: z.string().nullable(),
});

const SearchNotesSchema = z.object({
  notes: z.array(NoteSummarySchema.extend({ meeting_at: z.string().optional() })),
  hasMore: z.boolean(),
  cursor: z.string().nullable(),
  completion_status: z.string().optional(),
});
export type SearchNotesPage = z.infer<typeof SearchNotesSchema>;

const ListSpacesSchema = z.object({
  spaces: z.array(z.object({ id: z.string(), name: z.string() })),
  hasMore: z.boolean(),
  cursor: z.string().nullable(),
});

const ListFoldersSchema = z.object({
  folders: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      parent_folder_id: z.string().nullable(),
      space_id: z.string().nullable().optional(),
    }),
  ),
  hasMore: z.boolean(),
  cursor: z.string().nullable(),
});

const TranscriptEntrySchema = z.object({
  speaker: z.object({
    source: z.string(),
    attribution: z.string().optional(),
    diarization_label: z.string().optional(),
    name: z.string().optional(),
  }),
  text: z.string(),
  start_time: z.string(),
  end_time: z.string(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

const NoteSchema = NoteSummarySchema.extend({
  web_url: z.string(),
  calendar_event: z
    .object({
      event_title: z.string().nullable(),
      invitees: z.array(z.object({ email: z.string() })).optional(),
      scheduled_start_time: z.string().nullable(),
      scheduled_end_time: z.string().nullable(),
    })
    .passthrough()
    .nullable(),
  attendees: z.array(UserSchema),
  summary_text: z.string().nullable().optional(),
  summary_markdown: z.string().nullable().optional(),
  transcript: z.array(TranscriptEntrySchema).nullable().optional(),
});
export type GranolaNote = z.infer<typeof NoteSchema>;

const TranscriptPageSchema = z.object({
  transcript: z.array(TranscriptEntrySchema),
  hasMore: z.boolean(),
  cursor: z.string().nullable(),
});

export class GranolaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createGranolaClient({ apiKey }: { apiKey: string }) {
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | undefined>,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!apiKey) {
      throw new GranolaError("No Granola API key. Add one in Settings → Plugins → Granola.", 401);
    }
    const query = Object.entries(params)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    const response = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ""}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GranolaError(errorMessage(response.status, text), response.status);
    }
    return schema.parse(await response.json());
  }

  const get = <T>(path: string, params: Record<string, string | undefined>, schema: z.ZodType<T>) =>
    request("GET", path, params, undefined, schema);

  /** Every page of a cursor-paginated list endpoint. */
  async function all<T, Page extends { hasMore: boolean; cursor: string | null }>(
    path: string,
    schema: z.ZodType<Page>,
    pick: (page: Page) => T[],
  ): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const result: Page = await get(path, { cursor: cursor ?? undefined, page_size: "30" }, schema);
      items.push(...pick(result));
      cursor = result.hasMore ? result.cursor : null;
      if (!cursor) break;
    }
    return items;
  }

  return {
    /** One page of notes, newest first. */
    listNotes(input: {
      createdAfter?: string;
      folderId?: string | null;
      spaceId?: string | null;
      cursor?: string | null;
    }) {
      return get(
        "/notes",
        {
          created_after: input.createdAfter,
          folder_id: input.folderId ?? undefined,
          space_id: input.spaceId ?? undefined,
          cursor: input.cursor ?? undefined,
          page_size: "30",
        },
        ListNotesSchema,
      );
    },

    /** Searches titles and shared summaries; a page can be short or empty while `hasMore` is true. */
    searchNotes(
      input:
        | { cursor: string }
        | {
            keywords?: string;
            participant?: string;
            fromDate?: string;
            folderId?: string | null;
            spaceId?: string | null;
          },
    ) {
      const body =
        "cursor" in input
          ? { cursor: input.cursor, page_size: 30 }
          : {
              keywords: input.keywords ? [input.keywords] : undefined,
              participant: input.participant || undefined,
              from_date: input.fromDate,
              folder_id: input.folderId ?? undefined,
              space_id: input.spaceId ?? undefined,
              page_size: 30,
            };
      return request("POST", "/notes/search", {}, body, SearchNotesSchema);
    },

    spaces() {
      return all("/spaces", ListSpacesSchema, (page) => page.spaces);
    },

    folders() {
      return all("/folders", ListFoldersSchema, (page) => page.folders);
    },

    /** The note without its transcript. */
    noteDetails(noteId: string): Promise<GranolaNote> {
      return get(`/notes/${encodeURIComponent(noteId)}`, {}, NoteSchema);
    },

    /** The note with its whole transcript; pages through the transcript when it is too large to inline. */
    async note(noteId: string): Promise<GranolaNote> {
      try {
        return await get(`/notes/${encodeURIComponent(noteId)}`, { include: "transcript" }, NoteSchema);
      } catch (error) {
        if (!(error instanceof GranolaError) || error.status !== 413) throw error;
      }
      const note = await get(`/notes/${encodeURIComponent(noteId)}`, {}, NoteSchema);
      const transcript: TranscriptEntry[] = [];
      let cursor: string | null = null;
      do {
        const page: z.infer<typeof TranscriptPageSchema> = await get(
          `/notes/${encodeURIComponent(noteId)}/transcript`,
          { cursor: cursor ?? undefined, page_size: "100" },
          TranscriptPageSchema,
        );
        transcript.push(...page.transcript);
        cursor = page.hasMore ? page.cursor : null;
      } while (cursor);
      return { ...note, transcript };
    },
  };
}

export type GranolaClient = ReturnType<typeof createGranolaClient>;

function errorMessage(status: number, body: string): string {
  if (status === 401) return "Granola rejected the API key. Check it in Settings → Plugins → Granola.";
  if (status === 403) return "Transcript access over the API is turned off for this Granola workspace.";
  if (status === 404) return "Granola could not find that note. It may still be processing.";
  if (status === 429) return "Granola rate limit reached. Try again in a moment.";
  const detail = body.trim().slice(0, 200);
  return `Granola request failed (${status})${detail ? `: ${detail}` : ""}`;
}
