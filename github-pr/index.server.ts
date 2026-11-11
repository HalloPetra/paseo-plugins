import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getPr, mergePr } from "./server/pr";
import { getPrRpc, mergePrRpc } from "./shared/pr";

export default function contribute(server: PluginServerContext) {
  server.handle(getPrRpc, getPr);
  server.handle(mergePrRpc, mergePr);
  return () => {};
}
