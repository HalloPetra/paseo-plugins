import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { McpScreen } from "./client/mcp-screen";

const SCREEN_ID = "servers";

function McpItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Plug"
      label="Model Context Protocol"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Model Context Protocol", Component: McpScreen });
  client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Model Context Protocol", Component: McpItem });
  client.addCommandCenterItem({
    id: "open-mcp",
    title: "Manage MCP servers",
    icon: "Plug",
    keywords: ["mcp", "server", "tools", "claude", "oauth", "login"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: SCREEN_ID });
    },
  });
  return () => {};
}
