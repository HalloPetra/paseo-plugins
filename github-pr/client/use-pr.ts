import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { getPrRpc } from "../shared/pr";

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
  return { directory, query };
}
