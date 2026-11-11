import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { linearSettings } from "../shared/settings";

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
  );
}
