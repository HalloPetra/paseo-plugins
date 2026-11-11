# Subagent messages

When a Claude Code agent delegates work to a subagent, the subagent's final report comes back into the conversation as a user message wrapped in an `<agent-message>` tag, with a harness preamble. Paseo shows that raw, so it looks like you wrote it.

This plugin replaces those messages with a collapsible "Subagent report" card. The card shows the subagent's short ID and the first line of the report, and expands to the full report rendered as Markdown. The preamble and the harness indentation are removed.

Only messages made up entirely of `<agent-message>` blocks are changed. Anything else, including your own messages that mention the tag, is left as is. The plugin runs only in the app and sends nothing anywhere.
