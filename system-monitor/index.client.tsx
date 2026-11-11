import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SystemMonitorItem } from "./client/sidebar-item";

export default function contribute(client: PluginClientContext) {
  client.addSidebarFooterItem({ id: "system-monitor", title: "System monitor", Component: SystemMonitorItem });
  return () => {};
}
