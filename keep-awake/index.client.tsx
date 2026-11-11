import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { FooterDivided } from "./client/footer-divider";
import { KeepAwakeSettingsScreen } from "./client/settings";
import { createSidebarItem } from "./client/sidebar-item";

const SETTINGS_ID = "keep-awake";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings(SETTINGS_ID);
  const KeepAwakeItem = createSidebarItem(openSettings);
  const DividedKeepAwakeItem = (props: PluginSidebarItemProps) => (
    <FooterDivided id="keep-awake">
      <KeepAwakeItem {...props} />
    </FooterDivided>
  );
  client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Keep awake",
    icon: "Coffee",
    Component: KeepAwakeSettingsScreen,
  });
  client.addSidebarFooterItem({
    id: "keep-awake",
    title: "Keep awake",
    Component: DividedKeepAwakeItem,
  });
  client.addCommandCenterItem({
    id: "keep-awake-settings",
    title: "Keep awake settings",
    icon: "Coffee",
    keywords: ["sleep", "caffeinate", "awake", "power", "idle"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings(SETTINGS_ID);
    },
  });
  return () => {};
}
