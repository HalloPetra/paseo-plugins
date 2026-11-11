import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type EditableScope, isEditableScope, saveServerRpc, type Server } from "../shared/mcp";
import { Button, type Styles } from "./styles";

type Transport = "stdio" | "http" | "sse";
type Mode = "form" | "json";

interface FormState {
  transport: Transport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

const EMPTY_FORM: FormState = { transport: "stdio", command: "", args: "", env: "", url: "", headers: "" };
const FORM_KEYS: Record<Transport, string[]> = {
  stdio: ["type", "command", "args", "env"],
  http: ["type", "url", "headers"],
  sse: ["type", "url", "headers"],
};

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function pairs(text: string, separator: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of lines(text)) {
    const index = line.indexOf(separator);
    if (index <= 0) throw new Error(`Expected "name${separator}value", got "${line}".`);
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function formToConfig(form: FormState): Record<string, unknown> {
  if (form.transport === "stdio") {
    if (!form.command.trim()) throw new Error("Enter the command that starts the server.");
    const env = pairs(form.env, "=");
    return {
      type: "stdio",
      command: form.command.trim(),
      args: lines(form.args),
      ...(Object.keys(env).length ? { env } : {}),
    };
  }
  if (!/^https?:\/\//.test(form.url.trim())) throw new Error("Enter the server URL.");
  const headers = pairs(form.headers, ":");
  return {
    type: form.transport,
    url: form.url.trim(),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

/** Fills the form from a config, or returns null when the form cannot represent it. */
function configToForm(config: Record<string, unknown>): FormState | null {
  const transport = (typeof config.type === "string" ? config.type : "stdio") as Transport;
  if (!(transport in FORM_KEYS)) return null;
  if (Object.keys(config).some((key) => !FORM_KEYS[transport].includes(key))) return null;
  const record = (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    transport,
    command: typeof config.command === "string" ? config.command : "",
    args: Array.isArray(config.args) ? config.args.map(String).join("\n") : "",
    env: Object.entries(record(config.env))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n"),
    url: typeof config.url === "string" ? config.url : "",
    headers: Object.entries(record(config.headers))
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("\n"),
  };
}

function Segment<Value extends string>({
  value,
  options,
  onChange,
  styles,
}: {
  value: Value;
  options: { value: Value; label: string }[];
  onChange(value: Value): void;
  styles: Styles;
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segmentItem, active && styles.segmentActive]}
          >
            <Text style={active ? styles.primaryText : styles.buttonText}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Field({
  label,
  hint,
  styles,
  children,
}: {
  label: string;
  hint?: string;
  styles: Styles;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.title}>{label}</Text>
      {children}
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

export function ServerForm({
  open,
  onClose,
  onSaved,
  editing,
  targetId,
  cwd,
  projectLabel,
  theme,
  styles,
}: {
  open: boolean;
  onClose(): void;
  onSaved(): void;
  /** The server being edited, or null to add one. */
  editing: Server | null;
  targetId: string;
  cwd: string;
  projectLabel: string;
  theme: PluginTheme;
  styles: Styles;
}) {
  const toast = useToast();
  const save = useRpc(saveServerRpc);
  const initialConfig = editing?.config ? (JSON.parse(editing.config) as Record<string, unknown>) : null;
  const initialForm = initialConfig ? configToForm(initialConfig) : EMPTY_FORM;
  const [name, setName] = useState(editing?.label ?? "");
  const [scope, setScope] = useState<EditableScope>(
    editing && isEditableScope(editing.scope) ? editing.scope : "shared",
  );
  const [mode, setMode] = useState<Mode>(initialForm ? "form" : "json");
  const [form, setForm] = useState<FormState>(initialForm ?? EMPTY_FORM);
  const [json, setJson] = useState(editing?.config ?? "");
  const [error, setError] = useState<string | null>(null);
  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));

  const switchMode = (next: Mode) => {
    setError(null);
    if (next === mode) return;
    if (next === "json") {
      try {
        setJson(JSON.stringify(formToConfig(form), null, 2));
      } catch {
        // Keep whatever JSON was there.
      }
      setMode("json");
      return;
    }
    try {
      const parsed = json.trim() ? (JSON.parse(json) as Record<string, unknown>) : null;
      const filled = parsed ? configToForm(parsed) : EMPTY_FORM;
      if (!filled) {
        setError("This config has fields the form cannot show. Edit it as JSON.");
        return;
      }
      setForm(filled);
      setMode("form");
    } catch {
      setError("Fix the JSON before switching to the form.");
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const config = mode === "form" ? JSON.stringify(formToConfig(form)) : json;
      await save({
        targetId,
        cwd,
        name: name.trim(),
        scope,
        config,
        ...(editing && isEditableScope(editing.scope)
          ? { replaces: { name: editing.label, scope: editing.scope } }
          : {}),
      });
    },
    onSuccess: () => {
      toast.show(editing ? `Saved ${name.trim()}.` : `Added ${name.trim()}.`, { variant: "success" });
      onSaved();
      onClose();
    },
    onError: (failure: Error) => setError(failure.message),
  });

  return (
    <Modal title={editing ? `Edit ${editing.label}` : "Add MCP server"} open={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content>
        <Field label="Name" hint="Tools appear to agents as mcp__<name>__<tool>." styles={styles}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="my-server"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>
        <Field
          label="Scope"
          hint={
            scope === "shared"
              ? "Every Claude Code profile on this machine, in every project. Each login signs in once."
              : scope === "user"
                ? "Only this login, in every project."
                : `Only this login, in ${projectLabel}.`
          }
          styles={styles}
        >
          <Segment<EditableScope>
            value={scope}
            onChange={setScope}
            styles={styles}
            options={[
              { value: "shared", label: "All profiles" },
              { value: "user", label: "This login" },
              { value: "local", label: "This project" },
            ]}
          />
        </Field>
        <Segment<Mode>
          value={mode}
          onChange={switchMode}
          styles={styles}
          options={[
            { value: "form", label: "Form" },
            { value: "json", label: "JSON" },
          ]}
        />
        {mode === "json" ? (
          <Field label="Config" hint="The server entry as Claude Code stores it in .claude.json." styles={styles}>
            <TextInput
              value={json}
              onChangeText={setJson}
              multiline
              placeholder={'{\n  "type": "http",\n  "url": "https://example.com/mcp"\n}'}
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.textArea, { minHeight: 180 }]}
            />
          </Field>
        ) : (
          <>
            <Field label="Transport" styles={styles}>
              <Segment<Transport>
                value={form.transport}
                onChange={(transport) => patch({ transport })}
                styles={styles}
                options={[
                  { value: "stdio", label: "Command (stdio)" },
                  { value: "http", label: "HTTP" },
                  { value: "sse", label: "SSE" },
                ]}
              />
            </Field>
            {form.transport === "stdio" ? (
              <>
                <Field label="Command" styles={styles}>
                  <TextInput
                    value={form.command}
                    onChangeText={(command) => patch({ command })}
                    placeholder="npx"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                </Field>
                <Field label="Arguments" hint="One per line." styles={styles}>
                  <TextInput
                    value={form.args}
                    onChangeText={(args) => patch({ args })}
                    multiline
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path"}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, styles.textArea]}
                  />
                </Field>
                <Field label="Environment" hint="KEY=value, one per line." styles={styles}>
                  <TextInput
                    value={form.env}
                    onChangeText={(env) => patch({ env })}
                    multiline
                    placeholder="API_KEY=..."
                    placeholderTextColor={theme.colors.foregroundMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, styles.textArea]}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="URL" styles={styles}>
                  <TextInput
                    value={form.url}
                    onChangeText={(url) => patch({ url })}
                    placeholder="https://example.com/mcp"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                </Field>
                <Field
                  label="Headers"
                  hint="Name: value, one per line. Leave empty for OAuth servers and sign in after adding."
                  styles={styles}
                >
                  <TextInput
                    value={form.headers}
                    onChangeText={(headers) => patch({ headers })}
                    multiline
                    placeholder="Authorization: Bearer ..."
                    placeholderTextColor={theme.colors.foregroundMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, styles.textArea]}
                  />
                </Field>
              </>
            )}
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={[styles.toolbar, { justifyContent: "flex-end" }]}>
          <Button label="Cancel" onPress={onClose} styles={styles} theme={theme} />
          <Button
            label={editing ? "Save" : "Add server"}
            tone="primary"
            busy={mutation.isPending}
            disabled={!name.trim()}
            onPress={() => {
              setError(null);
              mutation.mutate();
            }}
            styles={styles}
            theme={theme}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
