import type { PluginServerContext } from "@getpaseo/plugin/server";
import { checkLogs, searchCheckLogs } from "./server/check-logs";
import { getPr, mergePr } from "./server/pr";
import { searchCheckLogsRpc } from "./shared/check-logs";
import { checkLogsRpc, getPrRpc, mergePrRpc } from "./shared/pr";

export default function contribute(server: PluginServerContext) {
  server.handle(getPrRpc, getPr);
  server.handle(mergePrRpc, mergePr);
  server.handle(checkLogsRpc, checkLogs);
  server.handle(searchCheckLogsRpc, searchCheckLogs);
  return () => {};
}
