Shows the GitHub pull request for the current workspace's branch in a panel beside your agents, and lets you merge it or hand failing checks to an agent. Open it from the Explorer sidebar, the pull request button in the workspace header, or "Show pull request" in the Command Center.

The panel shows the PR title, state, branch and diff size; whether it can be merged and the review decision; every check with its status, linked to its run; the description rendered as Markdown; and conversation comments, reviews, and inline review comments in chronological order. Sections and comments can be collapsed, and comments from common bots start collapsed. With the Link opener plugin installed, links in comments and the description show its open-in popover. It refreshes every 30 seconds and on demand. The header button is tinted by the PR's overall status and shows its number.

## Merging

The merge button defaults to a merge commit; its dropdown offers squash and rebase when the repository allows them. Clicking it merges right away; GitHub refuses the merge if the branch moved since the panel loaded. The branch is not deleted. The button is disabled for drafts, merge conflicts, branch protection blocks, and branches that must be updated first.

## Fixing failing checks

When checks fail, "Fix failing checks" fills the composer of the most recently active agent in the workspace (or one you choose) with a prompt to fix them, and attaches a document with each failing check's annotations and failed-step log excerpt. Nothing is sent until you send it. Logs are only available for GitHub Actions checks; other checks are listed with a link. Failing check logs can also be attached from the composer's "+" menu by entering a PR URL or owner/repo#123.

## Setup

Requires Paseo 0.16 or later. The daemon machine needs the GitHub CLI (`gh`) installed and signed in with `gh auth login`. The plugin runs `git` and `gh` in the workspace directory on the daemon. It reads PR data and check logs, and writes to GitHub only when you merge.
