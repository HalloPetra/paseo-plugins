import { useSubscription, type PluginSubscriptionState } from "@getpaseo/plugin/client";
import { useState } from "react";
import { HISTORY_LENGTH, statsSubscription, type HostInfo, type Sample } from "../shared/stats";

const NO_INPUT = {};

export interface Stats {
  host: HostInfo | null;
  samples: Sample[];
  latest: Sample | null;
  state: PluginSubscriptionState;
}

/** Live host usage with the last two minutes of history. */
export function useStats(): Stats {
  const [host, setHost] = useState<HostInfo | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const state = useSubscription(statsSubscription, NO_INPUT, (event) => {
    setHost(event.host);
    setSamples((previous) => {
      const known = previous.at(-1)?.at ?? 0;
      const fresh = event.samples.filter((sample) => sample.at > known);
      if (fresh.length === 0) return previous;
      return [...previous, ...fresh].slice(-HISTORY_LENGTH);
    });
  });
  return { host, samples, latest: samples.at(-1) ?? null, state };
}
