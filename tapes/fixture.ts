#!/usr/bin/env bun
// Builds the fake HOME the README demo is recorded against:
//
//   bun tapes/fixture.ts     # rebuilds tapes/fixtures/home from scratch
//
// Five throwaway git repos with real commits, so the gif shows a real boot log
// without recording this machine. The generator is committed; the world it
// builds is not (tapes/fixtures/ is gitignored).
//
// Commit times are computed from today, so a re-render a month from now still
// shows a day's work rather than a day of silence.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const HOME = join(import.meta.dir, "fixtures", "home");

type Commit = { at: string; msg: string; file: string; lines: number };
type Repo = { dir: string; branch: string; daysAgo: number; commits: Commit[]; dirty: string[] };

const REPOS: Repo[] = [
  {
    dir: "Developer/starmap",
    branch: "main",
    daysAgo: 0,
    commits: [
      { at: "09:12", msg: "compute the ecliptic instead of guessing it", file: "src/sky.ts", lines: 214 },
      { at: "11:40", msg: "cache the star catalogue between runs", file: "src/catalogue.ts", lines: 96 },
      { at: "14:05", msg: "fix the horizon wrapping past 360 degrees", file: "src/sky.ts", lines: 190 },
      { at: "16:31", msg: "draw constellations as lines, not dots", file: "src/render.ts", lines: 132 },
    ],
    // not *.test.ts: bun test would try to run the fixture's scratch files
    dirty: ["src/render.wip.ts", "notes.md"],
  },
  {
    dir: "Developer/ferrofluid",
    branch: "spikes",
    daysAgo: 0,
    commits: [
      { at: "10:24", msg: "drive the coil from the audio envelope", file: "firmware/coil.c", lines: 148 },
      { at: "13:58", msg: "clamp the duty cycle before the driver melts", file: "firmware/coil.c", lines: 121 },
    ],
    dirty: [],
  },
  {
    dir: "lab/pocketwatch",
    branch: "main",
    daysAgo: 0,
    commits: [{ at: "20:47", msg: "count leap seconds the way the IERS does", file: "leap.py", lines: 73 }],
    dirty: ["leap.py"],
  },
  {
    dir: "Developer/hexdump",
    branch: "main",
    daysAgo: 6,
    commits: [{ at: "15:20", msg: "colour the ascii pane by byte class", file: "dump.rs", lines: 168 }],
    dirty: [],
  },
  {
    dir: "lab/mothlight",
    branch: "main",
    daysAgo: 9,
    commits: [{ at: "22:03", msg: "first light", file: "main.ino", lines: 54 }],
    dirty: [],
  },
];

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}\n${proc.stderr.toString()}`);
  }
}

// Git wants a full timestamp; the tape only cares that today's commits land
// after local midnight and the idle ones do not.
function when(daysAgo: number, at: string): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const [hour, minute] = at.split(":");
  d.setHours(Number(hour), Number(minute), 0, 0);
  return d.toISOString();
}

// Real lines, so --shortstat reports real insertions. Rewriting a file a
// commit later then reports real deletions too.
function body(commit: Commit): string {
  const lines = [];
  for (let i = 0; i < commit.lines; i++) lines.push(`step ${i} :: ${commit.msg}`);
  return lines.join("\n") + "\n";
}

function write(root: string, path: string, text: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

rmSync(HOME, { recursive: true, force: true });

write(
  HOME,
  ".config/bootlog/config.json",
  JSON.stringify({ roots: ["~/Developer", "~/lab"], depth: 3, author: "", os: "breakOS" }, null, 2) + "\n",
);

for (const repo of REPOS) {
  const root = join(HOME, repo.dir);
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", repo.branch, "--quiet"]);
  git(root, ["config", "user.name", "you"]);
  git(root, ["config", "user.email", "you@localhost"]);
  git(root, ["config", "commit.gpgsign", "false"]);

  for (const commit of repo.commits) {
    write(root, commit.file, body(commit));
    const stamp = when(repo.daysAgo, commit.at);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", commit.msg], { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp });
  }

  for (const path of repo.dirty) write(root, path, `scratch :: ${repo.dir}\n`);
}

console.log(`fixture: ${REPOS.length} repos under ${HOME}`);
