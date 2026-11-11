import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { HISTORY_LENGTH, SAMPLE_INTERVAL_MS, type HostInfo, type Sample } from "../shared/stats";

const run = promisify(execFile);

type CpuTimes = { idle: number; total: number };
type NetCounters = { rx: number; tx: number; at: number };

function cpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

/** Memory in use the way Activity Monitor and `free` count it: excludes reclaimable cache. */
async function memory(): Promise<{ memory: Sample["memory"]; swap: Sample["swap"] }> {
  const total = os.totalmem();
  if (process.platform === "darwin") {
    try {
      const [{ stdout: vm }, { stdout: swap }] = await Promise.all([
        run("vm_stat"),
        run("sysctl", ["-n", "vm.swapusage"]),
      ]);
      const pageSize = Number(/page size of (\d+)/.exec(vm)?.[1] ?? 4096);
      const pages = (label: string) =>
        Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0) * pageSize;
      // App memory + wired + compressed, as in Activity Monitor's "Memory Used".
      const used =
        pages("Anonymous pages") -
        pages("Pages purgeable") +
        pages("Pages wired down") +
        pages("Pages occupied by compressor");
      const mb = (key: string) => Number(new RegExp(`${key} = ([\\d.]+)M`).exec(swap)?.[1] ?? 0) * 1024 ** 2;
      return {
        memory: { used: Math.min(Math.max(used, 0), total), total },
        swap: { used: mb("used"), total: mb("total") },
      };
    } catch {
      // Fall through to the portable estimate.
    }
  }
  if (process.platform === "linux") {
    try {
      const info = await readFile("/proc/meminfo", "utf8");
      const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(info)?.[1] ?? 0) * 1024;
      const available = kb("MemAvailable") || kb("MemFree");
      return {
        memory: { used: total - available, total },
        swap: { used: kb("SwapTotal") - kb("SwapFree"), total: kb("SwapTotal") },
      };
    } catch {
      // Fall through.
    }
  }
  return { memory: { used: total - os.freemem(), total }, swap: null };
}

const SKIPPED_INTERFACES = /^(lo|utun|gif|stf|awdl|llw|anpi|bridge|docker|veth|virbr|tun|tap)/;

/** Cumulative bytes received and sent across physical interfaces. */
async function netCounters(): Promise<NetCounters | null> {
  const at = Date.now();
  try {
    if (process.platform === "darwin") {
      const { stdout } = await run("netstat", ["-ibn"]);
      let rx = 0;
      let tx = 0;
      for (const line of stdout.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        // One <Link#n> row per interface carries its byte counters.
        if (cols.length < 10 || !cols[2]?.startsWith("<Link#")) continue;
        const name = cols[0]!.replace(/\*$/, "");
        if (SKIPPED_INTERFACES.test(name)) continue;
        // Rows without an address have one fewer column.
        const offset = cols.length >= 11 ? 0 : -1;
        rx += Number(cols[6 + offset]) || 0;
        tx += Number(cols[9 + offset]) || 0;
      }
      return { rx, tx, at };
    }
    if (process.platform === "linux") {
      const text = await readFile("/proc/net/dev", "utf8");
      let rx = 0;
      let tx = 0;
      for (const line of text.split("\n").slice(2)) {
        const [name, rest] = line.split(":");
        if (!name || !rest || SKIPPED_INTERFACES.test(name.trim())) continue;
        const cols = rest.trim().split(/\s+/);
        rx += Number(cols[0]) || 0;
        tx += Number(cols[8]) || 0;
      }
      return { rx, tx, at };
    }
  } catch {
    // Unavailable; report null.
  }
  return null;
}

async function disk(): Promise<Sample["disk"]> {
  // On macOS "/" is the sealed system snapshot; user data lives on the Data volume.
  const path = process.platform === "darwin" ? "/System/Volumes/Data" : process.platform === "win32" ? "C:\\" : "/";
  try {
    const s = await statfs(path);
    const total = s.blocks * s.bsize;
    return { used: total - s.bavail * s.bsize, total, path };
  } catch {
    return null;
  }
}

export function hostInfo(): HostInfo {
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpuModel: os.cpus()[0]?.model.trim() ?? "Unknown CPU",
    uptime: os.uptime(),
  };
}

type Listener = (sample: Sample) => void;

/** Samples only while at least one client listens, and shares samples between them. */
export class Sampler {
  readonly history: Sample[] = [];
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Bumped by stop() so a reading still in flight does not schedule another. */
  private generation = 0;
  private prevCpu: CpuTimes | null = null;
  private prevNet: NetCounters | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (!this.running) {
      this.running = true;
      void this.tick(this.generation);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.generation += 1;
    this.listeners.clear();
    // Drop history and deltas so a later subscriber does not see a gap stitched together.
    this.history.length = 0;
    this.prevCpu = null;
    this.prevNet = null;
  }

  private async tick(generation: number): Promise<void> {
    try {
      const sample = await this.sample();
      if (generation !== this.generation) return;
      if (sample) {
        this.history.push(sample);
        if (this.history.length > HISTORY_LENGTH) this.history.shift();
        for (const listener of this.listeners) listener(sample);
      }
    } catch (error) {
      console.error("system-monitor: sampling failed", error);
    }
    if (generation !== this.generation) return;
    if (this.listeners.size === 0) {
      this.running = false;
      return;
    }
    this.timer = setTimeout(() => void this.tick(generation), SAMPLE_INTERVAL_MS);
  }

  /** Null on the first call, which only primes the CPU and network deltas. */
  private async sample(): Promise<Sample | null> {
    const cpuNow = cpuTimes();
    const [mem, netNow, diskNow] = await Promise.all([memory(), netCounters(), disk()]);
    const prevCpu = this.prevCpu;
    const prevNet = this.prevNet;
    this.prevCpu = cpuNow;
    this.prevNet = netNow;
    if (!prevCpu) {
      // Prime quickly so the first real sample arrives without a full interval.
      await new Promise((resolve) => setTimeout(resolve, 500));
      return this.sample();
    }
    const total = cpuNow.total - prevCpu.total;
    const idle = cpuNow.idle - prevCpu.idle;
    const cpu = total > 0 ? Math.min(100, Math.max(0, (1 - idle / total) * 100)) : 0;

    let network: Sample["network"] = null;
    if (netNow && prevNet) {
      const seconds = Math.max((netNow.at - prevNet.at) / 1000, 0.001);
      network = {
        rx: Math.max(0, (netNow.rx - prevNet.rx) / seconds),
        tx: Math.max(0, (netNow.tx - prevNet.tx) / seconds),
      };
    }
    const [l1, l5, l15] = os.loadavg();
    return {
      at: Date.now(),
      cpu,
      cores: os.cpus().length,
      load: [l1 ?? 0, l5 ?? 0, l15 ?? 0],
      memory: mem.memory,
      swap: mem.swap,
      network,
      disk: diskNow,
    };
  }
}
