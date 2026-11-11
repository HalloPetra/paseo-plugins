import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { BoardScreen } from "./client/board";

function BoardItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Kanban"
      active={currentScreen?.screenId === "board"}
      onPress={() => openScreen({ screenId: "board" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "board", title: "Board view", Component: BoardScreen });
  client.addSidebarHeaderItem({ id: "board", title: "Board view", Component: BoardItem });
  client.addCommandCenterItem({
    id: "open-board",
    title: "Open board view",
    icon: "Kanban",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "board" });
    },
  });
  return () => {};
}
