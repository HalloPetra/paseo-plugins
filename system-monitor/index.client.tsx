import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { FooterDivided } from "./client/footer-divider";
import { SystemMonitorItem } from "./client/sidebar-item";

function DividedSystemMonitorItem(props: PluginSidebarItemProps) {
  return (
    <FooterDivided id="system-monitor">
      <SystemMonitorItem {...props} />
    </FooterDivided>
  );
}

export default function contribute(client: PluginClientContext) {
  client.addSidebarFooterItem({ id: "system-monitor", title: "System monitor", Component: DividedSystemMonitorItem });
  return () => {};
}
