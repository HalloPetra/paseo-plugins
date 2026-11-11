import type { PluginClientContext, PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { Issue } from "../shared/browse";
import { listTeamStatesRpc, resolveWorkspaceIssueRpc, setIssueStateRpc } from "../shared/status";
import { HoverPressable } from "./hover-pressable";
import { StatusIcon } from "./status-icon";

const BUTTON_ID = "linear-status";
const REFRESH_MS = 60_000;

/** What Paseo's workspace snapshot tells us about the branch and PR. */
interface WorkspaceRef {
  id: string;
  githubRuntime?: { pullRequest?: { url: string; headRefName: string } | null } | null;
  gitRuntime?: { currentBranch?: string | null } | null;
}

interface Linked {
  input: { prUrl: string | null; branches: string[] };
  key: string;
  issue: Issue | null;
  registration: PluginButtonRegistration | null;
  generation: number;
}

function lookupInput(workspace: WorkspaceRef) {
  const pr = workspace.githubRuntime?.pullRequest ?? null;
  const branches = [...new Set([pr?.headRefName, workspace.gitRuntime?.currentBranch].filter((b): b is string => Boolean(b)))];
  const input = { prUrl: pr?.url ?? null, branches };
  return { input, key: `${input.prUrl ?? ""}|${branches.join(",")}` };
}

/**
 * Adds a header button to every workspace whose PR or branch Linear links to an issue. The button
 * shows the issue's status and opens a popover to change it.
 */
export function startHeaderStatus(client: PluginClientContext): () => void {
  const lifetime = new AbortController();
  const linked = new Map<string, Linked>();
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  function buttonFor(issue: Issue) {
    return {
      title: `${issue.identifier} · ${issue.state.name}`,
      label: issue.identifier,
      icon: HeaderIcon,
      behavior: { kind: "popover" as const, Content: StatusPopover },
    };
  }

  function setIssue(workspaceId: string, issue: Issue | null) {
    const entry = linked.get(workspaceId);
    if (!entry || lifetime.signal.aborted) return;
    entry.issue = issue;
    if (!issue) {
      entry.registration?.remove();
      entry.registration = null;
    } else if (entry.registration) {
      entry.registration.update(buttonFor(issue));
    } else {
      entry.registration = client.addHeaderButton({ id: BUTTON_ID, workspaceId, button: buttonFor(issue) });
    }
    notify();
  }

  async function refresh(workspaceId: string) {
    const entry = linked.get(workspaceId);
    if (!entry) return;
    const generation = ++entry.generation;
    try {
      const { issue } = await client.rpc(resolveWorkspaceIssueRpc, entry.input);
      if (linked.get(workspaceId)?.generation === generation) setIssue(workspaceId, issue);
    } catch (error) {
      // Keep the last known button; a missing key or network error must not flicker it away.
      if (!lifetime.signal.aborted) console.warn("[linear] issue lookup failed", error);
    }
  }

  function track(workspace: WorkspaceRef) {
    const { input, key } = lookupInput(workspace);
    const existing = linked.get(workspace.id);
    if (existing?.key === key) return;
    if (!input.prUrl && input.branches.length === 0) return forget(workspace.id);
    if (existing) {
      existing.input = input;
      existing.key = key;
    } else {
      linked.set(workspace.id, { input, key, issue: null, registration: null, generation: 0 });
    }
    void refresh(workspace.id);
  }

  function forget(workspaceId: string) {
    const entry = linked.get(workspaceId);
    if (!entry) return;
    entry.registration?.remove();
    linked.delete(workspaceId);
    notify();
  }

  function useIssue(workspaceId: string): Issue | null {
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => version,
    );
    return linked.get(workspaceId)?.issue ?? null;
  }

  function HeaderIcon(props: PluginButtonIconProps) {
    const workspaceId = props.workspaceId;
    const issue = useIssue(workspaceId);
    // Pick up changes made in Linear while this header is on screen.
    useEffect(() => {
      const timer = setInterval(() => void refresh(workspaceId), REFRESH_MS);
      return () => clearInterval(timer);
    }, [workspaceId]);
    if (!issue) return <Icon name="CircleDashed" size={props.size} color={props.color} />;
    return <StatusIcon type={issue.state.type} color={issue.state.color} size={props.size} />;
  }

  function StatusPopover({ theme, workspaceId, close }: PluginButtonContentProps) {
    const issue = useIssue(workspaceId);
    const listStates = useRpc(listTeamStatesRpc);
    const setState = useRpc(setIssueStateRpc);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => void refresh(workspaceId), [workspaceId]);
    const states = useQuery({
      queryKey: ["team-states", issue?.teamId],
      queryFn: () => listStates({ teamId: issue?.teamId as string }),
      enabled: Boolean(issue?.teamId),
      staleTime: 5 * 60_000,
    });
    if (!issue) return <ActivityIndicator color={theme.colors.foregroundMuted} />;

    async function choose(stateId: string) {
      if (!issue || stateId === issue.state.id) return close();
      setPending(stateId);
      setError(null);
      try {
        const { issue: updated } = await setState({ issueId: issue.id, stateId });
        setIssue(workspaceId, updated);
        close();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(null);
      }
    }

    const muted = theme.colors.foregroundMuted;
    return (
      <View style={{ minWidth: 220, gap: 2 }}>
        <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 8, paddingBottom: 6 }} numberOfLines={1}>
          {issue.identifier} · {issue.title}
        </Text>
        {states.isLoading ? <ActivityIndicator color={muted} style={{ padding: 8 }} /> : null}
        {(states.data?.states ?? []).map((state) => {
          const current = state.id === issue.state.id;
          return (
            <HoverPressable
              key={state.id}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: current, busy: pending === state.id }}
              disabled={pending !== null}
              onPress={() => void choose(state.id)}
              style={({ hovered }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                height: 30,
                paddingHorizontal: 8,
                borderRadius: 6,
                backgroundColor: hovered ? theme.colors.surface2 : "transparent",
              })}
            >
              <StatusIcon type={state.type} color={state.color} size={14} />
              <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }} numberOfLines={1}>
                {state.name}
              </Text>
              {pending === state.id ? (
                <ActivityIndicator size="small" color={muted} />
              ) : current ? (
                <Icon name="Check" size={14} color={theme.colors.foreground} />
              ) : null}
            </HoverPressable>
          );
        })}
        {error || states.error ? (
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12, paddingHorizontal: 8, paddingTop: 4 }}>
            {error ?? (states.error instanceof Error ? states.error.message : String(states.error))}
          </Text>
        ) : null}
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />
        <HoverPressable
          accessibilityRole="link"
          onPress={() => {
            close();
            void openExternalUrl(issue.url);
          }}
          style={({ hovered }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            height: 30,
            paddingHorizontal: 8,
            borderRadius: 6,
            backgroundColor: hovered ? theme.colors.surface2 : "transparent",
          })}
        >
          <Icon name="ExternalLink" size={14} color={muted} />
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Open in Linear</Text>
        </HoverPressable>
      </View>
    );
  }

  let releaseSubscription: (() => void) | null = null;
  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ entries, subscription }) => {
      if (lifetime.signal.aborted) {
        void subscription.release();
        return undefined;
      }
      for (const workspace of entries) track(workspace);
      const unsubscribe = subscription.subscribe({
        snapshot: ({ entries: next }) => {
          const ids = new Set(next.map((workspace) => workspace.id));
          for (const id of [...linked.keys()]) if (!ids.has(id)) forget(id);
          for (const workspace of next) track(workspace);
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "upsert") track(update.workspace);
          else forget(update.id);
        },
      });
      releaseSubscription = () => {
        unsubscribe();
        void subscription.release();
      };
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("[linear] workspace observation failed", error);
    });

  return () => {
    lifetime.abort();
    releaseSubscription?.();
    for (const entry of linked.values()) entry.registration?.remove();
    linked.clear();
    listeners.clear();
  };
}
