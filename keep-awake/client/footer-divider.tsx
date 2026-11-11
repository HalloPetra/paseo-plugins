import { SidebarSeparator } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";

/*
 * Dividers between sidebar footer items from several plugins.
 *
 * Paseo already draws a line above the footer rows and another below them, and it does not tell an
 * item where it sits. So each participating item measures its own window position and publishes it
 * in a registry shared on `globalThis`, which every plugin bundle in the app can reach. An item
 * draws Paseo's separator above itself unless it is the topmost participant, so lines only ever fall
 * between items, in whatever order Settings > Sidebar puts them.
 *
 * Keep this file identical in every plugin that uses it; the key is versioned for that reason. If
 * bundles do not share `globalThis`, each item only sees itself and draws no divider.
 */

const REGISTRY_KEY = "__paseoPluginFooterDividers.v1";
/** Catches reordering in Settings > Sidebar, which moves items without resizing them. */
const REMEASURE_MS = 2000;

interface Registry {
  positions: Map<string, number>;
  listeners: Set<() => void>;
}

function registry(): Registry {
  const scope = globalThis as unknown as Record<string, Registry | undefined>;
  let found = scope[REGISTRY_KEY];
  if (!found) {
    found = { positions: new Map(), listeners: new Set() };
    scope[REGISTRY_KEY] = found;
  }
  return found;
}

function notify(shared: Registry): void {
  for (const listener of shared.listeners) listener();
}

/** Wraps one footer item. `id` must be unique across plugins, such as the plugin ID. */
export function FooterDivided({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<View>(null);
  const [divided, setDivided] = useState(false);
  const measure = useRef<() => void>(() => {});

  useEffect(() => {
    const shared = registry();
    const recompute = () => {
      const mine = shared.positions.get(id);
      if (mine === undefined) return;
      let above = false;
      for (const [other, y] of shared.positions) if (other !== id && y < mine) above = true;
      setDivided(above);
    };
    measure.current = () => {
      ref.current?.measureInWindow((_x, y) => {
        // A collapsed or hidden sidebar reports zero; keep the last real position.
        if (!Number.isFinite(y) || y === 0 || shared.positions.get(id) === y) return;
        shared.positions.set(id, y);
        notify(shared);
      });
    };
    shared.listeners.add(recompute);
    measure.current();
    const timer = setInterval(() => measure.current(), REMEASURE_MS);
    return () => {
      clearInterval(timer);
      shared.listeners.delete(recompute);
      shared.positions.delete(id);
      notify(shared);
    };
  }, [id]);

  return (
    <View ref={ref} collapsable={false} onLayout={() => measure.current()}>
      {divided ? <SidebarSeparator /> : null}
      {children}
    </View>
  );
}
