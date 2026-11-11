import type { RpcInput } from "@getpaseo/plugin";
import type { PluginSettings } from "@getpaseo/plugin/server";
import type { browseNotesRpc, listPeopleRpc, NoteSummary, noteAttachmentRpc, Person, searchNotesRpc } from "../shared/notes";
import type { DateRange, granolaSettings, NoteSort } from "../shared/settings";
import { createGranolaClient, GranolaError, type GranolaClient, type GranolaNote, type GranolaNoteSummary } from "./granola";
import { noteMarkdown, noteTitle } from "./markdown";
import { account, type CachedPerson, type Locations, scheduleSave } from "./store";

declare const process: { env: Record<string, string | undefined> };

export type GranolaSettings = PluginSettings<typeof granolaSettings.schema>;
type BrowseInput = RpcInput<typeof browseNotesRpc>;

/** Pages of 30; the list endpoint has no text search and search pages can come back short. */
const MAX_LIST_PAGES = 10;
const MAX_SEARCH_PAGES = 8;
const LIST_TTL_MS = 60_000;
const NOTE_TTL_MS = 10 * 60_000;
const NOTE_CACHE_SIZE = 40;
const RESULT_LIMIT = 50;
const SEARCH_ATTACH_LIMIT = 8;

const RANGE_DAYS: Record<DateRange, number | null> = { week: 7, month: 30, quarter: 90, any: null };

interface Config {
  client: GranolaClient;
  apiKey: string;
  includeSummary: boolean;
}

async function config(settings: GranolaSettings): Promise<Config> {
  const state = await settings.read();
  const saved = state.status === "ready" ? state.values.apiKey.trim() : "";
  const apiKey = saved || (process.env.GRANOLA_API_KEY ?? "").trim();
  const includeSummary = state.status === "ready" ? state.values.includeSummary : true;
  return { client: createGranolaClient({ apiKey }), apiKey, includeSummary };
}

/** Promise cache keyed per API key; failures are not kept. */
function cached<T>(store: Map<string, { at: number; value: Promise<T> }>, key: string, ttl: number, load: () => Promise<T>) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = load();
  store.set(key, { at: Date.now(), value });
  value.catch(() => store.delete(key));
  return value;
}

function since(range: DateRange): string | undefined {
  const days = RANGE_DAYS[range];
  return days === null ? undefined : new Date(Date.now() - days * 86_400_000).toISOString();
}

type Found = GranolaNoteSummary & { meeting_at?: string };
interface Result {
  notes: Found[];
  truncated: boolean;
  titleOnly: boolean;
}

async function listNotes({ client }: Config, input: BrowseInput): Promise<Result> {
  const notes: Found[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await client.listNotes({
      createdAfter: since(input.range),
      folderId: input.folderId,
      spaceId: input.spaceId,
      cursor,
    });
    notes.push(...result.notes);
    cursor = result.hasMore ? result.cursor : null;
    if (!cursor) break;
  }
  return { notes, truncated: cursor !== null, titleOnly: false };
}

async function searchNotes({ client }: Config, input: BrowseInput): Promise<Result> {
  const notes: Found[] = [];
  let page = await client.searchNotes({
    keywords: input.query || undefined,
    participant: input.participant || undefined,
    fromDate: since(input.range),
    folderId: input.folderId,
    spaceId: input.spaceId,
  });
  notes.push(...page.notes);
  for (let count = 1; page.hasMore && page.cursor && notes.length < RESULT_LIMIT && count < MAX_SEARCH_PAGES; count++) {
    page = await client.searchNotes({ cursor: page.cursor });
    notes.push(...page.notes);
  }
  return { notes, truncated: page.hasMore || page.completion_status === "incomplete", titleOnly: false };
}

function matchesTitle(note: GranolaNoteSummary, terms: string[]): boolean {
  const haystack = [note.title ?? "", note.owner.name ?? "", note.owner.email].join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const resultCache = new Map<string, { at: number; value: Promise<Result> }>();

/** Search when there is text to match; otherwise list, which also covers notes search has not indexed. */
function findNotes(cfg: Config, input: BrowseInput): Promise<Result> {
  const { sort: _sort, ...filters } = input;
  const key = `${cfg.apiKey}\0${JSON.stringify(filters)}`;
  return cached(resultCache, key, LIST_TTL_MS, async () => {
    if (!input.query && !input.participant) return listNotes(cfg, input);
    try {
      return await searchNotes(cfg, input);
    } catch (error) {
      // Keys without search access: match titles and owners from the plain listing.
      if (!(error instanceof GranolaError) || (error.status !== 403 && error.status !== 404)) throw error;
      if (input.participant) throw error;
      const listed = await listNotes(cfg, input);
      const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      return { ...listed, notes: listed.notes.filter((note) => matchesTitle(note, terms)), titleOnly: true };
    }
  });
}

function toSummary(note: Found): NoteSummary {
  return {
    id: note.id,
    title: noteTitle(note),
    owner: note.owner.name ?? note.owner.email,
    meetingAt: note.meeting_at ?? note.created_at,
    updatedAt: note.updated_at,
  };
}

function compare(sort: NoteSort) {
  return (a: NoteSummary, b: NoteSummary) =>
    sort === "updated"
      ? b.updatedAt.localeCompare(a.updatedAt)
      : sort === "oldest"
        ? a.meetingAt.localeCompare(b.meetingAt)
        : b.meetingAt.localeCompare(a.meetingAt);
}

export async function browseNotes(input: BrowseInput, settings: GranolaSettings) {
  const trimmed = { ...input, query: input.query.trim(), participant: input.participant.trim() };
  const { notes, truncated, titleOnly } = await findNotes(await config(settings), trimmed);
  const seen = new Set<string>();
  const unique = notes.filter((note) => !note.deleted_at && !seen.has(note.id) && seen.add(note.id));
  return {
    notes: unique.map(toSummary).sort(compare(input.sort)).slice(0, RESULT_LIMIT),
    truncated: truncated || unique.length > RESULT_LIMIT,
    titleOnly,
  };
}

/** Spaces and folders change rarely: serve the saved copy at once and refresh it in the background when old. */
const LOCATIONS_REFRESH_MS = 15 * 60_000;
const locationRefresh = new Map<string, Promise<Locations>>();

function refreshLocations({ client, apiKey }: Config): Promise<Locations> {
  const running = locationRefresh.get(apiKey);
  if (running) return running;
  const value = (async () => {
    const [spaces, folders] = await Promise.all([client.spaces().catch(optional), client.folders().catch(optional)]);
    const locations: Locations = {
      at: Date.now(),
      spaces: spaces.map((space) => ({ id: space.id, name: space.name })),
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_folder_id,
        spaceId: folder.space_id ?? null,
      })),
    };
    (await account(apiKey)).locations = locations;
    scheduleSave();
    return locations;
  })().finally(() => locationRefresh.delete(apiKey));
  locationRefresh.set(apiKey, value);
  return value;
}

/** Spaces and folders for the picker filters. Either list may be unavailable to a key; that leaves it empty. */
export async function listLocations(settings: GranolaSettings) {
  const cfg = await config(settings);
  const saved = (await account(cfg.apiKey)).locations;
  if (!saved) return withoutTimestamp(await refreshLocations(cfg));
  if (Date.now() - saved.at > LOCATIONS_REFRESH_MS) refreshLocations(cfg).catch(() => undefined);
  return withoutTimestamp(saved);
}

function withoutTimestamp({ spaces, folders }: Locations) {
  return { spaces, folders };
}

function optional(error: unknown): never[] {
  if (error instanceof GranolaError && (error.status === 403 || error.status === 404)) return [];
  throw error;
}

/** The list API has no attendees, so people come from the details of this many recent notes. */
const PEOPLE_SAMPLE = 60;
const PEOPLE_CONCURRENCY = 6;
const PEOPLE_TTL_MS = 5 * 60_000;

/** Personal mail providers: sharing one with a note owner does not make someone a teammate. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com",
  "mac.com", "yahoo.com", "aol.com", "proton.me", "protonmail.com", "gmx.de", "gmx.net", "web.de", "t-online.de",
]);

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

const peopleCache = new Map<string, { at: number; value: Promise<Person[]> }>();

/** Attendees and invitees of one note: from the disk cache while the note is unchanged, else fetched. */
async function notePeople(cfg: Config, note: GranolaNoteSummary): Promise<CachedPerson[] | null> {
  const saved = (await account(cfg.apiKey)).notes;
  const hit = saved[note.id];
  if (hit && hit.updatedAt === note.updated_at) return hit.people;
  const details = await cfg.client.noteDetails(note.id).catch(() => null);
  if (!details) return null;
  const people: CachedPerson[] = [
    { email: details.owner.email, name: details.owner.name },
    ...details.attendees.map((attendee) => ({ email: attendee.email, name: attendee.name })),
    ...(details.calendar_event?.invitees ?? []).map((invitee) => ({ email: invitee.email, name: null })),
  ];
  saved[note.id] = { updatedAt: note.updated_at, people };
  scheduleSave();
  return people;
}

/**
 * Teammates from recent meetings, most frequent first. A teammate owns one of the listed notes or
 * shares a company email domain with an owner; everyone else is external.
 */
export async function listPeople(input: RpcInput<typeof listPeopleRpc>, settings: GranolaSettings) {
  const cfg = await config(settings);
  const key = `${cfg.apiKey}\0${JSON.stringify(input)}`;
  const people = await cached(peopleCache, key, PEOPLE_TTL_MS, async () => {
    const { notes } = await findNotes(cfg, { ...input, query: "", participant: "", sort: "newest" });
    const live = notes.filter((note) => !note.deleted_at);
    const ownerEmails = new Set(live.map((note) => note.owner.email.toLowerCase()));
    const teamDomains = new Set([...ownerEmails].map(domainOf).filter((domain) => !PUBLIC_DOMAINS.has(domain)));
    const isTeammate = (email: string) => ownerEmails.has(email) || teamDomains.has(domainOf(email));

    const recent = [...live].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, PEOPLE_SAMPLE);
    const found = new Map<string, Person>();
    let next = 0;
    const worker = async () => {
      while (next < recent.length) {
        const people = await notePeople(cfg, recent[next++]!);
        const seen = new Set<string>();
        for (const person of people ?? []) {
          const id = person.email.trim().toLowerCase();
          if (!id || seen.has(id) || !isTeammate(id)) continue;
          seen.add(id);
          const current = found.get(id);
          found.set(id, {
            email: current?.email ?? person.email.trim(),
            name: current?.name ?? (person.name?.trim() || null),
            meetings: (current?.meetings ?? 0) + 1,
          });
        }
      }
    };
    await Promise.all(Array.from({ length: PEOPLE_CONCURRENCY }, worker));
    return [...found.values()].sort(
      (a, b) => b.meetings - a.meetings || (a.name ?? a.email).localeCompare(b.name ?? b.email),
    );
  });
  return { people };
}

const noteCache = new Map<string, { at: number; value: Promise<GranolaNote> }>();

function fetchNote({ client, apiKey }: Config, noteId: string): Promise<GranolaNote> {
  const value = cached(noteCache, `${apiKey}\0${noteId}`, NOTE_TTL_MS, () => client.note(noteId));
  // Oldest first in insertion order; transcripts can be large, keep a handful.
  while (noteCache.size > NOTE_CACHE_SIZE) noteCache.delete(noteCache.keys().next().value!);
  return value;
}

function durationMinutes(note: GranolaNote): number | null {
  const entries = note.transcript ?? [];
  if (entries.length === 0) return null;
  const ms = Date.parse(entries[entries.length - 1]!.end_time) - Date.parse(entries[0]!.start_time);
  return Number.isNaN(ms) ? null : Math.max(1, Math.round(ms / 60_000));
}

function attachmentItem(note: GranolaNote, includeSummary: boolean) {
  const date = (note.calendar_event?.scheduled_start_time ?? note.created_at).slice(0, 10);
  const minutes = durationMinutes(note);
  return {
    id: note.id,
    identifier: date,
    title: noteTitle(note),
    subtitle: [note.owner.name ?? note.owner.email, minutes ? `${minutes} min` : null].filter(Boolean).join(" · "),
    url: note.web_url,
    text: noteMarkdown(note, { includeSummary }),
    resourceType: "transcript",
  };
}

export async function noteAttachment({ noteId }: RpcInput<typeof noteAttachmentRpc>, settings: GranolaSettings) {
  const cfg = await config(settings);
  return { item: attachmentItem(await fetchNote(cfg, noteId), cfg.includeSummary) };
}

/** The "+" menu picker sends whole snapshots, so only the top matches get their transcripts fetched. */
export async function searchAttachments({ query }: RpcInput<typeof searchNotesRpc>, settings: GranolaSettings) {
  const cfg = await config(settings);
  const trimmed = query.trim();
  const { notes } = await browseNotes(
    { query: trimmed, participant: "", range: trimmed ? "any" : "month", spaceId: null, folderId: null, sort: "newest" },
    settings,
  );
  const results = await Promise.allSettled(notes.slice(0, SEARCH_ATTACH_LIMIT).map((note) => fetchNote(cfg, note.id)));
  const items = results.flatMap((result) =>
    result.status === "fulfilled" ? [attachmentItem(result.value, cfg.includeSummary)] : [],
  );
  if (items.length === 0 && results[0]?.status === "rejected") throw results[0].reason;
  return { items };
}
