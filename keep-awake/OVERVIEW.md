Keep awake stops the machine running the Paseo daemon from going to sleep while agents are working, and lets it sleep again once they are done. A compact row at the bottom of the sidebar shows how many agents are keeping the host awake, with an on/off switch. Hovering the row lists those agents; on touch devices, tapping it does. Pressing the status on desktop opens the settings.

An agent counts while it has a turn running. Subagents count too: Paseo agents started by another agent, background helper agents, and, if enabled, provider subagents and background shells that keep running after their parent's turn has ended. After the last one stops, the host stays awake for a grace period (one minute by default) so a quick follow-up does not find it asleep; the sidebar can end the grace period early.

Settings:

- Turn keeping awake on or off.
- How long to wait after the last agent stops: immediately, 1, 5, or 15 minutes.
- Whether subagents and helper agents count, and whether background work counts.
- Keep the display on as well, instead of only the system.
- On macOS, also block system sleep on AC power. On Linux, also ignore closing the lid.

On macOS it runs `caffeinate`, on Linux `systemd-inhibit`, and on Windows a PowerShell process that calls `SetThreadExecutionState`. The blocker exits with the plugin, so a crash never leaves the host stuck awake. Settings are stored on the host and shared by every connected client. Nothing leaves the machine.

The plugin starts watching agents when the app shows the sidebar or when an agent starts a turn, so an agent already running when the plugin loads is picked up at that point.
