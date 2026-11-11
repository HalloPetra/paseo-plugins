Adds a "Linear" button to the composer toolbar, next to the model and mode controls, when you start a new chat: in a new agent's composer and on the New workspace screen. It is hidden in the composer of an agent that is already running. It opens an issue picker; choosing an issue attaches it to the message as a Markdown document (title, status, priority, assignee, project, labels, link, and description), shown as a pill above the composer. The same attachment is also available as "Attach Linear" in the composer's "+" menu, with a plain search list.

The picker shows each issue with team and number badges, status and priority icons, assignee, project, and labels. You can expand a row to preview the description, or open the issue in Linear. Filter by team, status, and assignee, and sort by recently updated, newest, or priority. Search by title, issue number, or identifier such as ENG-123. Filter choices are remembered on each device.

**Issue status in the workspace header.** Workspaces tied to a Linear issue show the issue identifier with its status icon in the header. Pressing it lists the team's workflow states; choosing one updates the issue's status in Linear. It also links to the issue. The status refreshes every minute while the header is on screen and whenever the list opens.

A workspace is tied to an issue by, in order: an explicit link (set automatically when you start a chat with the Linear button, or with `/link-linear PROD-123`; `/link-linear none` removes it), the issue Linear links to the workspace's pull request, an identifier in the branch, pull request title or workspace name, Linear's branch matching, a "linear issue 123" style mention in those names, or the issue named in the first message of the workspace's chats or looked up by Linear tools in that first turn.

## Setup

Requires Paseo 0.16.0-beta.1 or later on both the app and the daemon. Create a personal API key in Linear under Settings → Security & access → Personal API keys, then paste it in Settings → Plugins → Linear. If no key is saved, the plugin falls back to the `LINEAR_API_KEY` environment variable of the daemon.

## What it sends and stores

Queries and status changes go from the daemon to `api.linear.app` using your API key. Changing a status in the header writes to Linear as your user. The key is stored in this host's plugin settings as plain JSON, not in a credential vault. Lists show up to 50 issues. Priority sort orders the 100 most recently updated matches.
