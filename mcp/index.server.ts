import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { cancelAllLogins, cancelLogin, loginState, startLogin } from "./server/login";
import { getStatus, importServers, removeServer, saveServer, toggleServer } from "./server/servers";
import { readDenyRules, updateDenyRules } from "./server/settings";
import { readCachedStatus, withDenyRules } from "./server/status-cache";
import { listProjects, listTargets, targetById } from "./server/targets";
import {
  cachedStatusRpc,
  cancelLoginRpc,
  getLoginRpc,
  importServersRpc,
  listTargetsRpc,
  removeServerRpc,
  saveServerRpc,
  setToolsDeniedRpc,
  startLoginRpc,
  statusRpc,
  toggleServerRpc,
} from "./shared/mcp";

export default function contribute(server: PluginServerContext) {
  server.handle(listTargetsRpc, ({ targetId }) => {
    const targets = listTargets();
    const target =
      targets.find((candidate) => candidate.id === targetId) ??
      targets.find((candidate) => candidate.active) ??
      targets[0];
    return { targets, projects: listProjects(target), home: homedir() };
  });

  server.handle(statusRpc, ({ targetId, cwd }) => getStatus(targetId, cwd));
  server.handle(cachedStatusRpc, async ({ targetId, cwd }) => {
    const cached = readCachedStatus(targetId, cwd);
    if (!cached) return { status: null };
    return { status: withDenyRules(cached, await readDenyRules(targetById(targetId))) };
  });
  server.handle(toggleServerRpc, ({ targetId, cwd, name, enabled }) =>
    toggleServer(targetId, cwd, name, enabled),
  );

  server.handle(saveServerRpc, async (input) => {
    await saveServer(input);
    return {};
  });
  server.handle(removeServerRpc, async ({ targetId, cwd, name, scope }) => {
    await removeServer(targetId, cwd, name, scope);
    return {};
  });
  server.handle(importServersRpc, ({ targetId, fromTargetId, names }) =>
    importServers(targetId, fromTargetId, names),
  );

  server.handle(setToolsDeniedRpc, async ({ targetId, fullNames, denied, serverRule }) => {
    const target = targetById(targetId);
    if (denied) await updateDenyRules(target, { add: fullNames });
    else {
      const remove = [...fullNames];
      if (serverRule) remove.push(serverRule, `${serverRule}__*`);
      await updateDenyRules(target, { remove });
    }
    return {};
  });

  server.handle(startLoginRpc, ({ targetId, cwd, name, logoutFirst }) =>
    startLogin(targetById(targetId), cwd, name, logoutFirst),
  );
  server.handle(getLoginRpc, ({ id }) => loginState(id));
  server.handle(cancelLoginRpc, ({ id }) => {
    cancelLogin(id);
    return {};
  });

  return () => cancelAllLogins();
}
