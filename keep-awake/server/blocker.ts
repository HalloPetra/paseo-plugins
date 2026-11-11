import { spawn, type ChildProcess } from "node:child_process";

export interface BlockerOptions {
  display: boolean;
  system: boolean;
}

export const SUPPORTED = process.platform === "darwin" || process.platform === "linux" || process.platform === "win32";

/**
 * The command that holds a sleep assertion for as long as it runs. Each one also watches this
 * plugin process and exits with it, so a crashed or killed plugin never leaves the host awake.
 */
function command({ display, system }: BlockerOptions): [string, string[]] | null {
  const pid = String(process.pid);
  switch (process.platform) {
    case "darwin": {
      // -i idle sleep, -d display sleep, -s system sleep (AC power only), -w exit with pid.
      const flags = ["-i", ...(display ? ["-d"] : []), ...(system ? ["-s"] : [])];
      return ["caffeinate", [...flags, "-w", pid]];
    }
    case "linux": {
      const what = ["idle", "sleep", ...(system ? ["handle-lid-switch"] : [])].join(":");
      return [
        "systemd-inhibit",
        [
          `--what=${what}`,
          "--who=Paseo",
          "--why=Agents are running",
          "--mode=block",
          "tail",
          `--pid=${pid}`,
          "-f",
          "/dev/null",
        ],
      ];
    }
    case "win32": {
      // ES_CONTINUOUS | ES_SYSTEM_REQUIRED, plus ES_DISPLAY_REQUIRED. Held until this shell exits.
      const flags = display ? "0x80000003" : "0x80000001";
      const script = [
        "$s = Add-Type -PassThru -Name P -Namespace KeepAwake -MemberDefinition",
        "'[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';",
        `[void]$s::SetThreadExecutionState([uint32]${flags});`,
        `Wait-Process -Id ${pid}`,
      ].join(" ");
      return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]];
    }
    default:
      return null;
  }
}

/** Holds at most one sleep assertion, through a child process. */
export class SleepBlocker {
  private child: ChildProcess | null = null;
  private key: string | null = null;
  error: string | null = null;

  constructor(private readonly onChange: () => void) {}

  get holding(): boolean {
    return this.child !== null;
  }

  hold(options: BlockerOptions): void {
    const key = `${options.display}:${options.system}`;
    if (this.child && this.key === key) return;
    // A blocker that failed with these options stays failed until the options change or it is
    // released, so a missing binary does not respawn on every agent update.
    if (!this.child && this.key === key && this.error) return;
    this.stop();
    this.key = key;
    const cmd = command(options);
    if (!cmd) {
      this.error = `Keeping the host awake is not supported on ${process.platform}`;
      this.onChange();
      return;
    }
    const [file, args] = cmd;
    this.error = null;
    const child = spawn(file, args, { stdio: "ignore", windowsHide: true });
    this.child = child;
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.error = `Could not start ${file}: ${error.message}`;
      console.error(this.error);
      this.onChange();
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.error = `${file} exited unexpectedly (${signal ?? `code ${code}`})`;
      console.error(this.error);
      this.onChange();
    });
    console.log(`Holding sleep assertion: ${file} ${args.join(" ")}`);
    this.onChange();
  }

  release(): void {
    const had = this.child !== null || this.error !== null;
    this.stop();
    this.key = null;
    this.error = null;
    if (had) {
      console.log("Released sleep assertion");
      this.onChange();
    }
  }

  private stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
