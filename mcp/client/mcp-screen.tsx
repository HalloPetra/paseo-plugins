import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Loading, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { cachedStatusRpc, importServersRpc, listTargetsRpc, type Server, statusRpc } from "../shared/mcp";
import { ProjectPicker, TargetPicker } from "./pickers";
import { ServerCard } from "./server-card";
import { ServerForm } from "./server-form";
import { Button, useStyles } from "./styles";

const SECTIONS: { scope: string; title: string; hint: string }[] = [
  { scope: "shared", title: "All profiles", hint: "Shared plugin · every login, every project" },
  { scope: "user", title: "This login", hint: "Every project" },
  { scope: "local", title: "This login, this project", hint: "Local scope" },
  { scope: "project", title: "Shared with the project", hint: ".mcp.json" },
  { scope: "claudeai", title: "Claude.ai connectors", hint: "From your claude.ai account" },
];

/** A probe connects to every server, so reuse results for a while. Refresh forces a new one. */
const STALE_MS = 5 * 60_000;

function relative(iso: string): string {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export function McpScreen({ theme, layout }: PluginScreenProps) {
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const queryClient = useQueryClient();
  const listTargets = useRpc(listTargetsRpc);
  const getStatus = useRpc(statusRpc);
  const getCachedStatus = useRpc(cachedStatusRpc);
  const importServers = useRpc(importServersRpc);

  const [targetId, setTargetId] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [pickingProject, setPickingProject] = useState(false);
  const [form, setForm] = useState<{ editing: Server | null; key: number } | null>(null);

  const targetsQuery = useQuery({
    queryKey: ["mcp", "targets", targetId],
    queryFn: () => listTargets({ targetId: targetId ?? undefined }),
    placeholderData: (previous) => previous,
    staleTime: STALE_MS,
    gcTime: Infinity,
  });
  const targets = targetsQuery.data?.targets ?? [];
  const activeTarget = targets.find((target) => target.id === targetId) ?? targets.find((target) => target.active) ?? targets[0];
  const effectiveTargetId = activeTarget?.id ?? null;
  const effectiveCwd = cwd ?? targetsQuery.data?.home ?? null;

  useEffect(() => {
    if (!targetId && activeTarget) setTargetId(activeTarget.id);
  }, [targetId, activeTarget]);

  const statusKey = useMemo(() => ["mcp", "status", effectiveTargetId, effectiveCwd] as const, [effectiveTargetId, effectiveCwd]);
  const ready = Boolean(effectiveTargetId && effectiveCwd);
  // The daemon keeps the last probe. Seed the status query with it, dated to when it ran, so the
  // screen fills instantly and only probes again when the cached result is stale.
  const cachedQuery = useQuery({
    queryKey: ["mcp", "cached", effectiveTargetId, effectiveCwd],
    queryFn: async () => {
      const { status } = await getCachedStatus({ targetId: effectiveTargetId!, cwd: effectiveCwd! });
      if (status && !queryClient.getQueryData(statusKey)) {
        queryClient.setQueryData(statusKey, status, { updatedAt: Date.parse(status.probedAt) });
      }
      return status !== null;
    },
    enabled: ready,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: () => getStatus({ targetId: effectiveTargetId!, cwd: effectiveCwd! }),
    enabled: ready && (cachedQuery.isFetched || cachedQuery.isError),
    staleTime: STALE_MS,
    gcTime: Infinity,
  });

  const project = targetsQuery.data?.projects.find((candidate) => candidate.path === effectiveCwd);
  const projectLabel = project?.label ?? effectiveCwd ?? "";
  const scope = { targetId: effectiveTargetId ?? "", cwd: effectiveCwd ?? "", statusKey };

  const importMutation = useMutation({
    mutationFn: (input: { fromTargetId: string; names: string[] }) =>
      importServers({ targetId: effectiveTargetId!, ...input }),
    onSuccess: ({ imported }) => {
      toast.show(
        imported.length
          ? `Copied ${imported.join(", ")}. Servers that use OAuth need a sign-in on this login.`
          : "Nothing to copy.",
        { variant: "success" },
      );
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (targetsQuery.isError) {
    return (
      <View style={styles.screen}>
        <Text style={[styles.error, { padding: 24 }]}>{(targetsQuery.error as Error).message}</Text>
      </View>
    );
  }
  if (!targetsQuery.data) return <Loading />;

  const status = statusQuery.data;
  const servers = status?.servers ?? [];
  const known = new Set(SECTIONS.map((section) => section.scope));
  const otherScopes = [...new Set(servers.map((server) => server.scope).filter((value) => !known.has(value)))];
  const sections = [
    ...SECTIONS,
    ...otherScopes.map((value) => ({
      scope: value,
      title: value === "dynamic" || value.startsWith("plugin") ? "Plugins" : value,
      hint: "Managed elsewhere",
    })),
  ];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { flexGrow: 1 }]}>
        <View style={styles.toolbar}>
          {targets.length > 1 ? (
            <TargetPicker
              targets={targets}
              value={effectiveTargetId ?? ""}
              onChange={(id) => setTargetId(id)}
              styles={styles}
            />
          ) : null}
          <Button label={`Project: ${projectLabel}`} onPress={() => setPickingProject(true)} styles={styles} theme={theme} />
          <View style={styles.grow} />
          <Button
            label="Refresh"
            busy={statusQuery.isFetching}
            onPress={() => void statusQuery.refetch()}
            styles={styles}
            theme={theme}
          />
          <Button
            label="Add server"
            tone="primary"
            onPress={() => setForm({ editing: null, key: Date.now() })}
            styles={styles}
            theme={theme}
          />
        </View>

        {status?.importable.map((candidate) => (
          <View key={candidate.fromTargetId} style={styles.banner}>
            <View style={styles.rowMain}>
              <Text style={styles.text}>
                {activeTarget?.label} is missing {candidate.names.length} server
                {candidate.names.length === 1 ? "" : "s"} that {candidate.fromLabel} has.
              </Text>
              <Text style={styles.muted} numberOfLines={2}>
                {candidate.names.join(", ")}
              </Text>
            </View>
            <Button
              label={`Copy from ${candidate.fromLabel}`}
              busy={importMutation.isPending}
              onPress={() => importMutation.mutate({ fromTargetId: candidate.fromTargetId, names: candidate.names })}
              styles={styles}
              theme={theme}
            />
          </View>
        ))}

        {!statusQuery.data && !statusQuery.isError ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.colors.foregroundMuted} />
            <Text style={styles.muted}>Connecting to MCP servers…</Text>
          </View>
        ) : statusQuery.isError ? (
          <View style={styles.banner}>
            <Text style={[styles.error, styles.grow]}>{(statusQuery.error as Error).message}</Text>
            <Button label="Retry" onPress={() => void statusQuery.refetch()} styles={styles} theme={theme} />
          </View>
        ) : (
          <>
            {sections.map((section) => {
              const list = servers.filter((server) => server.scope === section.scope);
              if (!list.length && section.scope !== "shared") return null;
              return (
                <View key={section.scope} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.muted}>{section.hint}</Text>
                  </View>
                  <View style={styles.card}>
                    {list.length ? (
                      list.map((server, index) => (
                        <ServerCard
                          key={`${server.scope}:${server.name}`}
                          server={server}
                          scope={scope}
                          first={index === 0}
                          onEdit={(editing) => setForm({ editing, key: Date.now() })}
                          theme={theme}
                          styles={styles}
                        />
                      ))
                    ) : (
                      <Text style={styles.empty}>No servers yet.</Text>
                    )}
                  </View>
                </View>
              );
            })}
            {status ? (
              <Text style={styles.muted}>
                {statusQuery.isFetching ? "Refreshing… Last checked " : "Checked "}
                {relative(status.probedAt)}
                {status.partial ? " · some servers were still connecting" : ""}. On/off switches apply to the
                selected project. Denied tools are written to {status.settingsPath} and hidden from every session on
                this login. Running agents pick up changes when they reload.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <ProjectPicker
        open={pickingProject}
        onClose={() => setPickingProject(false)}
        projects={targetsQuery.data.projects}
        value={effectiveCwd ?? ""}
        onChange={setCwd}
        theme={theme}
        styles={styles}
      />
      {form && effectiveTargetId && effectiveCwd ? (
        <ServerForm
          key={form.key}
          open
          onClose={() => setForm(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["mcp"] })}
          editing={form.editing}
          targetId={effectiveTargetId}
          cwd={effectiveCwd}
          projectLabel={projectLabel}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </View>
  );
}
