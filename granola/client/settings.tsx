import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { granolaSettings } from "../shared/settings";

export function GranolaSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(granolaSettings);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading…</Text>;
  }
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="Granola">
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

  async function saveKey(apiKey: string) {
    if (settings.status !== "ready") return;
    const ok = await settings.save({ ...settings.values, apiKey: apiKey.trim() }, settings.revision);
    if (ok) {
      setDraft(null);
      setSaved(true);
    }
  }

  return (
    <>
      <SettingsSection title="Granola">
        <SettingsCard>
          <SettingsInput
            key={settings.revision}
            label="API key"
            hint={hasKey ? "A key is saved. Paste a new one to replace it." : "Required to list meetings."}
            error={settings.saveError ? String(settings.saveError) : null}
            initialValue={current}
            placeholder="grn_…"
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
            onPress={() => void saveKey(value)}
          />
          {hasKey ? (
            <SettingsAction
              label="Remove saved key"
              actionLabel="Remove"
              disabled={settings.saving}
              onPress={() => void saveKey("")}
            />
          ) : null}
          <SettingsRow label="Create a key" hint="Granola → Settings → API (Business and Enterprise plans)">
            <ExternalLink href="https://docs.granola.ai/introduction">
              <Text style={{ color: theme.colors.accent }}>Granola API docs</Text>
            </ExternalLink>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Attachments">
        <SettingsCard>
          <SettingsSwitch
            label="Include summary"
            hint="Add Granola's meeting summary above the transcript."
            value={settings.values.includeSummary}
            disabled={settings.saving}
            onValueChange={(includeSummary) =>
              void settings.save({ ...settings.values, includeSummary }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
