import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text } from "react-native";
import { LIFECYCLE_EVENTS, type LifecycleEvent, linearSettings } from "../shared/settings";
import { listStateChoicesRpc } from "../shared/status";
import { StatusSelect } from "./status-select";

export function LinearSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(linearSettings);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading…</Text>;
  }
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="Linear">
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

  const current = settings.values.apiKey;
  const hasKey = current.trim().length > 0;
  const value = draft ?? current;
  const dirty = draft !== null && draft.trim() !== current.trim();

  async function save(apiKey: string) {
    if (settings.status !== "ready") return;
    const ok = await settings.save({ ...settings.values, apiKey: apiKey.trim() }, settings.revision);
    if (ok) {
      setDraft(null);
      setSaved(true);
    }
  }

  return (
    <>
      <SettingsSection title="Linear">
        <SettingsCard>
          <SettingsInput
            key={settings.revision}
            label="Personal API key"
            hint={hasKey ? "A key is saved. Paste a new one to replace it." : "Required to search issues."}
            error={settings.saveError ? String(settings.saveError) : null}
            initialValue={current}
            placeholder="lin_api_…"
            secureTextEntry
            disabled={settings.saving}
            onChangeText={(text) => {
              setDraft(text);
              setSaved(false);
            }}
          />
          <SettingsAction
            label={saved ? "Saved" : "Save API key"}
            actionLabel="Save"
            disabled={!dirty || settings.saving}
            onPress={() => void save(value)}
          />
          {hasKey ? (
            <SettingsAction
              label="Remove saved key"
              actionLabel="Remove"
              disabled={settings.saving}
              onPress={() => void save("")}
            />
          ) : null}
          <SettingsRow label="Create a key" hint="Linear → Settings → Security & access → Personal API keys">
            <ExternalLink href="https://linear.app/settings/account/security">
              <Text style={{ color: theme.colors.accent }}>Open Linear</Text>
            </ExternalLink>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <StatusAutomation
        theme={theme}
        rules={settings.values.statusRules}
        revision={settings.revision}
        disabled={settings.saving}
        onChange={(statusRules) => void settings.save({ ...settings.values, statusRules }, settings.revision)}
      />
    </>
  );
}

type StatusRules = { [Event in LifecycleEvent]: string | null };

/** Which status each workspace lifecycle event moves the linked issue to. */
function StatusAutomation({
  theme,
  rules,
  revision,
  disabled,
  onChange,
}: {
  theme: PluginTheme;
  rules: StatusRules;
  /** Refetch after settings change, e.g. once an API key is saved. */
  revision: unknown;
  disabled: boolean;
  onChange(rules: StatusRules): void;
}) {
  const listStateChoices = useRpc(listStateChoicesRpc);
  const choices = useQuery({
    queryKey: ["state-choices", revision],
    queryFn: () => listStateChoices({}),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const error = choices.isError ? `Statuses could not be loaded: ${String(choices.error)}` : null;

  return (
    <SettingsSection title="Issue status automation">
      <SettingsCard>
        {LIFECYCLE_EVENTS.map((event) => (
          <SettingsRow key={event.key} label={event.label} hint={event.hint} error={error}>
            <StatusSelect
              theme={theme}
              label={event.label}
              value={rules[event.key]}
              states={choices.data?.states ?? []}
              disabled={disabled || choices.isPending}
              onChange={(value) => onChange({ ...rules, [event.key]: value })}
            />
          </SettingsRow>
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}
