#!/usr/bin/env node
// bootlog - narrates today's git activity as an operating system boot log.
// Every line is real: the repos are found on disk, the commits come from git.
// Only the framing is fiction.

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { basename, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.2.1";
const CONFIG_DIR = join(homedir(), ".config", "bootlog");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const HELP = `bootlog - your day as a kernel boot log

  bootlog [options]

Options:
      --since EXPR  how far back to look, any git date expression
                    (default: midnight, i.e. today)
      --speed MS    delay between lines when printing to a terminal
                    (default: 25, use 0 for instant)
      --json        print one JSON object on stdout, nothing else
      --no-color    plain text, no ANSI colour
  -h, --help        show this help

Config (created on first run):
  ~/.config/bootlog/config.json   roots to scan, scan depth, author filter, os name

JSON output:
  { generated, since, os, host, user, repos: [...], totals: {...} }
`;

type Config = {
  roots: string[];
  depth: number;
  author: string;
  os: string;
};

const DEFAULT_CONFIG: Config = {
  roots: ["~/Developer", "~/cc", "~/code", "~/src", "~/.dotfiles"],
  depth: 3,
  author: "",
  os: "breakOS",
};

function loadConfig(): { config: Config; created: boolean } {
  if (!existsSync(CONFIG_FILE)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    return { config: DEFAULT_CONFIG, created: true };
  }
  const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
  return { config: { ...DEFAULT_CONFIG, ...raw }, created: false };
}

const expand = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

// ── finding repos ────────────────────────────────────────────────────────────

const SKIP = new Set(["node_modules", ".git", "vendor", "target", "dist", "build", "Library"]);

export function findRepos(roots: string[], depth: number, isRepo: (p: string) => boolean, list: (p: string) => string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string, left: number) => {
    if (isRepo(dir)) {
      found.push(dir);
      return; // a repo's submodules are its own business
    }
    if (left <= 0) return;
    for (const name of list(dir)) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      walk(join(dir, name), left - 1);
    }
  };
  for (const root of roots) walk(root, depth);
  return found;
}

function realIsRepo(p: string): boolean {
  return existsSync(join(p, ".git"));
}

function realList(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return []; // unreadable directory, not a reason to stop booting
  }
}

// ── reading git ──────────────────────────────────────────────────────────────

export type Commit = { hash: string; subject: string; insertions: number; deletions: number };
export type Repo = {
  name: string;
  path: string;
  branch: string;
  dirty: number;
  commits: Commit[];
  insertions: number;
  deletions: number;
};

function git(cwd: string, args: string[]): string {
  // Node caps captured output at 1 MB by default and reports a failure past it,
  // which would turn a long --since into silent empty repos. 64 MB is plenty.
  const proc = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (proc.status !== 0) return "";
  return proc.stdout;
}

// True when an executable called `name` sits in one of the PATH directories.
function onPath(name: string): boolean {
  const dirs = (process.env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile()) return true;
    } catch {
      // not in this directory, try the next one
    }
  }
  return false;
}

const SHORTSTAT = /(\d+) insertion|(\d+) deletion/g;

// `git log --shortstat` prints a marked line per commit followed by an optional
// " 3 files changed, 812 insertions(+), 13 deletions(-)". Merge commits have no
// shortstat line at all, which is why the counters reset per commit rather than
// being read positionally.
export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      const [hash, ...rest] = line.slice(1).split("\x1f");
      commits.push({ hash: hash ?? "", subject: rest.join("\x1f"), insertions: 0, deletions: 0 });
      continue;
    }
    const current = commits[commits.length - 1];
    if (!current || !line.includes("changed")) continue;
    for (const m of line.matchAll(SHORTSTAT)) {
      if (m[1]) current.insertions += Number(m[1]);
      if (m[2]) current.deletions += Number(m[2]);
    }
  }
  return commits;
}

function inspect(path: string, since: string, author: string): Repo {
  const args = ["log", `--since=${since}`, "--shortstat", "--pretty=tformat:\x01%h\x1f%s"];
  if (author) args.push(`--author=${author}`);
  const commits = parseLog(git(path, args));
  const dirty = git(path, ["status", "--porcelain"]).split("\n").filter((l) => l.trim() !== "").length;
  return {
    name: basename(path),
    path,
    branch: git(path, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "detached",
    dirty,
    commits,
    insertions: commits.reduce((n, c) => n + c.insertions, 0),
    deletions: commits.reduce((n, c) => n + c.deletions, 0),
  };
}

// ── the log itself ───────────────────────────────────────────────────────────

export type Line = { level: "ok" | "info" | "warn"; text: string };

// Deterministic per day: the same day renders the same timings, so re-running
// it does not look like different machines booting.
export function seedFrom(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function stamps(seed: number, count: number): number[] {
  let s = seed >>> 0;
  const next = () => {
    // mulberry32, small and good enough to space out log lines
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    t += 0.008 + next() * (i === 0 ? 0.002 : 0.44);
    out.push(t);
  }
  return out;
}

// Display only: the JSON keeps absolute paths. A mount line is long enough
// without spelling out the home directory on every one of them.
export function short(p: string): string {
  const home = process.env.HOME || homedir();
  if (p === home) return "~";
  return p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

export function compose(repos: Repo[], config: Config, since: string, now: Date, host: string, user: string): Line[] {
  const active = repos.filter((r) => r.commits.length > 0);
  const idle = repos.filter((r) => r.commits.length === 0);
  const commits = active.reduce((n, r) => n + r.commits.length, 0);
  const insertions = active.reduce((n, r) => n + r.insertions, 0);
  const deletions = active.reduce((n, r) => n + r.deletions, 0);
  const dirty = repos.filter((r) => r.dirty > 0);

  const lines: Line[] = [];
  lines.push({
    level: "info",
    text: `${config.os} ${VERSION} (${user}@${host}) #${now.getDate()} ${now.toDateString()}`,
  });
  lines.push({ level: "info", text: `Command line: since=${since} roots=${config.roots.length} author=${config.author || "any"}` });
  lines.push({ level: "ok", text: `probe: ${repos.length} ${repos.length === 1 ? "volume" : "volumes"} detected` });

  for (const repo of active) {
    lines.push({ level: "ok", text: `mount: ${repo.name} on ${short(repo.path)} type git (branch ${repo.branch})` });
    lines.push({
      level: "ok",
      text: `${repo.name}: ${repo.commits.length} ${repo.commits.length === 1 ? "commit" : "commits"}, +${repo.insertions} -${repo.deletions}`,
    });
    for (const c of repo.commits) {
      lines.push({ level: "info", text: `  ${c.hash} ${c.subject}` });
    }
  }

  if (idle.length > 0) {
    lines.push({ level: "info", text: `idle: ${idle.length} ${idle.length === 1 ? "volume" : "volumes"} saw no writes (${idle.map((r) => r.name).join(", ")})` });
  }
  for (const repo of dirty) {
    lines.push({ level: "warn", text: `${repo.name}: ${repo.dirty} uncommitted ${repo.dirty === 1 ? "file" : "files"} on ${repo.branch}` });
  }

  if (commits === 0) {
    lines.push({ level: "warn", text: "no writes since the last boot; the disk is fine, the human is the bottleneck" });
  }
  lines.push({
    level: "ok",
    text: `reached target Daily Work (${commits} ${commits === 1 ? "commit" : "commits"} across ${active.length} ${active.length === 1 ? "repo" : "repos"}, +${insertions} -${deletions})`,
  });
  lines.push({ level: "info", text: `login: ${user}` });
  return lines;
}

const COLORS = { ok: "\x1b[32m", info: "\x1b[0m", warn: "\x1b[33m" };

export function format(lines: Line[], seed: number, color: boolean): string[] {
  const times = stamps(seed, lines.length);
  return lines.map((line, i) => {
    const t = (times[i] ?? 0).toFixed(6).padStart(11);
    const stamp = color ? `\x1b[2m[${t}]\x1b[0m` : `[${t}]`;
    const body = color ? `${COLORS[line.level]}${line.text}\x1b[0m` : line.text;
    return `${stamp} ${body}`;
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log(HELP);
    return;
  }

  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: false,
      strict: true,
      options: {
        since: { type: "string", default: "midnight" },
        speed: { type: "string", default: "25" },
        json: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
      },
    }));
  } catch (err) {
    console.error(`bootlog: ${(err as Error).message}`);
    console.error("try: bootlog --help");
    process.exit(1);
  }

  const speed = Number(values.speed);
  if (!Number.isFinite(speed) || speed < 0) {
    console.error("bootlog: --speed must be a number of milliseconds, 0 or more");
    process.exit(1);
  }

  if (!onPath("git")) {
    console.error("bootlog: git is not on PATH, and there is nothing to read without it");
    process.exit(1);
  }

  const { config, created } = loadConfig();
  const roots = config.roots.map(expand).filter((p) => existsSync(p) && statSync(p).isDirectory());
  if (roots.length === 0) {
    console.error(`bootlog: none of the configured roots exist, edit ${CONFIG_FILE}`);
    process.exit(1);
  }

  const now = new Date();
  const repos = findRepos(roots, config.depth, realIsRepo, realList)
    .map((p) => inspect(p, values.since, config.author))
    .sort((a, b) => b.commits.length - a.commits.length || a.name.localeCompare(b.name));

  if (values.json) {
    console.log(
      JSON.stringify({
        generated: now.toISOString(),
        since: values.since,
        os: config.os,
        host: hostname(),
        user: userInfo().username,
        repos,
        totals: {
          repos: repos.length,
          active: repos.filter((r) => r.commits.length > 0).length,
          commits: repos.reduce((n, r) => n + r.commits.length, 0),
          insertions: repos.reduce((n, r) => n + r.insertions, 0),
          deletions: repos.reduce((n, r) => n + r.deletions, 0),
        },
      }),
    );
    return;
  }

  if (created) console.error(`bootlog: wrote ${CONFIG_FILE}`);
  const color = !values["no-color"] && !process.env.NO_COLOR && process.stdout.isTTY === true;
  const lines = format(
    compose(repos, config, values.since, now, hostname(), userInfo().username),
    seedFrom(now),
    color,
  );
  const animate = speed > 0 && process.stdout.isTTY === true;
  for (const line of lines) {
    console.log(line);
    if (animate) await new Promise((r) => setTimeout(r, speed));
  }
}

// Run main only when this file is the program, not when the tests import it.
// Both sides go through realpath because a global install (npm i -g, bun add -g)
// starts the program through a symlink in a bin directory.
function isProgram(): boolean {
  const started = process.argv[1];
  if (!started) return false;
  try {
    return realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isProgram()) {
  main().catch((err) => {
    console.error(`bootlog: ${(err as Error).message}`);
    process.exit(1);
  });
}
