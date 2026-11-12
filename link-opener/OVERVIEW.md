Link opener asks where to open a web link when you click it in an agent chat or in the GitHub PR panel's comments and description. A small popover appears under the link with three choices: open it in the Paseo browser, open it in the system browser, or copy it. ⌘-click (Ctrl-click on Windows and Linux) skips the popover and opens the system browser as before.

Keyboard: Enter opens the Paseo browser, ⌘Enter the system browser, ⌘C copies, arrow keys move between choices, and Escape closes the popover.

Plugins can only open the Paseo browser from a panel, so the first time you choose the Paseo browser after the app starts, a Links panel opens in the Explorer sidebar and opens the browser tab from there. Later clicks open the browser tab directly. The Links panel lists the links opened in that workspace so you can reopen them in either browser.

Limits:

- Desktop app only. The Paseo browser exists only there, so the web and mobile apps keep Paseo's normal link behavior.
- Paseo has no plugin hook for link presses yet. The plugin catches clicks on links inside the agent chat and the GitHub PR panel before the app handles them, so a Paseo update that changes how the chat renders links can stop it from working until the plugin is updated.
- The Paseo browser choice needs a workspace on screen; it is disabled when an agent is opened outside a workspace view.
- Only http and https links are handled. Links to workspace files keep their normal behavior.
