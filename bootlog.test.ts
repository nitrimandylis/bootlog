import { test, expect } from "bun:test";
import { compose, findRepos, format, parseLog, seedFrom, short, stamps, type Repo } from "./bootlog.ts";

const log =
  "\x014a1b2c3\x1fadd the watch loop\n" +
  " 3 files changed, 812 insertions(+), 13 deletions(-)\n" +
  "\n" +
  "\x01b2c3d4e\x1fmerge branch 'main'\n" +
  "\x01c3d4e5f\x1fdelete the dead config\n" +
  " 1 file changed, 40 deletions(-)\n";

test("a commit keeps its own shortstat", () => {
  const commits = parseLog(log);
  expect(commits.length).toBe(3);
  expect(commits[0]).toEqual({ hash: "4a1b2c3", subject: "add the watch loop", insertions: 812, deletions: 13 });
});

test("a merge commit with no shortstat does not inherit the previous one", () => {
  const commits = parseLog(log);
  expect(commits[1]!.insertions).toBe(0);
  expect(commits[1]!.deletions).toBe(0);
});

test("a deletion-only commit records no insertions", () => {
  const commits = parseLog(log)[2]!;
  expect(commits.insertions).toBe(0);
  expect(commits.deletions).toBe(40);
});

test("a subject containing the separator survives", () => {
  const commits = parseLog("\x01abc1234\x1ffix: parse a\x1fb\n");
  expect(commits[0]!.subject).toBe("fix: parse a\x1fb");
});

test("empty output is no commits, not one blank one", () => {
  expect(parseLog("")).toEqual([]);
});

const tree: Record<string, string[]> = {
  "/root": ["cc", "notes"],
  "/root/cc": ["gridwatch", "kalimera"],
  "/root/cc/gridwatch": ["man"],
  "/root/cc/kalimera": [],
  "/root/notes": [],
};
const repos = new Set(["/root/cc/gridwatch", "/root/cc/kalimera"]);

test("repos are found below the root, and a repo is not descended into", () => {
  const found = findRepos(["/root"], 3, (p) => repos.has(p), (p) => tree[p] ?? []);
  expect(found).toEqual(["/root/cc/gridwatch", "/root/cc/kalimera"]);
});

test("depth is respected", () => {
  expect(findRepos(["/root"], 1, (p) => repos.has(p), (p) => tree[p] ?? [])).toEqual([]);
});

test("a root that is itself a repo is returned", () => {
  expect(findRepos(["/root/cc/kalimera"], 3, (p) => repos.has(p), (p) => tree[p] ?? [])).toEqual([
    "/root/cc/kalimera",
  ]);
});

test("timestamps only ever increase", () => {
  const t = stamps(20260816, 40);
  expect(t.length).toBe(40);
  for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
});

test("the same day always renders the same timings", () => {
  const a = seedFrom(new Date("2026-08-16T06:00:00Z"));
  const b = seedFrom(new Date("2026-08-16T23:00:00Z"));
  expect(stamps(a, 10)).toEqual(stamps(b, 10));
});

const config = { roots: ["~/cc"], depth: 3, author: "", os: "breakOS" };
const busy: Repo = {
  name: "gridwatch",
  path: "/root/cc/gridwatch",
  branch: "main",
  dirty: 2,
  commits: [{ hash: "4a1b2c3", subject: "add the watch loop", insertions: 812, deletions: 13 }],
  insertions: 812,
  deletions: 13,
};
const quiet: Repo = { ...busy, name: "kalimera", path: "/root/cc/kalimera", dirty: 0, commits: [], insertions: 0, deletions: 0 };

test("an active repo is mounted, a quiet one is listed as idle", () => {
  const text = compose([busy, quiet], config, "midnight", new Date("2026-08-16T09:00:00Z"), "mb", "nick")
    .map((l) => l.text)
    .join("\n");
  expect(text).toContain("mount: gridwatch");
  expect(text).toContain("idle: 1 volume saw no writes (kalimera)");
  expect(text).toContain("2 uncommitted files");
  expect(text).toContain("reached target Daily Work (1 commit across 1 repo, +812 -13)");
});

test("a mount path under home is abbreviated, one outside it is not", () => {
  const home = process.env.HOME ?? "";
  expect(short(`${home}/cc/bootlog`)).toBe("~/cc/bootlog");
  expect(short(home)).toBe("~");
  expect(short("/opt/src/bootlog")).toBe("/opt/src/bootlog");
  expect(short(`${home}-backup/cc`)).toBe(`${home}-backup/cc`); // a sibling directory is not home
});

test("a day with no commits says so instead of claiming success quietly", () => {
  const text = compose([quiet], config, "midnight", new Date(), "mb", "nick").map((l) => l.text).join("\n");
  expect(text).toContain("the human is the bottleneck");
});

test("format prefixes every line with a timestamp", () => {
  const lines = format(compose([quiet], config, "midnight", new Date(), "mb", "nick"), 20260816, false);
  for (const line of lines) expect(line).toMatch(/^\[\s*\d+\.\d{6}\] /);
});
