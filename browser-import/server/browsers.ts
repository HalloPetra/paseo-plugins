import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A Chromium-family browser on macOS: where its user data lives and which Keychain item encrypts its cookies. */
export interface Browser {
  id: string;
  label: string;
  /** Relative to ~/Library/Application Support. */
  dir: string;
  keychainService: string;
}

export const BROWSERS: readonly Browser[] = [
  { id: "chrome", label: "Google Chrome", dir: "Google/Chrome", keychainService: "Chrome Safe Storage" },
  { id: "chrome-beta", label: "Chrome Beta", dir: "Google/Chrome Beta", keychainService: "Chrome Safe Storage" },
  { id: "chrome-canary", label: "Chrome Canary", dir: "Google/Chrome Canary", keychainService: "Chrome Safe Storage" },
  { id: "arc", label: "Arc", dir: "Arc/User Data", keychainService: "Arc Safe Storage" },
  { id: "dia", label: "Dia", dir: "Dia/User Data", keychainService: "Dia Safe Storage" },
  { id: "brave", label: "Brave", dir: "BraveSoftware/Brave-Browser", keychainService: "Brave Safe Storage" },
  { id: "edge", label: "Microsoft Edge", dir: "Microsoft Edge", keychainService: "Microsoft Edge Safe Storage" },
  { id: "vivaldi", label: "Vivaldi", dir: "Vivaldi", keychainService: "Vivaldi Safe Storage" },
  { id: "opera", label: "Opera", dir: "com.operasoftware.Opera", keychainService: "Opera Safe Storage" },
  { id: "comet", label: "Comet", dir: "Comet", keychainService: "Comet Safe Storage" },
  { id: "ardia", label: "Ardia", dir: "com.ardia.browser/Chromium", keychainService: "Ardia Safe Storage" },
  { id: "chromium", label: "Chromium", dir: "Chromium", keychainService: "Chromium Safe Storage" },
];

export interface Profile {
  id: string;
  browser: Browser;
  /** The profile's directory name, such as "Default" or "Profile 2". */
  dir: string;
  name: string;
  cookiesPath: string;
}

export function applicationSupport(): string {
  return join(homedir(), "Library", "Application Support");
}

/** Newer Chromium keeps cookies under Network/; older builds and forks keep them in the profile root. */
function cookiesIn(profilePath: string): string | null {
  for (const candidate of [join(profilePath, "Network", "Cookies"), join(profilePath, "Cookies")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function profileNames(root: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const state = JSON.parse(readFileSync(join(root, "Local State"), "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: unknown }> };
    };
    for (const [dir, info] of Object.entries(state.profile?.info_cache ?? {})) {
      if (typeof info.name === "string" && info.name) names.set(dir, info.name);
    }
  } catch {
    // No Local State: fall back to directory names.
  }
  return names;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverProfiles(): Profile[] {
  const profiles: Profile[] = [];
  for (const browser of BROWSERS) {
    const root = join(applicationSupport(), browser.dir);
    if (!isDirectory(root)) continue;
    const names = profileNames(root);
    const rootCookies = cookiesIn(root);
    if (rootCookies) {
      // Opera keeps a single profile in the user data directory itself.
      profiles.push({ id: `${browser.id}:.`, browser, dir: ".", name: "Default", cookiesPath: rootCookies });
    }
    for (const entry of readdirSync(root).sort()) {
      if (entry !== "Default" && !entry.startsWith("Profile ") && !names.has(entry)) continue;
      const cookiesPath = cookiesIn(join(root, entry));
      if (!cookiesPath) continue;
      const name = names.get(entry) ?? entry;
      // Arc's internal profile holds no browsing state worth importing.
      if (name.startsWith("__")) continue;
      profiles.push({ id: `${browser.id}:${entry}`, browser, dir: entry, name, cookiesPath });
    }
  }
  return profiles;
}

export function findProfile(id: string): Profile {
  const profile = discoverProfiles().find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Browser profile ${id} was not found.`);
  return profile;
}

/**
 * The cookie store of the Paseo desktop browser: the `persist:paseo-browser` Electron partition
 * that every browser tab shares. Prefers the stable app's data directory over other builds.
 */
export function findPaseoCookieStore(): string | null {
  const support = applicationSupport();
  let entries: string[];
  try {
    entries = readdirSync(support).filter((entry) => entry.startsWith("Paseo"));
  } catch {
    return null;
  }
  entries.sort((a, b) => (a === "Paseo" ? -1 : b === "Paseo" ? 1 : a.localeCompare(b)));
  for (const entry of entries) {
    const path = join(support, entry, "Partitions", "paseo-browser", "Cookies");
    if (existsSync(path)) return path;
  }
  return null;
}
