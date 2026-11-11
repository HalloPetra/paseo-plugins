import { type PluginAttachmentItem, PluginAttachmentSearchPayloadSchema, defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { CHECK_LOGS_SOURCE_ID } from "./pr";

/** Attach failing-check logs by PR URL or owner/repo#number from the composer's "+" menu. */
export const searchCheckLogsRpc = defineRpc({
  name: "pr.check-logs.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const checkLogsAttachments = defineAttachmentSource({
  id: CHECK_LOGS_SOURCE_ID,
  title: "Failing check logs",
  icon: "FileWarning",
  pickerTitle: "Attach failing check logs",
  searchPlaceholder: "PR URL or owner/repo#123",
  search: searchCheckLogsRpc,
});

/** The attachment for one PR's failing-check logs. One per PR, so re-attaching replaces it. */
export function checkLogsItem(pr: { number: number; url: string; title: string }, text: string): PluginAttachmentItem {
  return {
    id: `checks-${pr.url}`,
    identifier: `#${pr.number} checks`,
    title: `Failing check logs for #${pr.number}`,
    subtitle: pr.title,
    url: `${pr.url}/checks`,
    text,
    resourceType: "ci-logs",
  };
}
