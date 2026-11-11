Shows the GitHub pull request for the current workspace's branch in a panel beside your agents. Open it from the Explorer sidebar or with "Show pull request" in the Command Center.

The panel shows the PR title, state, branch and diff size; whether it can be merged and the review decision; every check with its status, linked to its run; the description rendered as Markdown; and conversation comments, reviews, and inline review comments in chronological order. It refreshes every 30 seconds and on demand.

## Setup

The daemon machine needs the GitHub CLI (`gh`) installed and signed in with `gh auth login`. The plugin runs `git` and `gh` in the workspace directory on the daemon and reads data only; it never writes to GitHub.
