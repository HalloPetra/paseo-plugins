import type { PluginServerContext } from "@getpaseo/plugin/server";
import { discoverProfiles, findPaseoCookieStore } from "./server/browsers";
import { cookieCount, importCookies, listSites, paseoCookieCount } from "./server/cookies";
import { restartPaseo } from "./server/restart";
import { importCookiesRpc, listSitesRpc, listSourcesRpc, restartPaseoRpc } from "./shared/import";

export default function contribute(server: PluginServerContext) {
  server.handle(listSourcesRpc, async () => {
    if (process.platform !== "darwin") {
      return {
        unsupported: "Browser import currently supports macOS only.",
        target: null,
        sources: [],
      };
    }
    const targetPath = findPaseoCookieStore();
    const sources = discoverProfiles()
      .map((profile) => ({
        id: profile.id,
        browser: profile.browser.label,
        profile: profile.name,
        cookieCount: cookieCount(profile.cookiesPath),
      }))
      .filter((source) => source.cookieCount > 0);
    return {
      unsupported: targetPath
        ? null
        : "No Paseo browser profile was found on this machine. Run the import on the daemon that runs alongside the Paseo desktop app, and open a browser tab in Paseo once.",
      target: targetPath ? { path: targetPath, cookieCount: paseoCookieCount(targetPath) } : null,
      sources,
    };
  });

  server.handle(listSitesRpc, async ({ sourceId }) => ({ sites: listSites(sourceId) }));

  server.handle(importCookiesRpc, async (input) => {
    const result = await importCookies(input);
    console.log(
      `Imported ${result.imported} cookies from ${input.sourceId} (kept ${result.kept}, failed ${result.failed}).`,
    );
    return result;
  });

  server.handle(restartPaseoRpc, async () => {
    restartPaseo();
    return {};
  });

  return () => {};
}
