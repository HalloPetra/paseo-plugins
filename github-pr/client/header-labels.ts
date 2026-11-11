import type { PluginButtonRegistration } from "@getpaseo/plugin/client";

const registrations = new Map<string, { registration: PluginButtonRegistration; label: string | undefined }>();

export function trackHeaderButton(workspaceId: string, registration: PluginButtonRegistration) {
  registrations.set(workspaceId, { registration, label: undefined });
}

export function untrackHeaderButton(workspaceId: string) {
  registrations.delete(workspaceId);
}

/** Updates the header button label only when it changes. */
export function setHeaderLabel(workspaceId: string, label: string | undefined) {
  const entry = registrations.get(workspaceId);
  if (!entry || entry.label === label) return;
  entry.label = label;
  entry.registration.update({ label });
}
