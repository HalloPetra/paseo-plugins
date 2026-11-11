import { useSettings, useSubscription } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { keepAwakeSettings, statusSubscription, type KeepAwakeSettings, type Status } from "../shared/keep-awake";

const NO_INPUT = {};

export interface LiveStatus {
  status: Status | null;
  /** Local epoch ms when the grace period ends, or null. */
  releaseAt: number | null;
}

export function useStatus(): LiveStatus {
  const [live, setLive] = useState<LiveStatus>({ status: null, releaseAt: null });
  useSubscription(statusSubscription, NO_INPUT, (status) => {
    setLive({ status, releaseAt: status.releaseInMs === null ? null : Date.now() + status.releaseInMs });
  });
  return live;
}

/** Seconds left until `deadline`, ticking once a second; null without a deadline. */
export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Settings with a save that merges a partial change into the loaded document. */
export function useKeepAwakeSettings() {
  const settings = useSettings(keepAwakeSettings);
  const update = (patch: Partial<KeepAwakeSettings>) => {
    if (settings.status !== "ready") return;
    void settings.save({ ...settings.values, ...patch }, settings.revision);
  };
  return { settings, update };
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function summary(status: Status | null, countdown: number | null): string {
  if (!status) return "Keep awake";
  if (!status.supported) return "Keep awake unavailable";
  if (!status.enabled) return "Keep awake off";
  if (status.error) return "Keep awake failed";
  const count = status.activity.length;
  if (count > 0) return `Awake · ${count} ${count === 1 ? "agent" : "agents"}`;
  if (status.holding && countdown !== null) return `Awake · sleep in ${formatCountdown(countdown)}`;
  return "Sleep allowed";
}

export function iconFor(status: Status | null): string {
  if (!status || !status.supported || !status.enabled) return "Moon";
  if (status.error) return "TriangleAlert";
  if (status.activity.length > 0) return "Coffee";
  if (status.holding) return "Timer";
  return "Moon";
}
