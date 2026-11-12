import type { PluginServerContext } from "@getpaseo/plugin/server";
import { forget, listen, onTurnEnded, onTurnStarted, prefillTool } from "./server/prefill";
import { prefillWatch } from "./shared/prefill";

export default function contribute(server: PluginServerContext) {
  server.addHook("agent.open.before", async ({ request }) => {
    // `background` is newer than the SDK types this builds against.
    const background = (request as { background?: boolean }).background === true;
    if (background || request.purpose === "history") return;
    return { ...request, tools: [...request.tools, prefillTool] };
  });

  server.addHook("agent.turn.before", async ({ agent }) => {
    onTurnStarted(agent.id);
  });

  // Only a completed turn releases the proposal; a failed or canceled one drops it.
  server.addHook("agent.turn.after", async ({ agent, outcome }) => {
    onTurnEnded(agent.id, outcome.kind === "completed");
  });

  server.addHook("agent.archive.after", async ({ agent }) => {
    forget(agent.id);
  });

  server.handle(prefillWatch, (_input, { push, signal }) => {
    const stop = listen((event) => void push(event));
    signal.addEventListener("abort", stop, { once: true });
  });

  return () => {};
}
