import type { PluginTheme } from "@getpaseo/plugin";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number, digits = 1): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${UNITS[unit]}`;
}

/** Compact rate for the sidebar: "1.2M", "340K", "0". */
export function formatRateShort(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)}B`;
  if (bytesPerSecond < 1024 ** 2) return `${Math.round(bytesPerSecond / 1024)}K`;
  if (bytesPerSecond < 1024 ** 3) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)}M`;
  return `${(bytesPerSecond / 1024 ** 3).toFixed(1)}G`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Green below 70%, amber below 90%, red above. */
export function levelColor(theme: PluginTheme, percent: number): string {
  if (percent >= 90) return theme.colors.statusDanger;
  if (percent >= 70) return theme.colors.statusWarning;
  return theme.colors.statusSuccess;
}
