import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Tracker } from "./server/tracker";
import { keepAwakeSettings, releaseNow, statusSubscription, type KeepAwakeSettings } from "./shared/keep-awake";

export default function contribute(server: PluginServerContext) {
  const tracker = new Tracker();
  const settings = server.registerSettings(keepAwakeSettings);
  const defaults: KeepAwakeSettings = keepAwakeSettings.schema.parse({});

  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status === "ready") tracker.setSettings(state.values);
    else {
      console.error("Stored settings are invalid; using defaults", state.error);
      tracker.setSettings(defaults);
    }
  };
  void settings.read().then(apply, (error) => {
    console.error("Could not read settings; using defaults", error);
    tracker.setSettings(defaults);
  });
  const unsubscribeSettings = settings.subscribe(apply);

  const removeHooks = [
    server.addHook("agent.turn.before", async ({ agent }, { paseo }) => {
      tracker.attach(paseo);
      tracker.turnStarted(agent);
    }),
    server.addHook("agent.turn.after", async (_event, { paseo }) => tracker.attach(paseo)),
    server.addHook("agent.close.after", async ({ agent }) => tracker.agentGone(agent.id)),
    server.addHook("agent.archive.after", async ({ agent }) => tracker.agentGone(agent.id)),
  ];

  // Synchronous on purpose: a handler that returns a promise closes the subscription when it settles.
  server.handle(statusSubscription, (_input, { paseo, push, signal }) => {
    tracker.attach(paseo);
    const send = () => void push(tracker.status()).catch(() => {});
    send();
    const unsubscribe = tracker.subscribe(send);
    signal.addEventListener("abort", unsubscribe, { once: true });
  });

  server.handle(releaseNow, () => {
    tracker.releaseNow();
    return {};
  });

  return () => {
    for (const remove of removeHooks) remove();
    unsubscribeSettings();
    tracker.stop();
  };
}
