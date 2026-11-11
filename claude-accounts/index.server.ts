import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cancelAllLogins, cancelLogin, loginState, startLogin, submitCode } from "./server/login";
import { contributeRotation, reloadIdleAgents } from "./server/rotation";
import {
  describeAccount,
  preferencesOf,
  readState,
  removeAccount,
  renameAccount,
  updateState,
} from "./server/store";
import {
  activateAccountRpc,
  cancelLoginRpc,
  clearLimitRpc,
  getLoginRpc,
  listAccountsRpc,
  removeAccountRpc,
  renameAccountRpc,
  startLoginRpc,
  submitLoginCodeRpc,
  updatePreferencesRpc,
} from "./shared/accounts";

export default function contribute(server: PluginServerContext) {
  server.handle(listAccountsRpc, async () => {
    const state = await readState();
    return {
      accounts: state.accounts.map((account) => describeAccount(state, account)),
      preferences: preferencesOf(state),
    };
  });

  server.handle(renameAccountRpc, async ({ id, label }) => {
    await renameAccount(id, label);
    return {};
  });

  server.handle(startLoginRpc, ({ accountId }) => startLogin(accountId));
  server.handle(getLoginRpc, ({ loginId }) => loginState(loginId));
  server.handle(submitLoginCodeRpc, ({ loginId, code }) => submitCode(loginId, code));
  server.handle(cancelLoginRpc, async ({ loginId }) => {
    await cancelLogin(loginId);
    return {};
  });

  server.handle(removeAccountRpc, async ({ id }) => {
    await removeAccount(id);
    return {};
  });

  server.handle(activateAccountRpc, async ({ id, reloadIdleAgents: reload }, { paseo }) => {
    await updateState((state) => {
      if (!state.accounts.some((account) => account.id === id)) {
        throw new Error(`Unknown account ${id}`);
      }
      return { ...state, activeId: id };
    });
    return { reloaded: reload ? await reloadIdleAgents(paseo) : 0 };
  });

  server.handle(clearLimitRpc, async ({ id }) => {
    await updateState((state) => {
      const { [id]: _cleared, ...limited } = state.limitedUntil;
      return { ...state, limitedUntil: limited };
    });
    return {};
  });

  server.handle(updatePreferencesRpc, async (patch) => {
    const state = await updateState((state) => ({
      ...state,
      ...(patch.autoSwitch !== undefined ? { autoSwitch: patch.autoSwitch } : {}),
      ...(patch.resumePrompt !== undefined && patch.resumePrompt.trim()
        ? { resumePrompt: patch.resumePrompt.trim() }
        : {}),
    }));
    return preferencesOf(state);
  });

  const removeRotation = contributeRotation(server);
  return () => {
    removeRotation();
    cancelAllLogins();
  };
}
