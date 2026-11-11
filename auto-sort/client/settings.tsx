import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { DELAYS, type Rules, rulesSettings, watcherStatusRpc } from "../shared/rules";

function relative(iso: string, now: number): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(minutes);
  const span = abs < 1 ? "less than a minute" : abs < 60 ? `${abs} min` : `${Math.round(abs / 60)} h`;
  return minutes >= 0 ? `in ${span}` : `${span} ago`;
}

function Activity({ theme }: PluginSurfaceProps) {
  const status = useRpc(watcherStatusRpc);
  const query = useQuery({
    queryKey: ["auto-sort", "status"],
    queryFn: () => status({}),
    refetchInterval: 10_000,
  });
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13 };

  if (query.isError) {
    return (
      <SettingsSection title="Activity">
        <SettingsCard>
          <SettingsAction
            label="Status unavailable"
            error={String(query.error)}
            actionLabel="Retry"
            onPress={() => void query.refetch()}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }
  const data = query.data;
  const now = Date.now();
  return (
    <SettingsSection title="Activity">
      <SettingsCard>
        <SettingsRow
          label={data ? (data.watching ? "Watching" : "Not watching") : "Loading…"}
          hint={data ? `${data.workspaces} workspaces on this host` : undefined}
        />
        {data?.pending.map((entry) => (
          <SettingsRow
            key={`pending-${entry.workspaceId}`}
            label={entry.name}
            hint={`PR ${entry.reason}, archiving ${relative(entry.dueAt, now)}`}
          />
        ))}
        {data?.recent.map((entry) => (
          <SettingsRow
            key={`${entry.workspaceId}-${entry.at}`}
            label={entry.name}
            hint={`${entry.project}${entry.prNumber ? ` · PR #${entry.prNumber}` : ""} ${entry.reason} · ${relative(entry.at, now)}`}
            error={entry.error}
          >
            {entry.error ? null : <Text style={muted}>Archived</Text>}
          </SettingsRow>
        ))}
        {data && data.pending.length === 0 && data.recent.length === 0 ? (
          <SettingsRow label="Nothing archived since the plugin started" />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

export function AutoSortSettings(props: PluginSurfaceProps) {
  const { theme } = props;
  const settings = useSettings(rulesSettings);

  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading…</Text>;
  }
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="Rules">
        <SettingsCard>
          <SettingsAction
            label="Settings could not be loaded"
            error={String(settings.error)}
            actionLabel={settings.status === "invalid" ? "Reset" : "Retry"}
            onPress={() => void (settings.status === "invalid" ? settings.reset() : settings.reload())}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const values = settings.values;
  const set = (patch: Partial<Rules>) => void settings.save({ ...values, ...patch }, settings.revision);

  return (
    <>
      <SettingsSection title="Rules">
        <SettingsCard>
          <SettingsSwitch
            label="Archive when the pull request is merged"
            value={values.archiveOnMerge}
            disabled={settings.saving}
            onValueChange={(archiveOnMerge) => set({ archiveOnMerge })}
          />
          <SettingsSwitch
            label="Archive when the pull request is closed without merging"
            value={values.archiveOnClose}
            disabled={settings.saving}
            onValueChange={(archiveOnClose) => set({ archiveOnClose })}
          />
          <SettingsSelect
            label="When"
            hint="Archiving waits while an agent in the workspace is running or needs input."
            value={values.delayMinutes}
            options={DELAYS.map(({ value, label }) => ({ value, label }))}
            disabled={settings.saving}
            onValueChange={(delayMinutes) => set({ delayMinutes: delayMinutes as Rules["delayMinutes"] })}
          />
          <SettingsSwitch
            label="Keep workspaces with unsaved work"
            hint="Archiving removes the worktree. Skip it when there are uncommitted changes or commits on no remote."
            error={settings.saveError ? String(settings.saveError) : null}
            value={values.keepUnsavedWork}
            disabled={settings.saving}
            onValueChange={(keepUnsavedWork) => set({ keepUnsavedWork })}
          />
        </SettingsCard>
      </SettingsSection>
      <Activity {...props} />
    </>
  );
}
