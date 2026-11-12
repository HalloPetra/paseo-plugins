import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { Site } from "../shared/import";
import { type Browser, findPaseoCookieStore, findProfile } from "./browsers";

const execFileAsync = promisify(execFile);

type Row = Record<string, unknown>;

/** Chromium timestamps count microseconds from 1601-01-01. */
const EPOCH_DELTA_MS = 11_644_473_600_000n;
function chromiumNow(): bigint {
  return (BigInt(Date.now()) + EPOCH_DELTA_MS) * 1000n;
}
const DAY_US = 86_400_000_000n;
/** Session cookies are dropped when Paseo starts, so imported ones get this lifetime instead. */
const SESSION_COOKIE_LIFETIME_US = 30n * DAY_US;

/**
 * Opens a private copy of a cookie database. The browser may be running and holding the file, and
 * reading a copy never disturbs it. The copy is opened writable so SQLite can roll back a hot journal.
 */
function withSnapshot<T>(path: string, read: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "paseo-browser-import-"));
  try {
    const copy = join(dir, "Cookies");
    copyFileSync(path, copy);
    for (const suffix of ["-journal", "-wal"]) {
      if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix);
    }
    const db = new DatabaseSync(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function countCookies(db: DatabaseSync): number {
  const row = db.prepare("SELECT count(*) AS n FROM cookies").get() as { n: number };
  return row.n;
}

export function cookieCount(path: string): number {
  try {
    return withSnapshot(path, countCookies);
  } catch {
    return 0;
  }
}

/** Live count of the Paseo store; read-only and does not copy. */
export function paseoCookieCount(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return countCookies(db);
  } finally {
    db.close();
  }
}

const TWO_LEVEL_SUFFIXES = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "ne", "or", "go"]);

/** Groups hosts by site, approximately: `.mail.google.com` → `google.com`, `www.bbc.co.uk` → `bbc.co.uk`. */
export function siteOf(hostKey: string): string {
  const host = hostKey.replace(/^\./, "").toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const last = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const take = last.length === 2 && TWO_LEVEL_SUFFIXES.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function isExpired(row: Row, now: bigint): boolean {
  return Number(row.has_expires) === 1 && BigInt(row.expires_utc as bigint) < now;
}

function readRows(db: DatabaseSync): Row[] {
  const statement = db.prepare("SELECT * FROM cookies");
  statement.setReadBigInts(true);
  return statement.all() as Row[];
}

export function listSites(sourceId: string): Site[] {
  const profile = findProfile(sourceId);
  const now = chromiumNow();
  const counts = new Map<string, number>();
  withSnapshot(profile.cookiesPath, (db) => {
    const statement = db.prepare("SELECT host_key, has_expires, expires_utc FROM cookies");
    statement.setReadBigInts(true);
    for (const row of statement.all() as Row[]) {
      if (isExpired(row, now)) continue;
      const site = siteOf(String(row.host_key));
      counts.set(site, (counts.get(site) ?? 0) + 1);
    }
  });
  return [...counts]
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
}

const keys = new Map<string, Buffer>();

/** Reads the browser's Safe Storage password from the Keychain. macOS asks the user to allow it. */
async function cookieKey(browser: Browser): Promise<Buffer> {
  const cached = keys.get(browser.keychainService);
  if (cached) return cached;
  let password: string;
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", browser.keychainService],
      { timeout: 120_000 },
    );
    password = stdout.replace(/\n$/, "");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 44) {
      throw new Error(`${browser.label} has no "${browser.keychainService}" item in the Keychain.`);
    }
    if (code === 128 || code === 51) {
      throw new Error(`Keychain access to "${browser.keychainService}" was denied.`);
    }
    throw new Error(`Could not read "${browser.keychainService}" from the Keychain.`);
  }
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  keys.set(browser.keychainService, key);
  return key;
}

const IV = Buffer.alloc(16, " ");

/** Decrypts a macOS `v10` cookie. Returns null when the value cannot be decrypted. */
function decrypt(encrypted: Uint8Array, key: Buffer, hostKey: string): string | null {
  const data = Buffer.from(encrypted);
  if (data.subarray(0, 3).toString("latin1") !== "v10") return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    let plain = Buffer.concat([decipher.update(data.subarray(3)), decipher.final()]);
    // Since cookie DB version 24, the plaintext starts with SHA-256 of the host key.
    const hostHash = createHash("sha256").update(hostKey).digest();
    if (plain.length >= 32 && plain.subarray(0, 32).equals(hostHash)) plain = plain.subarray(32);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

interface Column {
  name: string;
  type: string;
}

function defaultFor(column: Column): unknown {
  const type = column.type.toUpperCase();
  if (type.includes("INT")) return 0n;
  if (type.includes("BLOB")) return new Uint8Array(0);
  return "";
}

export interface ImportResult {
  imported: number;
  kept: number;
  failed: number;
}

export async function importCookies(input: {
  sourceId: string;
  sites: string[] | null;
  overwrite: boolean;
}): Promise<ImportResult> {
  const target = findPaseoCookieStore();
  if (!target) {
    throw new Error("The Paseo browser has no cookie store yet. Open a browser tab in Paseo once.");
  }
  const profile = findProfile(input.sourceId);
  const wanted = input.sites ? new Set(input.sites) : null;
  const now = chromiumNow();

  const rows = withSnapshot(profile.cookiesPath, readRows).filter(
    (row) => !isExpired(row, now) && (!wanted || wanted.has(siteOf(String(row.host_key)))),
  );

  // Ask the Keychain only when something is encrypted, and before opening Paseo's store.
  const key = rows.some((row) => (row.encrypted_value as Uint8Array | undefined)?.length)
    ? await cookieKey(profile.browser)
    : null;

  const db = new DatabaseSync(target);
  let imported = 0;
  let kept = 0;
  let failed = 0;
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    const columns = db.prepare("PRAGMA table_info(cookies)").all() as unknown as Column[];
    const names = columns.map((column) => column.name);
    const insert = db.prepare(
      `INSERT OR ${input.overwrite ? "REPLACE" : "IGNORE"} INTO cookies (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const encrypted = row.encrypted_value as Uint8Array | undefined;
        const value =
          encrypted && encrypted.length > 0
            ? decrypt(encrypted, key!, String(row.host_key))
            : String(row.value ?? "");
        if (value === null) {
          failed += 1;
          continue;
        }
        const session = Number(row.is_persistent) !== 1 || Number(row.has_expires) !== 1;
        const values = columns.map((column) => {
          switch (column.name) {
            case "value":
              return value;
            case "encrypted_value":
              // The Paseo browser stores cookies unencrypted.
              return new Uint8Array(0);
            case "is_persistent":
            case "has_expires":
              return session ? 1n : row[column.name];
            case "expires_utc":
              return session ? now + SESSION_COOKIE_LIFETIME_US : row.expires_utc;
            default:
              return column.name in row ? row[column.name] : defaultFor(column);
          }
        });
        const result = insert.run(...(values as never[]));
        if (Number(result.changes) > 0) imported += 1;
        else kept += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
  return { imported, kept, failed };
}
