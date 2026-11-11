import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { setHeaderLabel } from "./header-labels";
import { prStatusColor, prStatusIcon } from "./status";
import { usePr } from "./use-pr";

/**
 * Header button icon: PR icon tinted by overall status. The PR number goes into the
 * button's own label (sized by Paseo), since icon content is clipped to icon size.
 */
export function PrHeaderIcon(props: PluginButtonIconProps) {
  const { query } = usePr(props.workspaceId);
  const pr = query.data?.pr ?? null;
  const label = pr ? `#${pr.number}` : undefined;
  useEffect(() => {
    setHeaderLabel(props.workspaceId, label);
  }, [props.workspaceId, label]);
  if (!pr) return <Icon name="GitPullRequest" size={props.size} color={props.color} />;
  return <Icon name={prStatusIcon(pr)} size={props.size} color={prStatusColor(pr, props.theme.colors)} />;
}
