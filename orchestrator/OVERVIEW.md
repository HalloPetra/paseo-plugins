# Orchestrator

Gives each project an orchestrator: one workspace whose agent can see the project's other workspaces, hand them work, ask them questions, start new ones, and collect their results.

## Setup

On the New workspace screen, switch on the **Orchestrator** icon toggle next to the project and branch pickers before creating the workspace. The workspace works in the project directory rather than its own worktree, is named "Orchestrator", and is pinned in the sidebar. A project has at most one orchestrator; while one exists, the toggle is hidden.

Only the orchestrator's agent gets the tools. Other workspaces need nothing: messages reach them as ordinary prompts, and their final message is passed back as the answer.

## How it works

A message is delivered as a prompt to the workspace's oldest live agent. If that agent is idle it starts right away; if it is busy, the message waits until its current turn ends, and everything that queued up is delivered together. In the receiving chat, messages appear as message bubbles. Messages are saved under `~/.paseo/orchestrator/` and survive restarts.

## Tools the orchestrator gets

- `orchestrator_overview` lists the project's workspaces with their agents and status.
- `orchestrator_send` sends a message to one or more workspaces, or `all`. With `report_back`, the receiver's final message comes back once it has handled the message.
- `orchestrator_ask` asks a question and waits up to about ten minutes for the receiver's final message. A later answer arrives as a new prompt.
- `orchestrator_inbox` lists conversations or shows one in full.
- `orchestrator_wait` waits until a set of workspaces stop working, then returns each one's final message.
- `orchestrator_read` shows a workspace's recent conversation and tool calls.
- `orchestrator_spawn` starts a workspace in the project, by default on a new branch in its own git worktree, with an agent that starts on a task and reports back when done.

## Limits

- The orchestrator only sees and reaches workspaces in its own project.
- A workspace becomes an orchestrator only when it is created with the toggle on.
- A thread stops waking agents after 40 messages.
- Messages wake agents without asking you first. Agents act on them with the permissions they already have.
