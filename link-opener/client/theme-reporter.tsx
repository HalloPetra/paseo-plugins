import type { PluginComposerItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect } from "react";
import { setPopoverTheme } from "./web";

/** Hands Paseo's active theme to the link popover, which is drawn outside any plugin component. */
export function useReportTheme(theme: PluginTheme) {
  useEffect(() => {
    setPopoverTheme({
      surface: theme.colors.surface1,
      foreground: theme.colors.foreground,
      muted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      hover: theme.colors.surface2,
    });
  }, [theme]);
}

/** Mounted in every agent composer, so the theme is known before a chat link is clicked. */
export function ThemeReporter({ theme }: PluginComposerItemProps) {
  useReportTheme(theme);
  return null;
}
