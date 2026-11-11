Connect several Claude Code subscriptions to one Paseo daemon. When a Claude agent hits a usage limit (the 5-hour session limit, a weekly limit, or running out of extra usage), the plugin marks that account as limited until its reset time, moves to the next signed-in account, reopens the agent on it, and sends a short prompt so the agent carries on where it stopped. A row in the agent's timeline records each switch.

## How it works

Each account is a separate Claude Code config directory under `~/.paseo/claude-accounts/accounts/`. Claude agents launch with `CLAUDE_CONFIG_DIR` pointing at the active account. Only the login is kept per account. Everything else in your normal `~/.claude` directory (settings, session history, projects, skills, plugins) is linked into each account directory, so a conversation resumes on whichever account it switches to. Your existing login stays available as "Default login".

When every account is limited, the agent stops and its timeline says when the first account frees up. An account is tried again after the reset time Claude reports, or after an hour if it gave none.

## Setup

Open **Settings → Plugins → Claude accounts** (or "Manage Claude accounts" in the Command Center) and press **Add account**. The daemon starts `claude auth login` for a new account and your browser opens to Claude's sign-in page. When you finish, the account appears with its email and plan, named after the email; rename it if you like. If the browser opens on a different machine than the one you are using, open the sign-in page from the panel and paste the code it shows. An account that is already connected is refused.

Claude Code must be installed on the daemon machine. It stores the credentials itself (in the macOS Keychain or the account directory); the plugin never reads or stores tokens.

## Settings

- **Sign in again**: renews an account's login, for example after it expired.
- **Use**: makes an account active for new sessions and reopens idle Claude agents on it. Running agents switch when their turn ends at a limit.
- **Clear limit**: marks a limited account available again, for example after buying extra usage.
- **Switch automatically**: turn off to keep agents on their account and only record the limit.
- **Resume prompt**: the message sent to an agent after it switches.

## Limits

- Only agents using the built-in `claude` provider are affected.
- Limits are recognized from Claude Code's limit message. A turn that fails with a differently worded limit is not switched.
- User-scoped MCP servers and other settings Claude Code keeps in `~/.claude.json` are per account. Add them to each account, or configure them in Paseo or in the project.
- Removing an account deletes its directory but leaves its Keychain entry in place.
