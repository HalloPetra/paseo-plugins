import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AccountsSettings } from "./client/accounts-settings";
import { SwitchRow } from "./client/switch-row";
import { SWITCH_ROW_KIND, switchRowSchema } from "./shared/accounts";

const SETTINGS_ID = "accounts";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Claude accounts",
    icon: "Users",
    Component: AccountsSettings,
  });
  client.addCommandCenterItem({
    id: "manage-accounts",
    title: "Manage Claude accounts",
    icon: "Users",
    keywords: ["claude", "subscription", "account", "switch", "limit", "login"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings(SETTINGS_ID);
    },
  });
  client.addTimelineRenderer({
    kind: SWITCH_ROW_KIND,
    version: 1,
    schema: switchRowSchema,
    Component: SwitchRow,
  });
  return () => {};
}
