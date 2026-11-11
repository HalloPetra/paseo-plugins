Auto sort archives workspaces once their work has landed. When a workspace's GitHub pull request is merged, the workspace is archived, so the sidebar only shows work that is still open. Archiving workspaces whose pull request was closed without merging is available as an opt-in rule.

## How it works

The plugin runs on the daemon and watches the pull request status Paseo already shows for each workspace. When a rule matches, it waits for the configured delay and archives the workspace. If the workspace changes during that wait, it is checked again. It keeps running with no app open; after a daemon restart it resumes on the next agent or workspace event, or when an app connects.

When the plugin is first enabled, workspaces whose pull request is already merged are archived too.

## Safety

Archiving a worktree workspace removes its worktree, so the plugin leaves a workspace alone when:

- an agent in it is running or waiting for input, until that changes
- it is pinned, a background or internal workspace, or not a Paseo worktree (local checkouts and plain directories are never archived)
- "Keep workspaces with unsaved work" is on (the default) and the worktree has uncommitted changes or commits that are on no remote. Kept workspaces are checked again after 15 minutes.

## Settings

Under Settings, Plugins, Auto sort, or "Auto sort settings" in the Command Center:

- Archive when the pull request is merged (on by default)
- Archive when the pull request is closed without merging (off by default)
- When: immediately, or after 5 minutes (default), 30 minutes, or 4 hours
- Keep workspaces with unsaved work (on by default)

The Activity section lists pending archives, recent archives, and kept workspaces with the reason they were kept. History is kept in memory and resets when the plugin restarts.

## Requirements

Requires Paseo 0.16 or later with GitHub integration enabled, so that workspaces show their pull request. The plugin runs `git status` and `git rev-list` in the workspace directory before archiving and does not contact GitHub itself.
