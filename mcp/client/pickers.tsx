import type { PluginTheme } from "@getpaseo/plugin";
import { Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Project, Target } from "../shared/mcp";
import type { Styles } from "./styles";

export function ProjectPicker({
  open,
  onClose,
  projects,
  value,
  onChange,
  theme,
  styles,
}: {
  open: boolean;
  onClose(): void;
  projects: Project[];
  value: string;
  onChange(path: string): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? projects.filter((project) => project.path.toLowerCase().includes(needle)) : projects;
    return list.slice(0, 200);
  }, [projects, query]);
  const custom = query.trim().startsWith("/") && !projects.some((project) => project.path === query.trim());

  const pick = (path: string) => {
    onChange(path);
    setQuery("");
    onClose();
  };

  return (
    <Modal title="Project" open={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content>
        <Text style={styles.muted}>
          Local servers and on/off switches belong to a project. Projects Claude Code has opened are listed;
          ones with MCP settings come first. Type an absolute path to use another directory.
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter or type a path"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={styles.input}
        />
        <View>
          {custom ? (
            <Pressable accessibilityRole="button" onPress={() => pick(query.trim())} style={styles.listItem}>
              <Text style={styles.text}>Use {query.trim()}</Text>
            </Pressable>
          ) : null}
          {filtered.map((project) => (
            <Pressable
              key={project.path}
              accessibilityRole="button"
              accessibilityState={{ selected: project.path === value }}
              onPress={() => pick(project.path)}
              style={(state) => [
                styles.listItem,
                (project.path === value || (state as { hovered?: boolean }).hovered) && styles.listItemActive,
              ]}
            >
              <Text style={styles.text} numberOfLines={1}>
                {project.label}
              </Text>
              {project.hasMcp ? <Text style={styles.muted}>Has MCP settings</Text> : null}
            </Pressable>
          ))}
          {filtered.length === 0 && !custom ? <Text style={styles.empty}>No matching projects.</Text> : null}
        </View>
      </Modal.Content>
    </Modal>
  );
}

export function TargetPicker({
  targets,
  value,
  onChange,
  styles,
}: {
  targets: Target[];
  value: string;
  onChange(id: string): void;
  styles: Styles;
}) {
  return (
    <View style={styles.segment}>
      {targets.map((target) => {
        const active = target.id === value;
        return (
          <Pressable
            key={target.id}
            accessibilityRole="button"
            accessibilityLabel={`Claude login ${target.label}`}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(target.id)}
            style={[styles.segmentItem, active && styles.segmentActive]}
          >
            <Text style={active ? styles.primaryText : styles.buttonText}>
              {target.label}
              {target.active ? " · in use" : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
