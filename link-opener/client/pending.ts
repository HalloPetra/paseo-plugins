// Hands a URL from the link popover to the Links panel, which is the only place a plugin
// can reach `navigation.openBrowser`. Also keeps a per-workspace history for the panel.

export interface OpenedLink {
  url: string;
  at: number;
}

const pending = new Map<string, string>();
const history = new Map<string, OpenedLink[]>();
const listeners = new Set<() => void>();
const HISTORY_LIMIT = 50;

function notify() {
  for (const listener of listeners) listener();
}

export function queueBrowserOpen(workspaceId: string, url: string) {
  pending.set(workspaceId, url);
  notify();
}

/** Returns the URL waiting for this workspace and forgets it, so it opens once. */
export function takePendingOpen(workspaceId: string): string | null {
  const url = pending.get(workspaceId) ?? null;
  pending.delete(workspaceId);
  return url;
}

export function hasPendingOpen(workspaceId: string): boolean {
  return pending.has(workspaceId);
}

export function recordOpened(workspaceId: string, url: string) {
  const previous = (history.get(workspaceId) ?? []).filter((entry) => entry.url !== url);
  history.set(workspaceId, [{ url, at: Date.now() }, ...previous].slice(0, HISTORY_LIMIT));
  notify();
}

export function getHistory(workspaceId: string): readonly OpenedLink[] {
  return history.get(workspaceId) ?? EMPTY;
}

const EMPTY: readonly OpenedLink[] = [];

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearAll() {
  rememberedOpenBrowser = null;
  pending.clear();
  history.clear();
  notify();
}

export type OpenBrowser = (input: { url: string; workspaceId: string }) => void;

let rememberedOpenBrowser: OpenBrowser | null = null;

/**
 * The host's `openBrowser` reaches Paseo's global stores rather than the panel that received
 * it, so it keeps working after that panel unmounts. Once any Links panel has mounted, the
 * popover calls it directly and no panel needs to open.
 */
export function rememberOpenBrowser(openBrowser: OpenBrowser | undefined) {
  if (openBrowser) rememberedOpenBrowser = openBrowser;
}

export function getRememberedOpenBrowser(): OpenBrowser | null {
  return rememberedOpenBrowser;
}

export function forgetOpenBrowser() {
  rememberedOpenBrowser = null;
}
