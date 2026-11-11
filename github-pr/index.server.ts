import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getPr } from "./server/pr";
import { getPrRpc } from "./shared/pr";

export default function contribute(server: PluginServerContext) {
  server.handle(getPrRpc, getPr);
  return () => {};
}
