import { Icon } from "@getpaseo/plugin/client/ui";

// Linear-style workflow state icons. Paseo paints currentColor with the color we pass.
const ICONS: Record<string, string> = {
  triage: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  backlog: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.4 1.6"/></svg>`,
  unstarted: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  started: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor"/></svg>`,
  completed: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.25" fill="currentColor"/><path d="m4.3 7.2 1.9 1.9 3.6-3.8" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  canceled: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.25" fill="currentColor"/><path d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

// Linear's "Duplicate" state type draws like canceled.
ICONS.duplicate = ICONS.canceled;

export function StatusIcon({ type, color, size = 14 }: { type: string; color: string; size?: number }) {
  return <Icon icon={{ svg: ICONS[type] ?? ICONS.unstarted }} size={size} color={color} />;
}

const PRIORITY_ICONS: Record<number, string> = {
  // No priority: three dashes, as in Linear.
  0: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="currentColor"><rect x="1.5" y="6.25" width="2.5" height="1.5" rx=".5"/><rect x="5.75" y="6.25" width="2.5" height="1.5" rx=".5"/><rect x="10" y="6.25" width="2.5" height="1.5" rx=".5"/></svg>`,
  1: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor"/><path d="M7 3.8v4M7 10.2v.01" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  2: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="currentColor"><rect x="1.5" y="8" width="2.5" height="4.5" rx=".6"/><rect x="5.75" y="5" width="2.5" height="7.5" rx=".6"/><rect x="10" y="2" width="2.5" height="10.5" rx=".6"/></svg>`,
  3: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="currentColor"><rect x="1.5" y="8" width="2.5" height="4.5" rx=".6"/><rect x="5.75" y="5" width="2.5" height="7.5" rx=".6"/><rect x="10" y="2" width="2.5" height="10.5" rx=".6" opacity=".3"/></svg>`,
  4: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="currentColor"><rect x="1.5" y="8" width="2.5" height="4.5" rx=".6"/><rect x="5.75" y="5" width="2.5" height="7.5" rx=".6" opacity=".3"/><rect x="10" y="2" width="2.5" height="10.5" rx=".6" opacity=".3"/></svg>`,
};

export function PriorityIcon({ priority, color, size = 14 }: { priority: number; color: string; size?: number }) {
  const svg = PRIORITY_ICONS[priority];
  return svg ? <Icon icon={{ svg }} size={size} color={color} /> : null;
}
