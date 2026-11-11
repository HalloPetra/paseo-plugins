import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { type MergeMethod, type PullRequest, mergePrRpc } from "../shared/pr";
import { Dropdown } from "./dropdown";

type Colors = PluginTheme["colors"];

const METHODS: Record<MergeMethod, { label: string; action: string; description: string; icon: string }> = {
  merge: {
    label: "Create a merge commit",
    action: "Merge pull request",
    description: "All commits are added to the base branch via a merge commit.",
    icon: "GitMerge",
  },
  squash: {
    label: "Squash and merge",
    action: "Squash and merge",
    description: "All commits are combined into one commit on the base branch.",
    icon: "GitCommitHorizontal",
  },
  rebase: {
    label: "Rebase and merge",
    action: "Rebase and merge",
    description: "All commits are rebased onto the base branch individually.",
    icon: "GitBranch",
  },
};

/** Why the PR can't be merged right now, or null when it can. */
function mergeBlocker(pr: PullRequest): string | null {
  if (pr.state !== "OPEN") return null; // Box is hidden for closed/merged PRs.
  if (pr.isDraft) return "Draft pull requests can't be merged.";
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") return "Resolve conflicts before merging.";
  if (pr.mergeStateStatus === "BLOCKED") return "Merging is blocked by branch protection.";
  if (pr.mergeStateStatus === "BEHIND") return "Update the branch before merging.";
  if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN") return "Checking mergeability…";
  if (pr.mergeMethods.length === 0) return "This repository allows no merge methods.";
  return null;
}

export function MergeBox({ pr, directory, colors }: { pr: PullRequest; directory: string; colors: Colors }) {
  const allowed = pr.mergeMethods;
  const [method, setMethod] = useState<MergeMethod>(allowed.includes("merge") ? "merge" : (allowed[0] ?? "merge"));
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const [confirming, setConfirming] = useState(false);
  const merge = useRpc(mergePrRpc);
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => merge({ directory, number: pr.number, method, headRefOid: pr.headRefOid }),
    onSuccess: (result) => {
      setConfirming(false);
      if (result.ok) toast.show(`Merged #${pr.number}`, { variant: "success" });
      else toast.error(result.message);
    },
    onError: (error) => {
      setConfirming(false);
      toast.error(error instanceof Error ? error.message : String(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["github-pr", directory] }),
  });

  if (pr.state !== "OPEN") return null;

  const blocker = mergeBlocker(pr);
  const disabled = blocker !== null || mutation.isPending;
  const warn = pr.mergeStateStatus === "UNSTABLE";
  const bg = disabled ? colors.surface2 : warn ? colors.statusWarning : colors.statusSuccess;
  const fg = disabled ? colors.foregroundMuted : colors.accentForeground;
  const current = METHODS[method];

  return (
    <View style={{ gap: 6 }}>
      <View ref={anchorRef} collapsable={false} style={{ flexDirection: "row", borderRadius: 6, overflow: "hidden", opacity: mutation.isPending ? 0.7 : 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={current.action}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setConfirming(true)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: bg }}
        >
          <Icon name={current.icon} size={14} color={fg} />
          <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
            {mutation.isPending ? "Merging…" : current.action}
          </Text>
        </Pressable>
        {allowed.length > 1 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose merge method"
            accessibilityState={{ expanded: menuOpen, disabled: mutation.isPending }}
            disabled={mutation.isPending}
            onPress={() => setMenuOpen((open) => !open)}
            style={{ justifyContent: "center", paddingHorizontal: 10, backgroundColor: bg, borderLeftWidth: 1, borderLeftColor: colors.surface0 }}
          >
            <Icon name={menuOpen ? "ChevronUp" : "ChevronDown"} size={14} color={fg} />
          </Pressable>
        )}
      </View>

      <Dropdown<MergeMethod>
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={anchorRef}
        options={allowed.map((m) => ({ value: m, label: METHODS[m].label, description: METHODS[m].description }))}
        selected={method}
        onSelect={setMethod}
        colors={colors}
      />

      {blocker && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{blocker}</Text>}
      {!blocker && warn && (
        <Text style={{ color: colors.statusWarning, fontSize: 12 }}>Some checks are not passing.</Text>
      )}

      <Modal
        transparent
        visible={confirming}
        animationType="fade"
        onRequestClose={() => !mutation.isPending && setConfirming(false)}
      >
        <Pressable
          accessibilityLabel="Cancel"
          onPress={() => !mutation.isPending && setConfirming(false)}
          style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" }}
        >
          <View
            accessibilityRole="alert"
            // Keep taps inside the dialog from reaching the backdrop.
            onStartShouldSetResponder={() => true}
            style={{
              width: "100%",
              maxWidth: 380,
              gap: 12,
              padding: 18,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface1,
              shadowColor: "#000",
              shadowOpacity: 0.3,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 10,
            }}
          >
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>
            {current.label} for #{pr.number} into {pr.baseRefName}?
          </Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }} numberOfLines={3}>
            {pr.title}
          </Text>
          {warn && (
            <Text style={{ color: colors.statusWarning, fontSize: 13 }}>Some checks are not passing.</Text>
          )}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={mutation.isPending}
              onPress={() => setConfirming(false)}
              style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: colors.surface2 }}
            >
              <Text style={{ color: colors.foreground, fontSize: 13 }}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={mutation.isPending}
              onPress={() => mutation.mutate()}
              style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: warn ? colors.statusWarning : colors.statusSuccess }}
            >
              <Text style={{ color: colors.accentForeground, fontSize: 13, fontWeight: "600" }}>
                {mutation.isPending ? "Merging…" : `Confirm ${current.action.toLowerCase()}`}
              </Text>
            </Pressable>
          </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
