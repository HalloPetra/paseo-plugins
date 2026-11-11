import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useTabState } from "@getpaseo/plugin/client";
import { Icon, Loading, Markdown, ScrollView } from "@getpaseo/plugin/client/ui";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import type { Check, PrComment, PullRequest } from "../shared/pr";
import { sanitizeMarkdown } from "./markdown";
import { PanelNavigationContext } from "./agent-prompt";
import { FixChecksCard } from "./fix-checks";
import { MergeBox } from "./merge-box";
import { ResolveConflictsButton } from "./resolve-conflicts";
import { Spinner } from "./spinner";
import { MERGED_COLOR } from "./status";
import { usePr } from "./use-pr";
import { openExternal } from "./web";

type Colors = PluginTheme["colors"];

function makeStyles(colors: Colors, compact: boolean) {
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: compact ? 12 : 16, gap: 16 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    wrapRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 6 },
    title: { color: colors.foreground, fontSize: compact ? 16 : 17, fontWeight: "600" as const },
    text: { color: colors.foreground, fontSize: 13 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    mono: { color: colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" },
    section: { gap: 8 },
    sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, justifyContent: "space-between" as const },
    sectionTitle: { color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.5, textTransform: "uppercase" as const },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1, overflow: "hidden" as const },
    cardBody: { padding: 10, gap: 6 },
    divider: { height: 1, backgroundColor: colors.border },
    checkRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
    button: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.surface2 },
    buttonText: { color: colors.foreground, fontSize: 12 },
    empty: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 24, gap: 8 },
  };
}
type Styles = ReturnType<typeof makeStyles>;

function Badge({ label, color, styles }: { label: string; color: string; styles: Styles }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

/** Collapsed section ids, persisted per tab. */
const SectionsContext = createContext<{ isCollapsed(id: string): boolean; toggle(id: string): void; muted: string }>({
  isCollapsed: () => false,
  toggle: () => {},
  muted: "#888",
});

function Section({ id, title, right, children, styles }: { id: string; title: string; right?: ReactNode; children: ReactNode; styles: Styles }) {
  const sections = useContext(SectionsContext);
  const collapsed = sections.isCollapsed(id);
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${title}`}
        onPress={() => sections.toggle(id)}
        style={styles.sectionHeader}
      >
        <View style={styles.row}>
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={12} color={sections.muted} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {right}
      </Pressable>
      {!collapsed && children}
    </View>
  );
}

function stateBadge(pr: PullRequest, colors: Colors): { label: string; color: string } {
  if (pr.state === "MERGED") return { label: "Merged", color: MERGED_COLOR };
  if (pr.state === "CLOSED") return { label: "Closed", color: colors.statusDanger };
  if (pr.isDraft) return { label: "Draft", color: colors.foregroundMuted };
  return { label: "Open", color: colors.statusSuccess };
}

function checkVisual(status: Check["status"], colors: Colors) {
  switch (status) {
    case "success": return { icon: "CircleCheck", color: colors.statusSuccess };
    case "failure": return { icon: "CircleX", color: colors.statusDanger };
    case "pending": return { icon: "CircleDot", color: colors.statusWarning };
    default: return { icon: "CircleSlash", color: colors.foregroundMuted };
  }
}

const MERGE_STATE_TEXT: Record<string, string> = {
  CLEAN: "Ready to merge",
  HAS_HOOKS: "Ready to merge (with hooks)",
  UNSTABLE: "Mergeable, but some checks are not passing",
  BLOCKED: "Blocked by branch protection or required reviews",
  BEHIND: "Branch is behind the base branch",
  DIRTY: "Merge conflicts must be resolved",
  DRAFT: "Draft pull request",
  UNKNOWN: "Mergeability is being computed",
};

const REVIEW_TEXT: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

function mergeVisual(pr: PullRequest, colors: Colors) {
  if (pr.state === "MERGED") return { icon: "GitMerge", color: MERGED_COLOR, text: "Merged" };
  if (pr.state === "CLOSED") return { icon: "GitPullRequestClosed", color: colors.statusDanger, text: "Closed" };
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY")
    return { icon: "TriangleAlert", color: colors.statusWarning, text: MERGE_STATE_TEXT.DIRTY };
  const s = pr.mergeStateStatus;
  const color =
    s === "CLEAN" || s === "HAS_HOOKS" ? colors.statusSuccess
    : s === "BLOCKED" || s === "BEHIND" || s === "UNSTABLE" ? colors.statusWarning
    : colors.foregroundMuted;
  const icon = s === "CLEAN" || s === "HAS_HOOKS" ? "GitMerge" : s === "UNKNOWN" ? "LoaderCircle" : "ShieldAlert";
  return { icon, color, text: MERGE_STATE_TEXT[s] ?? s.toLowerCase() };
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Checks({ checks, colors, styles, fix }: { checks: Check[]; colors: Colors; styles: Styles; fix?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const counts = { success: 0, failure: 0, pending: 0, other: 0 };
  for (const c of checks) {
    if (c.status === "success") counts.success++;
    else if (c.status === "failure") counts.failure++;
    else if (c.status === "pending") counts.pending++;
    else counts.other++;
  }
  const summary = [
    counts.failure && `${counts.failure} failing`,
    counts.pending && `${counts.pending} pending`,
    counts.success && `${counts.success} passing`,
    counts.other && `${counts.other} skipped`,
  ].filter(Boolean).join(", ");
  // Always show failing and pending; collapse the rest beyond a few.
  const important = checks.filter((c) => c.status === "failure" || c.status === "pending");
  const visible = expanded ? checks : important.length > 0 ? important : checks.slice(0, 5);
  const hidden = checks.length - visible.length;

  if (checks.length === 0) {
    return <Section id="checks" title="Checks" styles={styles}><Text style={styles.muted}>No checks reported.</Text></Section>;
  }
  return (
    <Section id="checks" title="Checks" styles={styles} right={<Text style={styles.muted}>{summary}</Text>}>
      {counts.failure > 0 && fix}
      <View style={styles.card}>
        {visible.map((check, i) => {
          const v = checkVisual(check.status, colors);
          return (
            <View key={`${check.workflow}-${check.name}-${i}`}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable
                accessibilityRole={check.url ? "link" : undefined}
                accessibilityLabel={`${check.name}: ${check.status}`}
                disabled={!check.url}
                onPress={() => check.url && openExternal(check.url)}
                style={styles.checkRow}
              >
                <Icon name={v.icon} size={14} color={v.color} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.text} numberOfLines={1}>{check.name}</Text>
                  {(check.workflow || check.detail) && (
                    <Text style={styles.muted} numberOfLines={1}>
                      {[check.workflow, check.detail].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </View>
                {check.url && <Icon name="ExternalLink" size={12} color={colors.foregroundMuted} />}
              </Pressable>
            </View>
          );
        })}
        {(hidden > 0 || expanded) && (
          <>
            <View style={styles.divider} />
            <Pressable accessibilityRole="button" onPress={() => setExpanded((e) => !e)} style={styles.checkRow}>
              <Text style={styles.muted}>{expanded ? "Show fewer" : `Show ${hidden} more`}</Text>
            </Pressable>
          </>
        )}
      </View>
    </Section>
  );
}

const BOT_AUTHOR = /\[bot\]$|^(vercel|linear|github-actions|codecov|changeset-bot|dependabot|renovate|netlify|coderabbitai|sonarcloud)$/i;

function preview(body: string): string {
  return sanitizeMarkdown(body).replace(/[#>*_`|\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function CommentCard({ comment, colors, styles }: { comment: PrComment; colors: Colors; styles: Styles }) {
  const [expanded, setExpanded] = useState(() => !BOT_AUTHOR.test(comment.author));
  const body = useMemo(() => sanitizeMarkdown(comment.body), [comment.body]);
  const reviewColor =
    comment.reviewState === "APPROVED" ? colors.statusSuccess
    : comment.reviewState === "CHANGES_REQUESTED" ? colors.statusDanger
    : colors.foregroundMuted;
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} comment by ${comment.author}`}
          onPress={() => setExpanded((e) => !e)}
          style={styles.wrapRow}
        >
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={12} color={colors.foregroundMuted} />
          <Text style={[styles.text, { fontWeight: "600" }]}>{comment.author}</Text>
          {comment.kind === "review" && comment.reviewState && (
            <Badge label={comment.reviewState.replace(/_/g, " ").toLowerCase()} color={reviewColor} styles={styles} />
          )}
          <Text style={styles.muted}>{relativeTime(comment.createdAt)}</Text>
          <View style={{ flex: 1 }} />
          {comment.url && (
            <Pressable accessibilityRole="link" accessibilityLabel="Open comment on GitHub" onPress={() => openExternal(comment.url!)}>
              <Icon name="ExternalLink" size={12} color={colors.foregroundMuted} />
            </Pressable>
          )}
        </Pressable>
        {comment.path && (
          <Text style={styles.mono} numberOfLines={1}>
            {comment.path}{comment.line != null ? `:${comment.line}` : ""}
          </Text>
        )}
        {expanded
          ? body !== "" && <Markdown>{body}</Markdown>
          : body !== "" && <Text style={styles.muted} numberOfLines={1}>{preview(comment.body)}</Text>}
      </View>
    </View>
  );
}

function PrView({ pr, directory, workspaceId, colors, styles }: { pr: PullRequest; directory: string; workspaceId: string; colors: Colors; styles: Styles }) {
  const state = stateBadge(pr, colors);
  const merge = mergeVisual(pr, colors);
  return (
    <>
      <View style={{ gap: 8 }}>
        <View style={styles.wrapRow}>
          <Badge label={state.label} color={state.color} styles={styles} />
          <Text style={styles.muted}>#{pr.number} by {pr.author}</Text>
        </View>
        <Text style={styles.title}>{pr.title}</Text>
        <Text style={styles.mono} numberOfLines={1}>{pr.headRefName} → {pr.baseRefName}</Text>
        <View style={styles.wrapRow}>
          <Text style={{ color: colors.statusSuccess, fontSize: 12 }}>+{pr.additions}</Text>
          <Text style={{ color: colors.statusDanger, fontSize: 12 }}>−{pr.deletions}</Text>
          <Text style={styles.muted}>in {pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}</Text>
        </View>
      </View>

      <Section id="merge" title="Mergeability" styles={styles}>
        <View style={[styles.card, styles.cardBody, { borderColor: merge.color }]}>
          <View style={styles.row}>
            <Spinner name={merge.icon} size={14} color={merge.color} spinning={merge.icon === "LoaderCircle"} />
            <Text style={[styles.text, { color: merge.color, flex: 1 }]}>{merge.text}</Text>
          </View>
          {pr.reviewDecision && pr.state === "OPEN" && (
            <Text style={styles.muted}>Review: {REVIEW_TEXT[pr.reviewDecision] ?? pr.reviewDecision}</Text>
          )}
          {pr.state === "OPEN" && (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") ? (
            <ResolveConflictsButton pr={pr} workspaceId={workspaceId} colors={colors} />
          ) : (
            <MergeBox key={pr.number} pr={pr} directory={directory} colors={colors} />
          )}
        </View>
      </Section>

      <Checks
        checks={pr.checks}
        colors={colors}
        styles={styles}
        fix={pr.state === "OPEN" ? <FixChecksCard pr={pr} directory={directory} workspaceId={workspaceId} colors={colors} /> : undefined}
      />

      <Section id="description" title="Description" styles={styles}>
        {pr.body.trim() ? (
          <View style={[styles.card, styles.cardBody]}><Markdown>{sanitizeMarkdown(pr.body)}</Markdown></View>
        ) : (
          <Text style={styles.muted}>No description provided.</Text>
        )}
      </Section>

      <Section id="comments" title={`Comments (${pr.comments.length})`} styles={styles}>
        {pr.comments.length === 0 ? (
          <Text style={styles.muted}>No comments yet.</Text>
        ) : (
          pr.comments.map((c) => <CommentCard key={c.id} comment={c} colors={colors} styles={styles} />)
        )}
      </Section>
    </>
  );
}

const tabStateSchema = z.object({ collapsed: z.array(z.string()) });

export function PrPanel({ theme, layout, workspaceId, tab, navigation }: PluginWorkspacePanelProps) {
  const colors = theme.colors;
  const styles = useMemo(() => makeStyles(colors, layout.compact), [colors, layout.compact]);
  const { directory, query } = usePr(workspaceId);
  const [tabState, setTabState] = useTabState(tab, tabStateSchema, { collapsed: [] });
  const toggle = useCallback(
    (id: string) => {
      const collapsed = tabState.collapsed.includes(id)
        ? tabState.collapsed.filter((c) => c !== id)
        : [...tabState.collapsed, id];
      setTabState({ collapsed });
    },
    [tabState, setTabState],
  );
  const sections = useMemo(
    () => ({ isCollapsed: (id: string) => tabState.collapsed.includes(id), toggle, muted: colors.foregroundMuted }),
    [tabState, toggle, colors.foregroundMuted],
  );

  if (!directory || (query.isPending && !query.data)) return <Loading />;

  const data = query.data;
  const pr = data?.pr ?? null;
  const error = query.error ? String(query.error instanceof Error ? query.error.message : query.error) : data?.error;

  return (
    <View style={styles.screen}>
      <View style={[styles.sectionHeader, { paddingHorizontal: layout.compact ? 12 : 16, paddingTop: 10 }]}>
        <Text style={styles.muted} numberOfLines={1}>
          {query.isFetching ? "Refreshing…" : data?.branch ? `Branch ${data.branch}` : ""}
        </Text>
        <View style={styles.row}>
          {pr && (
            <Pressable accessibilityRole="link" accessibilityLabel="Open pull request on GitHub" onPress={() => openExternal(pr.url)} style={styles.button}>
              <Icon name="ExternalLink" size={12} color={colors.foreground} />
              <Text style={styles.buttonText}>GitHub</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh pull request" onPress={() => query.refetch()} style={styles.button}>
            <Spinner name="RefreshCw" size={12} color={colors.foreground} spinning={query.isFetching} />
          </Pressable>
        </View>
      </View>
      {error ? (
        <View style={styles.empty}>
          <Icon name="TriangleAlert" size={20} color={colors.statusDanger} />
          <Text style={[styles.text, { textAlign: "center" }]}>{error}</Text>
        </View>
      ) : !pr ? (
        <View style={styles.empty}>
          <Icon name="GitPullRequest" size={20} color={colors.foregroundMuted} />
          <Text style={[styles.muted, { textAlign: "center" }]}>
            No pull request for {data?.branch ? `branch ${data.branch}` : "this workspace"}.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <PanelNavigationContext.Provider value={navigation}>
            <SectionsContext.Provider value={sections}>
              <PrView pr={pr} directory={directory} workspaceId={workspaceId} colors={colors} styles={styles} />
            </SectionsContext.Provider>
          </PanelNavigationContext.Provider>
        </ScrollView>
      )}
    </View>
  );
}
