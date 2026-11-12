# Orchestrator

Lets the agents in your Paseo workspaces talk to each other. Every agent gets a set of tools to see the other workspaces, send them messages, ask them questions, and wait for their results. One agent can also start new workspaces and hand them work, so a single session can coordinate all the others.

## How it works

A message to another workspace is delivered as a prompt to that workspace's agent. If the agent is idle it starts on the message right away. If it is busy, the message waits until the current turn ends, and everything that queued up is delivered together. Messages are saved under `~/.paseo/orchestrator/` and survive restarts.

In the receiving agent's chat, these prompts appear as compact cards showing who sent them and what kind of message they are (message, question, reply, report, or task). Expand a card to read the full text.

## Tools agents get

- `orchestrator_overview` lists every workspace with its agents, their status, and which agent receives messages for the workspace (its oldest live agent).
- `orchestrator_send` sends a message to one or more workspaces, specific agents, or `all`. With `report_back`, the receiver's final message is sent back automatically once it has handled the message.
- `orchestrator_ask` asks a question and waits for the answer, for up to about ten minutes. If the receiver finishes without replying, its final message is returned instead.
- `orchestrator_reply` answers a message by its thread id.
- `orchestrator_inbox` lists your conversations or shows one thread in full.
- `orchestrator_wait` waits until a set of workspaces has stopped working, then returns each one's final message.
- `orchestrator_read` shows another workspace's recent conversation and tool calls.
- `orchestrator_spawn` creates a workspace, by default on a new branch in its own git worktree, with an agent that starts on a task and reports back when done.

## Limits

- Only workspaces on the same host can talk to each other.
- Background helper agents do not get the tools.
- A thread stops waking agents after 40 messages so two agents cannot loop forever. Starting a new thread continues the conversation.
- Two agents waiting on each other with `orchestrator_ask` cannot answer until one of them times out.
- Agents that are already open get the tools at their next prompt after the plugin is enabled.
- Messages wake agents without asking you first. Agents act on them with the permissions they already have.
