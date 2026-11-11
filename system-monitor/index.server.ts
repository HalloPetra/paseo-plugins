import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Sampler, hostInfo } from "./server/sampler";
import { statsSubscription } from "./shared/stats";

export default function contribute(server: PluginServerContext) {
  const sampler = new Sampler();

  // Synchronous on purpose: a handler that returns a promise closes the subscription when the
  // promise settles. This one stays open until `signal` aborts.
  server.handle(statsSubscription, (_input, { push, signal }) => {
    const send = (samples: typeof sampler.history) => {
      push({ host: hostInfo(), samples }).catch(() => {});
    };
    if (sampler.history.length > 0) send([...sampler.history]);
    const unsubscribe = sampler.subscribe((sample) => send([sample]));
    signal.addEventListener("abort", unsubscribe, { once: true });
  });

  return () => sampler.stop();
}
