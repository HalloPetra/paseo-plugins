import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createWatcher } from "./server/watcher";
import { rulesSettings, watcherStatusRpc } from "./shared/rules";

export default function contribute(server: PluginServerContext) {
  const watcher = createWatcher(server.registerSettings(rulesSettings));

  server.handle(watcherStatusRpc, async (_input, { paseo }) => {
    await watcher.ensure(paseo);
    return watcher.status();
  });

  // Any lifecycle event also starts the watcher, so it runs after a daemon restart with no app open.
  const removers = [
    server.addHook("agent.turn.before", async (_event, { paseo }) => void watcher.ensure(paseo)),
    server.addHook("agent.turn.after", async (_event, { paseo }) => void watcher.ensure(paseo)),
    server.addHook("agent.create.after", async (_event, { paseo }) => void watcher.ensure(paseo)),
    server.addHook("workspace.create.after", async (_event, { paseo }) => void watcher.ensure(paseo)),
  ];

  return async () => {
    for (const remove of removers) remove();
    await watcher.stop();
  };
}
