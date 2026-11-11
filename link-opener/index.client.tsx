import { openExternalUrl, type PluginClientContext } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import { LinksPanel } from "./client/links-panel";
import {
  clearAll,
  forgetOpenBrowser,
  getRememberedOpenBrowser,
  queueBrowserOpen,
  recordOpened,
} from "./client/pending";
import { ThemeReporter } from "./client/theme-reporter";
import { canInterceptLinks, interceptChatLinks } from "./client/web";

const PANEL_ID = "links";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Links",
    icon: "Link",
    locations: ["workspace", "explorer"],
    Component: LinksPanel,
  });

  const removeThemeReporter = canInterceptLinks()
    ? client.addComposerItem({ id: "theme-reporter", Component: ThemeReporter })
    : () => {};

  const stopIntercepting = canInterceptLinks()
    ? interceptChatLinks({
        openSystem: ({ url }) => openExternalUrl(url),
        openPaseo: ({ url, workspaceId }) => {
          const openBrowser = getRememberedOpenBrowser();
          if (openBrowser) {
            try {
              openBrowser({ url, workspaceId });
              recordOpened(workspaceId, url);
              return;
            } catch (error) {
              // Fall back to the panel, which reports the error if it fails there too.
              console.error("[link-opener]", error);
              forgetOpenBrowser();
            }
          }
          queueBrowserOpen(workspaceId, url);
          client.openPanel(PANEL_ID, { workspaceId, location: "explorer" });
        },
        copy: ({ url }) => copyText(url),
      })
    : () => {};

  return () => {
    stopIntercepting();
    removeThemeReporter();
    removePanel();
    clearAll();
  };
}
