import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";
import { LINEAR_ICON } from "./icon";

export const ISSUE_SOURCE_ID = "issues";

export const searchIssuesRpc = defineRpc({
  name: "linear.issues.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const issueAttachments = defineAttachmentSource({
  id: ISSUE_SOURCE_ID,
  title: "Linear",
  icon: { svg: LINEAR_ICON },
  pickerTitle: "Attach Linear issue",
  searchPlaceholder: "Search by identifier (ENG-123) or title",
  search: searchIssuesRpc,
});
