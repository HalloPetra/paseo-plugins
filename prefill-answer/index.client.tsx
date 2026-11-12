import type { PluginClientContext } from "@getpaseo/plugin/client";
import { prefillWatch } from "./shared/prefill";

export default function contribute(client: PluginClientContext) {
  const applied = new Set<string>();
  const stop = client.subscribe(prefillWatch, {}, ({ agentId, key, text }) => {
    if (applied.has(key)) return;
    applied.add(key);
    for (const composer of client.composers({ agentId })) {
      // Never overwrite something the user already started typing.
      if (composer.prompt.trim() !== "") continue;
      composer.setPrompt(text);
    }
  });
  return () => stop();
}
