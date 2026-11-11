import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SubagentReportCard, reportSchema } from "./client/report-card";
import { parseSubagentReports } from "./shared/parse";

export default function contribute(client: PluginClientContext) {
  const removeTransformer = client.addTimelineTransformer({
    id: "subagent-report",
    query: { itemType: "user_message" },
    transform({ item }) {
      const reports = parseSubagentReports(item.text);
      if (!reports) return undefined;
      return {
        // No `id`: Paseo then derives `<sourceItemId>/<index>`, which is unique per
        // message. An explicit id is used verbatim (`<pluginId>/<id>`), so a constant
        // like "report-0" collides across every report in the timeline.
        items: reports.map((report) => ({
          type: "plugin" as const,
          kind: "subagent-report",
          version: 1,
          data: { from: report.from, body: report.body },
        })),
      };
    },
  });
  const removeRenderer = client.addTimelineRenderer({
    kind: "subagent-report",
    version: 1,
    schema: reportSchema,
    Component: SubagentReportCard,
  });
  return () => {
    removeTransformer();
    removeRenderer();
  };
}
