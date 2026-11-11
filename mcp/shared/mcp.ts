import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** A Claude Code config dir: the default login, or one added by the Claude accounts plugin. */
export const targetSchema = z.object({
  id: z.string(),
  label: z.string(),
  configDir: z.string(),
  isDefault: z.boolean(),
  /** The login agents currently run on. */
  active: z.boolean(),
});
export type Target = z.infer<typeof targetSchema>;

export const projectSchema = z.object({
  path: z.string(),
  label: z.string(),
  /** Has local-scope servers or servers disabled for it. */
  hasMcp: z.boolean(),
});
export type Project = z.infer<typeof projectSchema>;

export const toolSchema = z.object({
  name: z.string(),
  /** The permission name: mcp__<server>__<tool>. */
  fullName: z.string(),
  readOnly: z.boolean(),
  destructive: z.boolean(),
  denied: z.boolean(),
});
export type Tool = z.infer<typeof toolSchema>;

export const serverStatusSchema = z.enum([
  "connected",
  "pending",
  "needs-auth",
  "failed",
  "disabled",
  /** Configured, but Claude Code skips it because a claude.ai connector serves the same URL. */
  "hidden",
  "unknown",
]);
export type ServerStatus = z.infer<typeof serverStatusSchema>;

/** shared: every profile, through the shared plugin. user: this login. local: this login and project. */
export const editableScopeSchema = z.enum(["shared", "user", "local"]);
export type EditableScope = z.infer<typeof editableScopeSchema>;

/** Scopes `claude mcp remove` can delete from. Project scope edits the repo's .mcp.json. */
export const removableScopeSchema = z.enum(["shared", "user", "local", "project"]);
export type RemovableScope = z.infer<typeof removableScopeSchema>;

export function isRemovableScope(scope: string): scope is RemovableScope {
  return scope === "shared" || scope === "user" || scope === "local" || scope === "project";
}

export function isEditableScope(scope: string): scope is EditableScope {
  return scope === "shared" || scope === "user" || scope === "local";
}

export const serverSchema = z.object({
  /** Claude Code's name for the server: plugin:shared:<label> for shared servers. */
  name: z.string(),
  /** The name as configured. */
  label: z.string(),
  /** user, local, project, claudeai, plugin, dynamic, enterprise... */
  scope: z.string(),
  status: serverStatusSchema,
  error: z.string().nullable(),
  transport: z.string(),
  /** URL or command line. */
  summary: z.string(),
  serverInfo: z.string().nullable(),
  /** Every tool is denied with a single server-wide rule. */
  serverDenied: z.boolean(),
  tools: z.array(toolSchema),
  /** The stored config as JSON, for shared, user, and local servers. */
  config: z.string().nullable(),
  /** Authenticates through a headers helper command instead of OAuth. */
  headersHelper: z.string().nullable(),
  canLogin: z.boolean(),
});
export type Server = z.infer<typeof serverSchema>;

export const importCandidateSchema = z.object({
  fromTargetId: z.string(),
  fromLabel: z.string(),
  names: z.array(z.string()),
});
export type ImportCandidate = z.infer<typeof importCandidateSchema>;

export const listTargetsRpc = defineRpc({
  name: "mcp.targets",
  input: z.object({ targetId: z.string().optional() }),
  output: z.object({
    targets: z.array(targetSchema),
    projects: z.array(projectSchema),
    home: z.string(),
  }),
});

const scopeInput = z.object({ targetId: z.string(), cwd: z.string() });

export const statusSchema = z.object({
  servers: z.array(serverSchema),
  importable: z.array(importCandidateSchema),
  settingsPath: z.string(),
  probedAt: z.string(),
  /** Some servers were still connecting when the probe gave up. */
  partial: z.boolean(),
});
export type Status = z.infer<typeof statusSchema>;

export const statusRpc = defineRpc({
  name: "mcp.status",
  input: scopeInput,
  output: statusSchema,
});

/** The last probe for a login and project, instantly, without connecting to anything. */
export const cachedStatusRpc = defineRpc({
  name: "mcp.status.cached",
  input: scopeInput,
  output: z.object({ status: statusSchema.nullable() }),
});

export const saveServerRpc = defineRpc({
  name: "mcp.save",
  input: scopeInput.extend({
    name: z.string().min(1),
    scope: editableScopeSchema,
    /** JSON of the server config, as Claude Code stores it. */
    config: z.string(),
    /** When editing: the entry being replaced. */
    replaces: z.object({ name: z.string(), scope: editableScopeSchema }).optional(),
  }),
  output: z.object({}),
});

export const removeServerRpc = defineRpc({
  name: "mcp.remove",
  input: scopeInput.extend({ name: z.string(), scope: removableScopeSchema }),
  output: z.object({}),
});

export const toggleServerRpc = defineRpc({
  name: "mcp.toggle",
  input: scopeInput.extend({ name: z.string(), enabled: z.boolean() }),
  output: statusSchema,
});

export const setToolsDeniedRpc = defineRpc({
  name: "mcp.tools.deny",
  input: z.object({
    targetId: z.string(),
    /** Permission names (mcp__server__tool). */
    fullNames: z.array(z.string()),
    denied: z.boolean(),
    /** Also drop a server-wide rule (mcp__server) when allowing tools again. */
    serverRule: z.string().optional(),
  }),
  output: z.object({}),
});

export const importServersRpc = defineRpc({
  name: "mcp.import",
  input: z.object({
    targetId: z.string(),
    fromTargetId: z.string(),
    names: z.array(z.string()),
  }),
  output: z.object({ imported: z.array(z.string()) }),
});

export const loginStateSchema = z.object({
  id: z.string(),
  server: z.string(),
  status: z.enum(["running", "succeeded", "failed", "canceled"]),
  /** The authorization URL, when Claude Code printed one. */
  url: z.string().nullable(),
  output: z.string(),
});
export type LoginState = z.infer<typeof loginStateSchema>;

export const startLoginRpc = defineRpc({
  name: "mcp.login.start",
  input: scopeInput.extend({ name: z.string(), logoutFirst: z.boolean() }),
  output: loginStateSchema,
});

export const getLoginRpc = defineRpc({
  name: "mcp.login.get",
  input: z.object({ id: z.string() }),
  output: loginStateSchema,
});

export const cancelLoginRpc = defineRpc({
  name: "mcp.login.cancel",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

/** Claude Code's permission prefix for a server's tools. */
export function permissionPrefix(server: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
