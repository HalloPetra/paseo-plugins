import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AutoSortSettings } from "./client/settings";
import { watcherStatusRpc } from "./shared/rules";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({ id: "rules", title: "Auto sort", icon: "Archive", Component: AutoSortSettings });
  // Starts the daemon-side watcher when an app connects; the daemon does the archiving.
  client.rpc(watcherStatusRpc, {}).catch((error) => console.error("[auto-sort] watcher start failed", error));
  client.addCommandCenterItem({
    id: "open-settings",
    title: "Auto sort settings",
    context: "global",
    icon: "Archive",
    onSelect({ openSettings }) {
      openSettings("rules");
    },
  });
  return () => {};
}
