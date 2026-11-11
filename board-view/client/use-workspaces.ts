import { usePaseo } from "@getpaseo/plugin/client";
import type { PaseoWorkspace } from "@getpaseo/client";
import { useEffect, useState } from "react";

export type WorkspacesState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; workspaces: ReadonlyMap<string, PaseoWorkspace> };

/** Open (non-archived, non-background) workspaces on the selected host, kept live. */
export function useOpenWorkspaces(): WorkspacesState {
  const paseo = usePaseo();
  const [state, setState] = useState<WorkspacesState>({ kind: "loading" });

  useEffect(() => {
    let disposed = false;
    let release: (() => Promise<void>) | null = null;
    let unsubscribe: (() => void) | null = null;
    let map = new Map<string, PaseoWorkspace>();

    const publish = () => {
      if (!disposed) setState({ kind: "ready", workspaces: new Map(map) });
    };

    // A subscribed snapshot can be paged; pull any remaining pages once.
    const fetchRemainingPages = async (cursor: string | null) => {
      while (cursor && !disposed) {
        const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
        for (const workspace of page.entries) {
          if (!map.has(workspace.id)) map.set(workspace.id, workspace);
        }
        cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
      }
      publish();
    };

    paseo.workspaces
      .list({ subscribe: {}, page: { limit: 200 } })
      .then((result) => {
        if (disposed) {
          void result.subscription.release();
          return;
        }
        release = () => result.subscription.release();
        unsubscribe = result.subscription.subscribe({
          snapshot: (snapshot) => {
            map = new Map(snapshot.entries.map((workspace) => [workspace.id, workspace]));
            publish();
            const { pageInfo } = snapshot;
            if (pageInfo.hasMore && pageInfo.nextCursor) {
              void fetchRemainingPages(pageInfo.nextCursor).catch(() => {});
            }
          },
          update: (message) => {
            if (message.type !== "workspace_update") return;
            const update = message.payload;
            if (update.kind === "upsert") {
              map.set(update.workspace.id, update.workspace);
            } else {
              map.delete(update.id);
            }
            publish();
          },
          error: (error) => {
            if (!disposed) setState({ kind: "error", message: String(error) });
          },
        });
        return undefined;
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => {
      disposed = true;
      unsubscribe?.();
      void release?.().catch(() => {});
    };
  }, [paseo]);

  return state;
}
