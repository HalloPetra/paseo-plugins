import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  cancelLoginRpc,
  getLoginRpc,
  isEditableScope,
  isRemovableScope,
  type LoginState,
  permissionPrefix,
  removeServerRpc,
  type Server,
  setToolsDeniedRpc,
  startLoginRpc,
  type Status,
  toggleServerRpc,
} from "../shared/mcp";
import { ConfirmDialog } from "./confirm-dialog";
import {
  Button,
  DESTRUCTIVE_FOREGROUND,
  fillFeedback,
  STATUS_LABEL,
  type Styles,
  statusColor,
  Switch,
} from "./styles";

export interface Scope {
  targetId: string;
  cwd: string;
  statusKey: readonly unknown[];
}

function LoginPanel({
  login,
  onDone,
  theme,
  styles,
}: {
  login: LoginState;
  onDone(state: LoginState): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  const getLogin = useRpc(getLoginRpc);
  const cancel = useRpc(cancelLoginRpc);
  const poll = useQuery({
    queryKey: ["mcp", "login", login.id],
    queryFn: () => getLogin({ id: login.id }),
    initialData: login,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });
  const state = poll.data ?? login;
  const handled = useRef(false);
  useEffect(() => {
    if (state.status === "running" || handled.current) return;
    handled.current = true;
    onDone(state);
  }, [state, onDone]);

  if (state.status !== "running") return null;
  return (
    <View style={[styles.banner, { borderColor: theme.colors.accent }]}>
      <View style={styles.rowMain}>
        <Text style={styles.text}>Finish signing in to {state.server} in your browser.</Text>
        <Text style={styles.muted}>
          The browser opens on the machine running Paseo. If it did not, open the link.
        </Text>
      </View>
      {state.url ? (
        <Button
          label="Open link"
          onPress={() => void openExternalUrl(state.url!)}
          styles={styles}
          theme={theme}
        />
      ) : null}
      <Button label="Cancel" onPress={() => void cancel({ id: state.id })} styles={styles} theme={theme} />
    </View>
  );
}

export function ServerCard({
  server,
  scope,
  first,
  onEdit,
  theme,
  styles,
}: {
  server: Server;
  scope: Scope;
  first: boolean;
  onEdit(server: Server): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const toggle = useRpc(toggleServerRpc);
  const remove = useRpc(removeServerRpc);
  const startLogin = useRpc(startLoginRpc);
  const setDenied = useRpc(setToolsDeniedRpc);

  const editable = isEditableScope(server.scope);
  const removable = isRemovableScope(server.scope);
  const enabled = server.status !== "disabled";
  const allowed = server.tools.filter((tool) => !tool.denied).length;
  const refresh = () => queryClient.invalidateQueries({ queryKey: scope.statusKey });

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) => toggle({ targetId: scope.targetId, cwd: scope.cwd, name: server.name, enabled: next }),
    onSuccess: (status) => queryClient.setQueryData(scope.statusKey, status),
    onError: (error: Error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!isRemovableScope(server.scope)) throw new Error(`${server.name} cannot be removed here.`);
      await remove({ targetId: scope.targetId, cwd: scope.cwd, name: server.label, scope: server.scope });
    },
    // Drop the row right away; removal signs out and edits config in the background. These
    // callbacks live on the mutation, so they still run after this row unmounts.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: scope.statusKey });
      const previous = queryClient.getQueryData<Status>(scope.statusKey);
      queryClient.setQueryData<Status>(scope.statusKey, (status) =>
        status
          ? {
              ...status,
              servers: status.servers.filter(
                (candidate) => !(candidate.name === server.name && candidate.scope === server.scope),
              ),
            }
          : status,
      );
      return { previous };
    },
    onSuccess: () => {
      toast.show(
        server.scope === "shared" ? `Removed ${server.label} from every profile.` : `Removed ${server.label}.`,
        { variant: "success" },
      );
    },
    onError: (error: Error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(scope.statusKey, context.previous);
      toast.error(`Could not remove ${server.label}: ${error.message}`);
    },
  });

  const loginMutation = useMutation({
    mutationFn: (logoutFirst: boolean) =>
      startLogin({ targetId: scope.targetId, cwd: scope.cwd, name: server.name, logoutFirst }),
    onSuccess: setLogin,
    onError: (error: Error) => toast.error(error.message),
  });

  /** Updates the cached status in place: deny rules need no new probe. */
  const applyDenied = (names: Set<string>, denied: boolean, clearServerRule: boolean) => {
    queryClient.setQueryData<Status>(scope.statusKey, (status) =>
      status
        ? {
            ...status,
            servers: status.servers.map((candidate) =>
              candidate.name !== server.name
                ? candidate
                : {
                    ...candidate,
                    serverDenied: clearServerRule ? false : candidate.serverDenied,
                    tools: candidate.tools.map((tool) =>
                      names.has(tool.fullName) ? { ...tool, denied } : tool,
                    ),
                  },
            ),
          }
        : status,
    );
  };

  const toolsMutation = useMutation({
    mutationFn: async ({ fullNames, denied }: { fullNames: string[]; denied: boolean }) => {
      if (!denied && server.serverDenied) {
        // A server-wide rule blocks everything: replace it with one rule per tool still denied.
        const keep = server.tools.map((tool) => tool.fullName).filter((name) => !fullNames.includes(name));
        if (keep.length) await setDenied({ targetId: scope.targetId, fullNames: keep, denied: true });
        await setDenied({
          targetId: scope.targetId,
          fullNames,
          denied: false,
          serverRule: permissionPrefix(server.name),
        });
        return;
      }
      await setDenied({ targetId: scope.targetId, fullNames, denied });
    },
    onMutate: ({ fullNames, denied }) => applyDenied(new Set(fullNames), denied, !denied),
    onError: (error: Error) => {
      toast.error(error.message);
      void refresh();
    },
  });

  const onLoginDone = (state: LoginState) => {
    setLogin(null);
    if (state.status === "succeeded") {
      toast.show(`Signed in to ${server.name}.`, { variant: "success" });
      void refresh();
    } else if (state.status === "failed") {
      const reason = state.output.trim().split("\n").slice(-2).join(" ");
      toast.error(`Sign-in to ${server.name} failed${reason ? `: ${reason}` : "."}`);
    }
  };

  return (
    <View style={!first && styles.rowDivider}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${server.name}`}
          onPress={() => setExpanded((value) => !value)}
          style={[styles.toolbar, styles.grow, { flexWrap: "nowrap" }]}
        >
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} />
          <View style={[styles.dot, { backgroundColor: statusColor(theme, server.status) }]} />
          <View style={styles.rowMain}>
            <View style={styles.nameLine}>
              <Text style={styles.strong}>{server.label}</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{server.transport}</Text>
              </View>
              <Text style={[styles.muted, { color: statusColor(theme, server.status) }]}>
                {STATUS_LABEL[server.status]}
              </Text>
            </View>
            {server.summary ? (
              <Text style={styles.mono} numberOfLines={1}>
                {server.summary}
              </Text>
            ) : null}
            {server.error ? (
              <Text style={styles.error} numberOfLines={2}>
                {server.error}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {server.tools.length ? (
          <Text style={styles.muted}>
            {allowed}/{server.tools.length} tools
          </Text>
        ) : null}
        {server.status === "hidden" ? null : (
          <Switch
            label={`${enabled ? "Disable" : "Enable"} ${server.label}`}
            value={enabled}
            disabled={toggleMutation.isPending}
            onValueChange={(next) => toggleMutation.mutate(next)}
            styles={styles}
            theme={theme}
          />
        )}
        {removable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${server.label}`}
            disabled={removeMutation.isPending}
            onPress={() => setConfirmingRemove(true)}
            hitSlop={6}
            style={(state) => [styles.iconButton, styles.destructiveIconButton, fillFeedback(state)]}
          >
            <Icon name="Trash2" size={15} color={DESTRUCTIVE_FOREGROUND} />
          </Pressable>
        ) : null}
      </View>

      {login ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <LoginPanel login={login} onDone={onLoginDone} theme={theme} styles={styles} />
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.expanded}>
          <View style={styles.actions}>
            {server.canLogin ? (
              server.status === "needs-auth" ? (
                <Button
                  label="Sign in"
                  tone="primary"
                  busy={loginMutation.isPending}
                  disabled={Boolean(login)}
                  onPress={() => loginMutation.mutate(false)}
                  styles={styles}
                  theme={theme}
                />
              ) : (
                <Button
                  label="Sign in again"
                  busy={loginMutation.isPending}
                  disabled={Boolean(login)}
                  onPress={() => loginMutation.mutate(true)}
                  styles={styles}
                  theme={theme}
                />
              )
            ) : null}
            {editable ? (
              <Button label="Edit" onPress={() => onEdit(server)} styles={styles} theme={theme} />
            ) : null}
          </View>

          {server.headersHelper ? (
            <Text style={styles.muted}>
              Signs in through <Text style={styles.mono}>{server.headersHelper}</Text>. If it needs sign-in, sign in with
              that tool, then refresh.
            </Text>
          ) : null}
          {!editable ? (
            <Text style={styles.muted}>
              {server.scope === "claudeai"
                ? "A claude.ai connector. Add or remove it at claude.ai → Settings → Connectors."
                : server.scope === "project"
                  ? "Defined in the project's .mcp.json."
                  : `Provided by ${server.scope}. Manage it where it comes from.`}
            </Text>
          ) : null}
          {server.serverInfo ? <Text style={styles.muted}>Server: {server.serverInfo}</Text> : null}

          {server.tools.length ? (
            <View>
              <View style={[styles.toolbar, { paddingVertical: 6 }]}>
                <Text style={[styles.title, styles.grow]}>Tools</Text>
                <Button
                  label="Allow all"
                  disabled={allowed === server.tools.length}
                  onPress={() =>
                    toolsMutation.mutate({ fullNames: server.tools.map((tool) => tool.fullName), denied: false })
                  }
                  styles={styles}
                  theme={theme}
                />
                <Button
                  label="Deny all"
                  disabled={allowed === 0}
                  onPress={() =>
                    toolsMutation.mutate({ fullNames: server.tools.map((tool) => tool.fullName), denied: true })
                  }
                  styles={styles}
                  theme={theme}
                />
                <Button
                  label="Read-only"
                  onPress={() => {
                    const writes = server.tools.filter((tool) => !tool.readOnly && !tool.denied);
                    const reads = server.tools.filter((tool) => tool.readOnly && tool.denied);
                    if (reads.length) toolsMutation.mutate({ fullNames: reads.map((tool) => tool.fullName), denied: false });
                    if (writes.length) toolsMutation.mutate({ fullNames: writes.map((tool) => tool.fullName), denied: true });
                  }}
                  disabled={!server.tools.some((tool) => tool.readOnly)}
                  styles={styles}
                  theme={theme}
                />
              </View>
              {server.tools.map((tool) => (
                <View key={tool.name} style={styles.toolRow}>
                  <View style={[styles.rowMain, styles.nameLine]}>
                    <Text style={[styles.text, tool.denied && { color: theme.colors.foregroundMuted }]}>{tool.name}</Text>
                    {tool.readOnly ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>read-only</Text>
                      </View>
                    ) : null}
                    {tool.destructive ? (
                      <View style={[styles.badge, { borderColor: theme.colors.statusDanger }]}>
                        <Text style={[styles.badgeText, { color: theme.colors.statusDanger }]}>destructive</Text>
                      </View>
                    ) : null}
                  </View>
                  <Switch
                    label={`${tool.denied ? "Allow" : "Deny"} ${tool.name}`}
                    value={!tool.denied}
                    onValueChange={(next) => toolsMutation.mutate({ fullNames: [tool.fullName], denied: !next })}
                    styles={styles}
                    theme={theme}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>
              {server.status === "connected"
                ? "This server offers no tools."
                : "Tools appear once the server connects."}
            </Text>
          )}
        </View>
      ) : null}
      {removable ? (
        <ConfirmDialog
          open={confirmingRemove}
          title={`Remove ${server.label}?`}
          description={
            server.scope === "shared"
              ? `${server.label} will be removed from every Claude Code profile on this machine and signed out on each login.`
              : server.scope === "project"
                ? `${server.label} will be removed from this project's .mcp.json, which changes a file in the repository.`
                : `${server.label} will be removed from this login${server.scope === "local" ? " for this project" : ""} and signed out.`
          }
          detail="Agents lose its tools when their session reloads. To get it back, add it again."
          confirmLabel="Remove"
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            setConfirmingRemove(false);
            removeMutation.mutate();
          }}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </View>
  );
}
