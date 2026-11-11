import { openExternalUrl, type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import {
  copyText,
  Loading,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  type Account,
  activateAccountRpc,
  cancelLoginRpc,
  clearLimitRpc,
  getLoginRpc,
  listAccountsRpc,
  type LoginState,
  removeAccountRpc,
  renameAccountRpc,
  startLoginRpc,
  submitLoginCodeRpc,
  updatePreferencesRpc,
} from "../shared/accounts";
import { formatTime } from "./format";

const ACCOUNTS_KEY = ["claude-accounts", "list"];

type Theme = PluginSurfaceProps["theme"];

function useStyles(theme: Theme) {
  return useMemo(
    () => ({
      screen: { gap: 16 },
      text: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      button: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13 },
      dangerText: { color: theme.colors.statusDanger, fontSize: 13 },
      // A full-width row: label and hint on top, the field below them.
      stacked: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 6,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      label: { color: theme.colors.foreground, fontSize: 14 },
      textArea: {
        minHeight: 72,
        marginTop: 4,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontSize: 13,
        textAlignVertical: "top" as const,
      },
      stackedActions: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 6,
      },
      panel: {
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 12,
        gap: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      panelHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      codeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      codeInput: { flex: 1, minHeight: 0, marginTop: 0 },
    }),
    [theme],
  );
}

function Button({
  label,
  onPress,
  tone = "default",
  disabled,
  styles,
}: {
  label: string;
  onPress(): void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, tone === "primary" && styles.primary, disabled && { opacity: 0.5 }]}
    >
      <Text
        style={
          tone === "primary"
            ? styles.primaryText
            : tone === "danger"
              ? styles.dangerText
              : styles.buttonText
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

function accountHint(account: Account): string {
  const parts: string[] = [];
  if (account.active) parts.push("Active");
  if (account.email) parts.push(account.plan ? `${account.email} · ${account.plan}` : account.email);
  else parts.push(account.isDefault ? "Claude Code's own login" : "Not signed in");
  if (account.limitedUntil) parts.push(`limit resets ${formatTime(account.limitedUntil)}`);
  return parts.join(" · ");
}

const FINAL_STATUSES: readonly LoginState["status"][] = ["signed-in", "failed", "canceled"];

/** Live sign-in for one account: the browser opens on the daemon machine; a code works anywhere. */
function SignInPanel({
  login,
  onDone,
  theme,
  styles,
}: {
  login: LoginState;
  onDone(): void;
  theme: Theme;
  styles: ReturnType<typeof useStyles>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const getLogin = useRpc(getLoginRpc);
  const submit = useRpc(submitLoginCodeRpc);
  const cancel = useRpc(cancelLoginRpc);
  const startLogin = useRpc(startLoginRpc);
  const [current, setCurrent] = useState(login);
  const [code, setCode] = useState("");
  const final = FINAL_STATUSES.includes(current.status);

  const poll = useQuery({
    queryKey: ["claude-accounts", "login", current.id],
    queryFn: () => getLogin({ loginId: current.id }),
    initialData: current,
    refetchInterval: final ? false : 1000,
  });
  const state = poll.data ?? current;

  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (state !== current) setCurrent(state);
    if (!FINAL_STATUSES.includes(state.status) || handled.current === state.id) return;
    handled.current = state.id;
    void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    if (state.status === "signed-in") {
      toast.show(`Signed in as ${state.email}${state.plan ? ` (${state.plan})` : ""}.`, {
        variant: "success",
      });
      onDone();
    } else if (state.status === "canceled") {
      onDone();
    }
  }, [state, current, onDone, queryClient, toast]);

  const action = useMutation({
    mutationFn: async (kind: "submit" | "cancel" | "retry") => {
      if (kind === "submit") return submit({ loginId: state.id, code });
      if (kind === "cancel") {
        await cancel({ loginId: state.id });
        return { ...state, status: "canceled" as const };
      }
      return startLogin({ accountId: state.accountId });
    },
    onSuccess: (next, kind) => {
      if (kind === "submit") setCode("");
      if (kind === "retry") handled.current = null;
      setCurrent(next);
      queryClient.setQueryData(["claude-accounts", "login", next.id], next);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const message =
    state.status === "starting"
      ? "Starting Claude Code…"
      : state.status === "waiting"
        ? "Finish signing in in your browser. This page updates when you are done."
        : state.status === "verifying"
          ? "Checking the sign-in…"
          : state.status === "failed"
            ? state.error ?? "Sign-in failed."
            : "Signed in.";

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        {final ? null : <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />}
        <Text style={state.status === "failed" ? styles.error : styles.text}>{message}</Text>
      </View>
      {state.status === "waiting" && state.error ? (
        <Text style={styles.error}>{state.error}</Text>
      ) : null}
      {state.status === "waiting" && state.url ? (
        <>
          <View style={styles.buttons}>
            <Button
              label="Open sign-in page"
              tone="primary"
              styles={styles}
              onPress={() =>
                void openExternalUrl(state.url!).catch(() =>
                  copyText(state.url!).then(() => toast.show("Sign-in link copied.")),
                )
              }
            />
            <Button
              label="Copy link"
              styles={styles}
              onPress={() =>
                void copyText(state.url!).then(() => toast.show("Sign-in link copied."))
              }
            />
          </View>
          <Text style={styles.muted}>
            Signing in on another device? After signing in, the page shows a code. Paste it here.
          </Text>
          <View style={styles.codeRow}>
            <TextInput
              accessibilityLabel="Sign-in code"
              placeholder="Paste code"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={code}
              onChangeText={setCode}
              onSubmitEditing={() => code.trim() && action.mutate("submit")}
              style={[styles.textArea, styles.codeInput]}
            />
            <Button
              label="Submit"
              styles={styles}
              disabled={!code.trim() || action.isPending}
              onPress={() => action.mutate("submit")}
            />
          </View>
        </>
      ) : null}
      <View style={styles.stackedActions}>
        {state.status === "failed" ? (
          <>
            <Button label="Dismiss" styles={styles} onPress={onDone} />
            {state.error?.includes("already connected") ? null : (
              <Button
                label="Try again"
                tone="primary"
                styles={styles}
                disabled={action.isPending}
                onPress={() => action.mutate("retry")}
              />
            )}
          </>
        ) : final ? null : (
          <Button
            label="Cancel"
            styles={styles}
            disabled={action.isPending}
            onPress={() => action.mutate("cancel")}
          />
        )}
      </View>
    </View>
  );
}

function RenameRow({
  account,
  onDone,
  theme,
  styles,
}: {
  account: Account;
  onDone(): void;
  theme: Theme;
  styles: ReturnType<typeof useStyles>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const rename = useRpc(renameAccountRpc);
  const [label, setLabel] = useState(account.label);
  const mutation = useMutation({
    mutationFn: () => rename({ id: account.id, label }),
    onSuccess: onDone,
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const save = () => {
    if (!label.trim() || label.trim() === account.label) return onDone();
    mutation.mutate();
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Name</Text>
      <View style={styles.codeRow}>
        <TextInput
          accessibilityLabel="Account name"
          autoFocus
          value={label}
          onChangeText={setLabel}
          onSubmitEditing={save}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[styles.textArea, styles.codeInput]}
        />
        <Button label="Cancel" styles={styles} onPress={onDone} />
        <Button
          label="Save"
          tone="primary"
          styles={styles}
          disabled={!label.trim() || mutation.isPending}
          onPress={save}
        />
      </View>
    </View>
  );
}

function AccountRow({
  account,
  signingIn,
  onSignIn,
  theme,
  styles,
}: {
  account: Account;
  /** Another sign-in is running: starting one here would cancel nothing but confuse. */
  signingIn: boolean;
  onSignIn(accountId: string): void;
  theme: Theme;
  styles: ReturnType<typeof useStyles>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const activate = useRpc(activateAccountRpc);
  const clearLimit = useRpc(clearLimitRpc);
  const remove = useRpc(removeAccountRpc);
  const [renaming, setRenaming] = useState(false);

  const mutation = useMutation({
    mutationFn: async (action: "activate" | "clear" | "remove") => {
      if (action === "activate") {
        const { reloaded } = await activate({ id: account.id, reloadIdleAgents: true });
        return reloaded > 0
          ? `Using ${account.label}. Reopened ${reloaded} idle agent${reloaded === 1 ? "" : "s"}.`
          : `Using ${account.label}.`;
      }
      if (action === "clear") {
        await clearLimit({ id: account.id });
        return `${account.label} marked available.`;
      }
      await remove({ id: account.id });
      return `${account.label} removed.`;
    },
    onSuccess: (message) => toast.show(message, { variant: "success" }),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });

  if (renaming) {
    return (
      <RenameRow
        account={account}
        onDone={() => setRenaming(false)}
        theme={theme}
        styles={styles}
      />
    );
  }

  const signedIn = account.email !== null || account.isDefault;
  return (
    <SettingsRow label={account.label} hint={accountHint(account)}>
      <View style={styles.buttons}>
        {!account.active && signedIn ? (
          <Button
            label="Use"
            tone="primary"
            styles={styles}
            disabled={mutation.isPending}
            onPress={() => mutation.mutate("activate")}
          />
        ) : null}
        {!signedIn ? (
          <Button
            label="Sign in"
            tone="primary"
            styles={styles}
            disabled={signingIn}
            onPress={() => onSignIn(account.id)}
          />
        ) : null}
        {account.limitedUntil ? (
          <Button
            label="Clear limit"
            styles={styles}
            disabled={mutation.isPending}
            onPress={() => mutation.mutate("clear")}
          />
        ) : null}
        <Button label="Rename" styles={styles} onPress={() => setRenaming(true)} />
        {signedIn ? (
          <Button
            label="Sign in again"
            styles={styles}
            disabled={signingIn}
            onPress={() => onSignIn(account.id)}
          />
        ) : null}
        {!account.isDefault ? (
          <Button
            label="Remove"
            tone="danger"
            styles={styles}
            disabled={mutation.isPending}
            onPress={() => mutation.mutate("remove")}
          />
        ) : null}
      </View>
    </SettingsRow>
  );
}

function Preferences({
  autoSwitch,
  resumePrompt,
  theme,
  styles,
}: {
  autoSwitch: boolean;
  resumePrompt: string;
  theme: Theme;
  styles: ReturnType<typeof useStyles>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const update = useRpc(updatePreferencesRpc);
  const [draft, setDraft] = useState(resumePrompt);
  const mutation = useMutation({
    mutationFn: update,
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  return (
    <>
      <SettingsSwitch
        label="Switch automatically"
        hint="When a Claude agent hits a usage limit, move to the next available account and continue the turn"
        value={autoSwitch}
        disabled={mutation.isPending}
        onValueChange={(value) => mutation.mutate({ autoSwitch: value })}
      />
      <View style={styles.stacked}>
        <Text style={styles.label}>Resume prompt</Text>
        <Text style={styles.muted}>Sent to the agent after it switches accounts</Text>
        <TextInput
          accessibilityLabel="Resume prompt"
          multiline
          defaultValue={resumePrompt}
          onChangeText={setDraft}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.textArea}
        />
        <View style={styles.stackedActions}>
          <Button
            label={mutation.isPending ? "Saving…" : "Save"}
            tone="primary"
            styles={styles}
            disabled={!draft.trim() || draft.trim() === resumePrompt || mutation.isPending}
            onPress={() =>
              mutation.mutate(
                { resumePrompt: draft },
                { onSuccess: () => toast.show("Resume prompt saved.", { variant: "success" }) },
              )
            }
          />
        </View>
      </View>
    </>
  );
}

export function AccountsSettings({ theme }: PluginSurfaceProps) {
  const styles = useStyles(theme);
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useRpc(listAccountsRpc);
  const startLogin = useRpc(startLoginRpc);
  const [login, setLogin] = useState<LoginState | null>(null);
  const query = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => list({}),
    refetchInterval: 15_000,
  });
  const begin = useMutation({
    mutationFn: (accountId?: string) => startLogin(accountId ? { accountId } : {}),
    onSuccess: (state) => {
      setLogin(state);
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const endLogin = useCallback(() => setLogin(null), []);

  if (query.isPending) return <Loading />;
  if (query.isError) {
    return <Text style={styles.error}>Could not load accounts: {String(query.error)}</Text>;
  }
  const { accounts, preferences } = query.data;
  const signingIn = login !== null || begin.isPending;

  return (
    <View style={styles.screen}>
      <SettingsSection
        title="Accounts"
        info={
          <Text style={styles.muted}>
            New Claude agents use the active account. Every account shares Claude Code's settings
            and session history, so a conversation continues on whichever account it switches to.
          </Text>
        }
      >
        <SettingsCard>
          {accounts.map((account) =>
            login?.accountId === account.id ? (
              <View key={account.id}>
                <SettingsRow
                  label={account.email ? account.label : "Signing in a new account"}
                  hint={account.email ? accountHint(account) : undefined}
                />
                <SignInPanel login={login} onDone={endLogin} theme={theme} styles={styles} />
              </View>
            ) : (
              <AccountRow
                key={account.id}
                account={account}
                signingIn={signingIn}
                onSignIn={(id) => begin.mutate(id)}
                theme={theme}
                styles={styles}
              />
            ),
          )}
          <SettingsAction
            label="Add account"
            hint="Sign in with another Claude subscription. Your browser opens to Claude's sign-in page."
            actionLabel={begin.isPending ? "Starting…" : "Add account"}
            disabled={signingIn}
            onPress={() => begin.mutate(undefined)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Switching">
        <SettingsCard>
          <Preferences
            key={preferences.resumePrompt}
            autoSwitch={preferences.autoSwitch}
            resumePrompt={preferences.resumePrompt}
            theme={theme}
            styles={styles}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
