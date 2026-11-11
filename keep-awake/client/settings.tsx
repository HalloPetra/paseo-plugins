import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { GRACE_OPTIONS } from "../shared/keep-awake";
import { useKeepAwakeSettings, useStatus } from "./use-status";

function graceLabel(seconds: number): string {
  if (seconds === 0) return "Immediately";
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function KeepAwakeSettingsScreen({ theme }: PluginSurfaceProps) {
  const { settings, update } = useKeepAwakeSettings();
  const { status } = useStatus();

  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading…</Text>;
  }
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="Keep awake">
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
  const disabled = settings.saving;
  const platform = status?.platform;
  const graceOptions = GRACE_OPTIONS.includes(values.graceSeconds as (typeof GRACE_OPTIONS)[number])
    ? GRACE_OPTIONS
    : [...GRACE_OPTIONS, values.graceSeconds].sort((a, b) => a - b);

  return (
    <>
      <SettingsSection title="Keep awake">
        <SettingsCard>
          <SettingsSwitch
            label="Keep the host awake while agents run"
            hint={
              status && !status.supported
                ? `Not supported on ${status.platform}.`
                : "Blocks idle sleep on the daemon machine while any agent has a turn running."
            }
            error={status?.error ?? (settings.saveError ? String(settings.saveError) : null)}
            value={values.enabled}
            disabled={disabled}
            onValueChange={(enabled) => update({ enabled })}
          />
          <SettingsSelect
            label="Allow sleep after the last agent stops"
            hint="Waiting a little keeps the host up between turns and follow-ups."
            value={String(values.graceSeconds)}
            options={graceOptions.map((seconds) => ({ label: graceLabel(seconds), value: String(seconds) }))}
            disabled={disabled}
            onValueChange={(value) => update({ graceSeconds: Number(value) })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="What counts">
        <SettingsCard>
          <SettingsSwitch
            label="Subagents and helper agents"
            hint="Paseo agents started by another agent, including background helpers hidden from tabs."
            value={values.includeChildAgents}
            disabled={disabled}
            onValueChange={(includeChildAgents) => update({ includeChildAgents })}
          />
          <SettingsSwitch
            label="Background work"
            hint="Provider subagents and background shells that keep running after the agent's turn has ended."
            value={values.includeBackgroundWork}
            disabled={disabled}
            onValueChange={(includeBackgroundWork) => update({ includeBackgroundWork })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="How awake">
        <SettingsCard>
          <SettingsSwitch
            label="Keep the display on"
            hint={
              platform === "linux"
                ? "On Linux the idle inhibitor already keeps the display on."
                : "Off lets the screen turn off and lock while the system keeps running."
            }
            value={values.keepDisplayAwake}
            disabled={disabled || platform === "linux"}
            onValueChange={(keepDisplayAwake) => update({ keepDisplayAwake })}
          />
          <SettingsSwitch
            label={platform === "linux" ? "Ignore closing the lid" : "Block system sleep on AC power"}
            hint={
              platform === "linux"
                ? "Also stops the lid switch from suspending the machine."
                : platform === "win32"
                  ? "Windows already blocks system sleep while the host is awake."
                  : "Also blocks sleep the system would otherwise start on its own, such as on lid close with an external display. Only applies on AC power."
            }
            value={values.blockSystemSleep}
            disabled={disabled || platform === "win32"}
            onValueChange={(blockSystemSleep) => update({ blockSystemSleep })}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
