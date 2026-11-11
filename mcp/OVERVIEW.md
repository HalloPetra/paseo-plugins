Manage the MCP servers Claude Code agents use, from an MCP screen in the sidebar.

The screen lists every server Claude Code would load for the selected login and project, with its live status and tools. Servers are grouped by where they come from: all profiles (a shared local plugin), this login (user scope), this login and project (local scope), the project's `.mcp.json`, claude.ai connectors, and Claude Code plugins.

## Servers in every profile

Claude Code keeps user-scope servers in each profile's own `.claude.json`, beside the login, so they cannot be shared. The "All profiles" scope writes to `~/.claude/shared-mcp/shared/.mcp.json` instead: a local Claude Code plugin enabled in `~/.claude/settings.json`. Every profile that uses that settings file and plugin folder, such as accounts from the Claude accounts plugin, loads it. Sign-ins are still kept per profile, so each login signs in to an OAuth server once. Claude Code skips a shared server when a claude.ai connector on that login serves the same URL; the screen shows it as covered.

## What you can do

- Add a server with a form (command, HTTP, or SSE) or as raw JSON, choosing all projects or just the selected project. Edit and remove user and local servers.
- Sign in to an OAuth server, or sign in again to replace stale credentials. The browser opens on the machine running Paseo; a link is shown too.
- Turn a server on or off for the selected project, as `/mcp` does.
- Allow or deny individual tools, all tools, or only the read-only ones. Denied tools become deny rules in the login's `settings.json` and are hidden from every session on that login.
- With the Claude accounts plugin, switch between logins. A login that lacks user-scope servers another login has gets a one-click copy. OAuth sign-ins do not carry over.

## How it works

Status and tools come from a headless Claude Code session that connects to the servers without sending a prompt, so nothing is billed. Changes go through the `claude mcp` command line, so Claude Code needs to be installed on the daemon machine. Running agents pick up changes when they reload.
