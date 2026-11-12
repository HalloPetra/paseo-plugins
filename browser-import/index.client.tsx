import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ImportSettings } from "./client/import-settings";

const SETTINGS_ID = "import";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Browser import",
    icon: "Cookie",
    Component: ImportSettings,
  });
  client.addCommandCenterItem({
    id: "import-browser-profile",
    title: "Import browser profile",
    icon: "Cookie",
    keywords: ["browser", "cookies", "login", "chrome", "arc", "brave", "edge", "profile", "import"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings(SETTINGS_ID);
    },
  });
  return () => {};
}
