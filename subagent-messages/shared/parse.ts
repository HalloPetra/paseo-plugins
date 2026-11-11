export interface SubagentReport {
  from: string;
  body: string;
}

const BLOCK = /<agent-message\s+from="([^"]*)"\s*>\n?([\s\S]*?)\n?<\/agent-message>/g;
const PREAMBLE = /^\[Subagent hand-back\][^\n]*\n/;

/** Strip the harness frame and the two-space indent it adds to every report line. */
function cleanBody(raw: string): string {
  const body = raw.replace(PREAMBLE, "");
  const lines = body.split("\n");
  const indented = lines.every((line) => line === "" || line.startsWith("  "));
  return (indented ? lines.map((line) => line.slice(2)) : lines).join("\n").trim();
}

/**
 * Returns the reports when the message consists only of `<agent-message>` blocks
 * (whitespace between them is allowed). Anything else returns null so the
 * original message is kept untouched.
 */
export function parseSubagentReports(text: string): SubagentReport[] | null {
  if (!text.trimStart().startsWith("<agent-message")) return null;
  const reports: SubagentReport[] = [];
  let rest = text;
  for (const match of text.matchAll(BLOCK)) {
    reports.push({ from: match[1] ?? "", body: cleanBody(match[2] ?? "") });
    rest = rest.replace(match[0], "");
  }
  if (reports.length === 0 || rest.trim() !== "") return null;
  return reports;
}
