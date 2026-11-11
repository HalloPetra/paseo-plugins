import { defineRpc, defineSettings, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** Seconds the host stays awake after the last agent stops, so a quick follow-up turn finds it awake. */
export const GRACE_OPTIONS = [0, 60, 300, 900] as const;

export const keepAwakeSettings = defineSettings({
  id: "keep-awake",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Master switch, toggled from the sidebar. */
    enabled: z.boolean().default(true),
    /** Count Paseo agents started by other agents, and helper agents hidden from the tab list. */
    includeChildAgents: z.boolean().default(true),
    /** Count provider subagents and background shells still running after their parent's turn ended. */
    includeBackgroundWork: z.boolean().default(true),
    /** Also keep the display on, not only the system. */
    keepDisplayAwake: z.boolean().default(false),
    /** macOS: also block system sleep on AC power, not just idle sleep. Linux: also block lid-close suspend. */
    blockSystemSleep: z.boolean().default(false),
    /** Seconds to stay awake after the last agent stops. */
    graceSeconds: z.number().int().min(0).max(3600).default(60),
  }),
});
export type KeepAwakeSettings = z.output<typeof keepAwakeSettings.schema>;

export const ActivitySchema = z.object({
  agentId: z.string(),
  /** The agent's own title; the app shows the workspace title when it knows the workspace. */
  title: z.string(),
  workspaceId: z.string().nullable(),
  /** `agent`: a running turn. `child`: a running agent another agent started. `background`: work left running after the turn. */
  kind: z.enum(["agent", "child", "background"]),
  /** Background items still running, for `background`. */
  count: z.number().int().nonnegative(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const StatusSchema = z.object({
  platform: z.string(),
  /** False when this platform has no supported sleep blocker. */
  supported: z.boolean(),
  enabled: z.boolean(),
  /** A sleep blocker is held right now. */
  holding: z.boolean(),
  /** Milliseconds until the grace period releases the blocker, or null. Relative, so clock skew to a remote host does not matter. */
  releaseInMs: z.number().nullable(),
  /** Last blocker failure, such as a missing `caffeinate` or `systemd-inhibit`. */
  error: z.string().nullable(),
  activity: z.array(ActivitySchema),
});
export type Status = z.infer<typeof StatusSchema>;

/** Streams the current status, then every change. */
export const statusSubscription = defineSubscription({
  name: "keep-awake.status",
  input: z.object({}),
  event: StatusSchema,
});

/** Releases the blocker now, skipping the rest of the grace period. */
export const releaseNow = defineRpc({
  name: "keep-awake.release-now",
  input: z.object({}),
  output: z.object({}),
});
