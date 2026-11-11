import { execFile } from "node:child_process";

// The daemon may not inherit the login shell PATH, so include common gh locations.
const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
  .filter(Boolean)
  .join(":");

export function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, env: { ...process.env, PATH, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" }, maxBuffer: 20 * 1024 * 1024, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
