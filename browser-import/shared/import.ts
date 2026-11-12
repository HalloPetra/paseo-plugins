import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const sourceSchema = z.object({
  /** `<browser id>:<profile directory>` */
  id: z.string(),
  browser: z.string(),
  profile: z.string(),
  cookieCount: z.number(),
});
export type Source = z.infer<typeof sourceSchema>;

export const listSourcesRpc = defineRpc({
  name: "browser-import.sources",
  input: z.object({}),
  output: z.object({
    /** Why importing is impossible on this daemon, or null. */
    unsupported: z.string().nullable(),
    target: z.object({ path: z.string(), cookieCount: z.number() }).nullable(),
    sources: z.array(sourceSchema),
  }),
});

export const siteSchema = z.object({ site: z.string(), count: z.number() });
export type Site = z.infer<typeof siteSchema>;

export const listSitesRpc = defineRpc({
  name: "browser-import.sites",
  input: z.object({ sourceId: z.string() }),
  output: z.object({ sites: z.array(siteSchema) }),
});

export const importCookiesRpc = defineRpc({
  name: "browser-import.import",
  input: z.object({
    sourceId: z.string(),
    /** Sites to import; null imports every site. */
    sites: z.array(z.string()).nullable(),
    /** Replace cookies Paseo already has with the same name, host, and path. */
    overwrite: z.boolean(),
  }),
  output: z.object({
    imported: z.number(),
    /** Already present in Paseo and left alone because overwrite was off. */
    kept: z.number(),
    /** Could not be decrypted. */
    failed: z.number(),
  }),
});

export const restartPaseoRpc = defineRpc({
  name: "browser-import.restart",
  input: z.object({}),
  output: z.object({}),
});
