import type { GranolaNote, TranscriptEntry } from "./granola";

export function noteTitle(note: { title: string | null }): string {
  return note.title?.trim() || "Untitled meeting";
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function person(user: { name: string | null; email: string }): string {
  return user.name?.trim() ? `${user.name.trim()} <${user.email}>` : user.email;
}

function speakerName(entry: TranscriptEntry, ownerName: string): string {
  const { speaker } = entry;
  if (speaker.name?.trim()) return speaker.name.trim();
  if (speaker.attribution === "me") return ownerName;
  if (speaker.diarization_label) return speaker.diarization_label;
  if (speaker.attribution === "them") return "Them";
  return speaker.source === "microphone" ? ownerName : "Them";
}

function offset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Consecutive lines from the same speaker merge into one paragraph, stamped with its start offset. */
export function transcriptMarkdown(entries: TranscriptEntry[], ownerName: string): string {
  if (entries.length === 0) return "_No transcript._";
  const start = Date.parse(entries[0]!.start_time);
  const blocks: { speaker: string; at: number; text: string[] }[] = [];
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const speaker = speakerName(entry, ownerName);
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker) {
      last.text.push(text);
    } else {
      const at = Date.parse(entry.start_time) - start;
      blocks.push({ speaker, at: Number.isNaN(at) ? 0 : at, text: [text] });
    }
  }
  return blocks.map((block) => `**${block.speaker}** [${offset(block.at)}]: ${block.text.join(" ")}`).join("\n\n");
}

/** The note as a Markdown document: what an attached transcript sends to the agent. */
export function noteMarkdown(note: GranolaNote, { includeSummary }: { includeSummary: boolean }): string {
  const ownerName = note.owner.name?.trim() || "Me";
  const event = note.calendar_event;
  const meta = [
    `- **Date:** ${formatDate(event?.scheduled_start_time) ?? formatDate(note.created_at) ?? note.created_at}`,
    `- **Owner:** ${person(note.owner)}`,
    note.attendees.length > 0 ? `- **Attendees:** ${note.attendees.map(person).join(", ")}` : null,
    `- **Link:** ${note.web_url}`,
  ].filter((line): line is string => line !== null);
  const summary = (note.summary_markdown ?? note.summary_text ?? "").trim();
  const sections = [`# Meeting transcript: ${noteTitle(note)}`, meta.join("\n")];
  if (includeSummary && summary) sections.push("## Summary", summary);
  sections.push("## Transcript", transcriptMarkdown(note.transcript ?? [], ownerName));
  return sections.join("\n\n") + "\n";
}
