import { useAgents, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getPrRpc } from "../shared/pr";

/** GitHub needs a moment after a push before the PR's head and checks update. */
const FOLLOW_UP_DELAY_MS = 15_000;

/** Shared by the panel and the header button so both read one cached query per workspace. */
export function usePr(workspaceId: string) {
  const directory = useWorkspace(workspaceId, (w) => w.directory);
  const getPr = useRpc(getPrRpc);
  const query = useQuery({
    queryKey: ["github-pr", directory],
    queryFn: () => getPr({ directory: directory! }),
    enabled: Boolean(directory),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  useRefetchOnTurnEnd(workspaceId, query.refetch);
  return { directory, query };
}

/** Refetches when any agent in the workspace finishes a turn, and once more shortly after. */
function useRefetchOnTurnEnd(workspaceId: string, refetch: (options?: { cancelRefetch?: boolean }) => unknown) {
  const running = useAgents({ where: (a) => a.workspaceId === workspaceId && a.status === "running" });
  const runningKey = running.map((a) => a.id).sort().join(",");
  const previous = useRef<Set<string> | null>(null);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const now = new Set(runningKey ? runningKey.split(",") : []);
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const finished = [...before].some((id) => !now.has(id));
    if (!finished) return;
    // cancelRefetch: false dedupes with the panel and header button refetching at once.
    refetchRef.current({ cancelRefetch: false });
    timers.current.push(setTimeout(() => refetchRef.current({ cancelRefetch: false }), FOLLOW_UP_DELAY_MS));
  }, [runningKey]);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );
}
