import { defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** Seconds between samples. */
export const SAMPLE_INTERVAL_MS = 2000;
/** Samples kept for the history charts: two minutes. */
export const HISTORY_LENGTH = 60;

export const SampleSchema = z.object({
  /** Epoch milliseconds. */
  at: z.number(),
  /** 0–100, averaged across cores. */
  cpu: z.number(),
  cores: z.number(),
  /** 1, 5, and 15 minute load averages. Zeros on Windows. */
  load: z.tuple([z.number(), z.number(), z.number()]),
  memory: z.object({ used: z.number(), total: z.number() }),
  swap: z.object({ used: z.number(), total: z.number() }).nullable(),
  /** Bytes per second across non-loopback interfaces. Null when unavailable. */
  network: z.object({ rx: z.number(), tx: z.number() }).nullable(),
  disk: z.object({ used: z.number(), total: z.number(), path: z.string() }).nullable(),
});
export type Sample = z.infer<typeof SampleSchema>;

export const HostInfoSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  cpuModel: z.string(),
  uptime: z.number(),
});
export type HostInfo = z.infer<typeof HostInfoSchema>;

/**
 * Streams host usage. The first event carries the recent history; each later event one new
 * sample.
 */
export const statsSubscription = defineSubscription({
  name: "system-monitor.stats",
  input: z.object({}),
  event: z.object({ host: HostInfoSchema, samples: z.array(SampleSchema) }),
});
