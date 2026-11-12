Import cookies from the browser you already use into the Paseo browser, so you and your agents are signed in to the same sites without logging in again.

## How it works

The plugin reads the cookie database of a Chromium-based browser profile on the daemon machine, decrypts it with that browser's key from the macOS Keychain, and writes the cookies into the profile shared by all Paseo browser tabs. The source browser can stay open: the plugin reads a temporary copy of its database.

The Paseo browser loads its cookies when the app starts, so Paseo must restart after an import. Press **Restart Paseo** when the import finishes, or quit and reopen it yourself. Restarting stops running agents.

## Setup

Open **Settings → Plugins → Browser import**, or run "Import browser profile" from the Command Center. Pick a browser profile, choose which sites to bring over, and press **Import**. The first import from each browser triggers a macOS prompt asking to let `security` read the browser's "Safe Storage" Keychain item; choose **Allow**.

Requires macOS, with the daemon on the same Mac as the Paseo desktop app. Open a browser tab in Paseo at least once so its profile exists.

## Options

- **Sites**: cookies are grouped by site (google.com includes mail.google.com). All sites are selected by default; search to narrow the list.
- **Replace existing cookies**: when on, an imported cookie replaces one the Paseo browser already has with the same host, name, and path. When off, existing cookies are kept.

## Limits

- Supported browsers: Chrome (including Beta and Canary), Arc, Dia, Brave, Edge, Vivaldi, Opera, Comet, Ardia, and Chromium. Safari and Firefox are not supported.
- Only cookies are imported. Local storage, saved passwords, history, bookmarks, and extensions are not.
- Session cookies become persistent for 30 days, since the Paseo browser discards session cookies on start. Expired cookies are skipped.
- Agents with browser tools can use the imported sessions. Import only the sites you want them to reach.
