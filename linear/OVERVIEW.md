Adds a "Linear" button to the composer toolbar, next to the model and mode controls, when you start a new chat: in a new agent's composer and on the New workspace screen. It is hidden in the composer of an agent that is already running. It opens an issue picker; choosing an issue attaches it to the message as a Markdown document (title, status, priority, assignee, project, labels, link, and description), shown as a pill above the composer. The same attachment is also available as "Attach Linear" in the composer's "+" menu, with a plain search list.

The picker shows each issue with team and number badges, status and priority icons, assignee, project, and labels. You can expand a row to preview the description, or open the issue in Linear. Filter by team, status, and assignee, and sort by recently updated, newest, or priority. Search by title, issue number, or identifier such as ENG-123. Filter choices are remembered on each device.

## Setup

Requires Paseo 0.16.0-beta.1 or later on both the app and the daemon. Create a personal API key in Linear under Settings → Security & access → Personal API keys, then paste it in Settings → Plugins → Linear. If no key is saved, the plugin falls back to the `LINEAR_API_KEY` environment variable of the daemon.

## What it sends and stores

Queries go from the daemon to `api.linear.app` using your API key. The key is stored in this host's plugin settings as plain JSON, not in a credential vault. Lists show up to 50 issues. Priority sort orders the 100 most recently updated matches.
