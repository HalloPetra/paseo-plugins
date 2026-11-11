import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** The login Claude Code already uses on the daemon machine. Always present, never removed. */
export const DEFAULT_ACCOUNT_ID = "default";

export const accountSchema = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  /** The CLAUDE_CONFIG_DIR this account runs with. */
  configDir: z.string(),
  /** Email of the signed-in Claude account, read from the config dir. Null when not signed in. */
  email: z.string().nullable(),
  /** Plan name Claude reports, such as "Claude Max". */
  plan: z.string().nullable(),
  /** ISO time until which the account is considered out of usage. Null when available. */
  limitedUntil: z.string().nullable(),
  active: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;

export const preferencesSchema = z.object({
  autoSwitch: z.boolean(),
  resumePrompt: z.string(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const listAccountsRpc = defineRpc({
  name: "accounts.list",
  input: z.object({}),
  output: z.object({ accounts: z.array(accountSchema), preferences: preferencesSchema }),
});

export const renameAccountRpc = defineRpc({
  name: "accounts.rename",
  input: z.object({ id: z.string(), label: z.string().trim().min(1).max(80) }),
  output: z.object({}),
});

export const loginStateSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  /**
   * starting: launching Claude Code. waiting: the browser sign-in is open. verifying: Claude Code
   * is finishing the login. The rest are final.
   */
  status: z.enum(["starting", "waiting", "verifying", "signed-in", "failed", "canceled"]),
  /** Sign-in page. Its fallback shows a code to paste back when the browser cannot reach Claude Code. */
  url: z.string().nullable(),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  error: z.string().nullable(),
});
export type LoginState = z.infer<typeof loginStateSchema>;

export const startLoginRpc = defineRpc({
  name: "login.start",
  /** Omit `accountId` to sign in a new account. */
  input: z.object({ accountId: z.string().optional() }),
  output: loginStateSchema,
});

export const getLoginRpc = defineRpc({
  name: "login.get",
  input: z.object({ loginId: z.string() }),
  output: loginStateSchema,
});

export const submitLoginCodeRpc = defineRpc({
  name: "login.submit-code",
  input: z.object({ loginId: z.string(), code: z.string().trim().min(1) }),
  output: loginStateSchema,
});

export const cancelLoginRpc = defineRpc({
  name: "login.cancel",
  input: z.object({ loginId: z.string() }),
  output: z.object({}),
});

export const removeAccountRpc = defineRpc({
  name: "accounts.remove",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

export const activateAccountRpc = defineRpc({
  name: "accounts.activate",
  input: z.object({
    id: z.string(),
    /** Reopen running Claude agents so they pick the account up on their next prompt. */
    reloadIdleAgents: z.boolean().default(true),
  }),
  output: z.object({ reloaded: z.number() }),
});

export const clearLimitRpc = defineRpc({
  name: "accounts.clear-limit",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

export const updatePreferencesRpc = defineRpc({
  name: "accounts.update-preferences",
  input: preferencesSchema.partial(),
  output: preferencesSchema,
});

/** Timeline row appended when the plugin switches an agent to another account. */
export const SWITCH_ROW_KIND = "claude-account-switch";
export const switchRowSchema = z.object({
  status: z.enum(["switched", "exhausted", "disabled"]),
  from: z.string(),
  to: z.string().nullable(),
  /** ISO time the limited account becomes available again, when known. */
  resetsAt: z.string().nullable(),
  /** Earliest time any account becomes available, when every account is limited. */
  nextAvailableAt: z.string().nullable(),
});
export type SwitchRow = z.infer<typeof switchRowSchema>;
