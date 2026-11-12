import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/** The Paseo.app bundle this daemon runs from, or the standard install when run elsewhere. */
function paseoAppPath(): string | null {
  const bundle = /^(.*?\.app)\/Contents\//.exec(process.execPath)?.[1];
  if (bundle && existsSync(bundle)) return bundle;
  return existsSync("/Applications/Paseo.app") ? "/Applications/Paseo.app" : null;
}

/**
 * Quits Paseo and opens it again. Quitting stops this daemon and plugin process, so the work runs
 * in a detached shell: it waits a moment so the RPC can answer, asks the app to quit, waits for the
 * main process to exit, then reopens the app. If the quit is cancelled, it leaves Paseo alone.
 */
const SCRIPT = `
sleep 1
osascript -e "quit app \\"$APP\\"" >/dev/null 2>&1
i=0
while ps -axo comm= | grep -qF "$APP/Contents/MacOS/"; do
  i=$((i + 1))
  [ "$i" -ge 240 ] && exit 0
  sleep 0.5
done
sleep 1
open "$APP"
`;

export function restartPaseo(): void {
  if (process.platform !== "darwin") throw new Error("Restarting Paseo is supported on macOS only.");
  const app = paseoAppPath();
  if (!app) throw new Error("Could not find Paseo.app. Quit and reopen Paseo yourself.");
  const child = spawn("/bin/sh", ["-c", SCRIPT], {
    detached: true,
    stdio: "ignore",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", APP: app },
  });
  child.unref();
  console.log(`Restarting ${app}.`);
}
