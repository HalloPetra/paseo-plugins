/**
 * The text form of an orchestrator message inside a receiving agent's prompt. The server
 * writes it; the client turns prompts that consist only of envelopes into message cards.
 */

export const MESSAGE_KINDS = ["message", "question", "reply", "report", "task"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export interface Envelope {
  kind: MessageKind;
  threadId: string;
  from: string;
  fromAgentId: string;
  /** Whether the sender is waiting for an answer through orchestrator_reply. */
  expectsReply: boolean;
  body: string;
}

const TAG = "orchestrator-message";

export const ENVELOPE_FOOTER =
  "(Delivered by the Paseo orchestrator. Answer with orchestrator_reply using the thread id when a reply is expected; " +
  "use orchestrator_send to start a new conversation and orchestrator_overview to see every workspace.)";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\n/g, " ");
}

function unescapeAttribute(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** Keeps a body from closing its own envelope early. */
function escapeBody(body: string): string {
  return body.replace(new RegExp(`</${TAG}`, "g"), `<\\/${TAG}`);
}

function unescapeBody(body: string): string {
  return body.replace(new RegExp(`<\\\\/${TAG}`, "g"), `</${TAG}`);
}

export function formatEnvelope(envelope: Envelope): string {
  const attributes = [
    `kind="${envelope.kind}"`,
    `thread="${escapeAttribute(envelope.threadId)}"`,
    `from="${escapeAttribute(envelope.from)}"`,
    `from-agent="${escapeAttribute(envelope.fromAgentId)}"`,
    `expects-reply="${envelope.expectsReply ? "yes" : "no"}"`,
  ].join(" ");
  return `<${TAG} ${attributes}>\n${escapeBody(envelope.body.trim())}\n</${TAG}>`;
}

/** One prompt carrying every envelope waiting for an agent. */
export function formatBatch(envelopes: Envelope[]): string {
  return `${envelopes.map(formatEnvelope).join("\n\n")}\n\n${ENVELOPE_FOOTER}`;
}

const BLOCK = new RegExp(`<${TAG}((?:\\s+[a-z-]+="[^"]*")*)\\s*>\\n?([\\s\\S]*?)\\n?</${TAG}>`, "g");
const ATTRIBUTE = /([a-z-]+)="([^"]*)"/g;

/**
 * Returns the envelopes when the text consists only of envelopes and the footer.
 * Anything else returns null so an ordinary message stays as it is.
 */
export function parseBatch(text: string): Envelope[] | null {
  if (!text.trimStart().startsWith(`<${TAG}`)) return null;
  const envelopes: Envelope[] = [];
  let rest = text;
  for (const match of text.matchAll(BLOCK)) {
    const attributes: Record<string, string> = {};
    for (const attribute of (match[1] ?? "").matchAll(ATTRIBUTE)) {
      attributes[attribute[1] ?? ""] = unescapeAttribute(attribute[2] ?? "");
    }
    const kind = MESSAGE_KINDS.find((candidate) => candidate === attributes.kind) ?? "message";
    envelopes.push({
      kind,
      threadId: attributes.thread ?? "",
      from: attributes.from ?? "",
      fromAgentId: attributes["from-agent"] ?? "",
      expectsReply: attributes["expects-reply"] === "yes",
      body: unescapeBody(match[2] ?? ""),
    });
    rest = rest.replace(match[0], "");
  }
  if (envelopes.length === 0) return null;
  // Matches the current footer and older wordings, so earlier messages still render as cards.
  if (rest.replace(/\(Delivered by the Paseo orchestrator\.[^)]*\)/, "").trim() !== "") return null;
  return envelopes;
}
