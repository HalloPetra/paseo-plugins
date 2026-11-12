import type { PluginServerContext } from "@getpaseo/plugin/server";
import { rememberPaseo, sweep } from "./server/relay";
import { flushStore } from "./server/store";
import { handleTurnEnded, orchestratorTools } from "./server/tools";

/** Retries queued deliveries and catches turn ends missed while the plugin was reloading. */
const SWEEP_MS = 15_000;

export default function contribute(server: PluginServerContext) {
  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    rememberPaseo(paseo);
    // Background helpers report to the agent that created them; keep them out of the network.
    // `background` is newer than the SDK types this builds against.
    const background = (request as { background?: boolean }).background === true;
    if (background || request.purpose === "history") return;
    return { ...request, tools: [...request.tools, ...orchestratorTools] };
  });

  server.addHook("agent.turn.after", async ({ agent, outcome }, { paseo }) => {
    await handleTurnEnded(paseo, agent.id, outcome);
  });

  let sweeping = false;
  const timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    sweep()
      .catch((error) => console.error("[orchestrator] Sweep failed", error))
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_MS);

  return async () => {
    clearInterval(timer);
    await flushStore();
  };
}
