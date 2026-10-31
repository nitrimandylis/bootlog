# bootlog

## What it is

A command that reads today's git activity across your repositories and prints it
as an operating system boot log. Mounted volumes for repos with commits, idle
ones named, uncommitted files as warnings, a target line with the totals.

## Who it is for

Anyone who ends a day unsure what they actually did. It is a log, not a
dashboard: it prints once and exits.

## Decisions

- **Every line is real.** The framing is fiction, the facts are not. A day with
  no commits prints a line saying so. The moment it invents activity it stops
  being a record and becomes a screensaver, and there is already a screensaver.
- **Timestamps are seeded from the date.** They are the only fabricated thing in
  the output, and they are deterministic so that re-running on the same day gives
  the same log rather than looking like a different machine. A boot log without a
  timestamp column is a bulleted list.
- **The filesystem is injected into `findRepos`.** It takes "is this a repo" and
  "list this directory" as functions, which is what makes the walk testable
  without building a fake directory tree on disk.
- **A repo is not descended into.** Submodules and vendored checkouts belong to
  their parent; walking into them turns one project into six volumes.
- **Merge commits report 0 and 0.** `git log --shortstat` prints nothing for
  them, so the parser resets per commit instead of reading positionally. Reading
  positionally is the bug that silently doubles a day's insertions.
- **Roots that do not exist are skipped, not an error.** The defaults name five
  common code directories so the tool does something on a machine that is not
  mine. All five missing is the error, and it names the config file.
- **No network, no cache, no state beyond the config file.** git is the database.
- **Shipped to npm from 0.2.0, as `@nitrimandylis/bootlog`.** The shipped code
  uses Node APIs only (`node:child_process` for git, a PATH scan instead of
  `Bun.which`, a realpath check instead of `import.meta.main`), so it runs under
  plain Node 22+ via `npx`. Bun stays the toolchain: `bun build` bundles
  `dist/bootlog.js`, `bun test` runs the tests, `bun run compile` still builds a
  local binary.
- **Releases go through a GitHub release.** `publish.yml` publishes with OIDC
  trusted publishing, no token in the repo. 0.2.0 is published by hand, because
  npm cannot attach a trusted publisher to a package that does not exist yet.

## Not doing

- **A daily summary emailed or pushed anywhere.** It prints to a terminal.
- **Language or diff analysis.** Insertions and deletions are what git gives for
  free; anything deeper means parsing diffs, which is a different tool.
- **Non-git work.** Notion edits, documents, and thinking are invisible to it,
  and that limitation belongs in the README rather than in a heuristic.

## Status

Built 2026-08-16. Ported to Node and packaged for npm 2026-10-31 (0.2.0).
