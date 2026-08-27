# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches v1;
during the preview, the minor version moves when the on-disk format changes.

## [Unreleased]

### Added

- Auto-refresh now has a fallback and a reported state. `fs.watch` follows the
  directory it was armed on, so a folder renamed by a sync client leaves a live
  handle watching nothing and says nothing about it. Watchers are re-armed when
  the directory behind the path changes identity, and every 20 seconds — while a
  browser is listening — the files are compared directly. `SOLO_OPS_WATCH_POLL_MS`
  sets the interval; `0` turns the fallback off. `/api/health` gained `sync`
  (`dataDirPresent`, `watching`, `pollMs`, `lastPollAt`) and Settings → data
  states in a sentence which mechanism is carrying it.
- A data folder that disappears under a running server is now said out loud, on
  load and in Settings. The server holds its state in memory, so until then the
  session looked entirely normal.
- Per-project colour. `Project.color` has been in the type and on disk since
  0.1.0 with nothing reading it. It is now set in Settings → clients (colour
  input per project, `×` clears it back to `null`) and rendered as a 5px dot on
  the sidebar project row and on the project chip in the list. A project with no
  colour renders the previous dash and no dot.
- `scripts/capture.mjs` — writes one issue into the inbox over the HTTP API.
  `-c KEY` picks the client (default: first non-archived `own` client), `-p PORT`
  the port (default 4321, or `SOLO_OPS_PORT`). Title stored verbatim; the
  one-field grammar is not parsed here. `num` is not sent, so the server stays
  the only allocator. Exit codes: 0 written, 1 usage or unknown client, 2 no
  server on that port.
- Days in status on issues with status `waiting`, in the list and on the board.
  Not rendered below 1 day; uses the overdue colour from 7 days.

### Changed

- A configured `dataDir` that does not exist stops the boot instead of being
  created. It almost always means the sync has not caught up, or the folder was
  renamed on the other machine; creating it seeded the example workspace on top
  of that, and the app came up healthy-looking with nobody's data in it. Only the
  default location is still created on demand.
- Conflict artefacts are recognised in both spellings sync clients use:
  `workspace 2.json` (macOS) and `workspace(1).json` (iCloud on Windows). The
  second went unreported entirely, which left an empty canonical file looking
  authoritative while the copy beside it held the other machine's work.
- `stop.command` with no argument now stops every solo-ops server on the machine,
  found through `pgrep -f`, not just the one on the default port. Instances
  started on another port share the same data directory and each keeps its own
  in-memory snapshot, so left running they refuse each other's writes. With a
  port argument it behaves as before.
- The `EADDRINUSE` message no longer suggests starting a second server on
  another port. It says why that is a bad idea instead.
- The project chip was hidden on every `client` view. It is now hidden only when
  a single project is selected; on a client view with no project selected the
  colour dot renders and the name stays hidden.
- `completedAt` and the new `statusChangedAt` derivation moved into one
  `applyStatusChange()` in `server/store.mjs`, used by both `upsertIssue` and
  `updateManyIssues`. The `completedAt` rules were previously duplicated in both.

### Fixed

- Blank interface when an issue was missing `noteLinks`, `checklist` or `labels`.
  IssueList, Board and IssueDetail read `.length` off those three at eight call
  sites with no guard, so one such issue threw during render and left an empty
  page with no error shown. Defaulted in `src/store.ts` on load and reload rather
  than per view.
- `stop.command` did not stop the server while a browser was connected to it.
  `lsof -ti tcp:$PORT` lists connected processes as well as the listener, and the
  loop refused the first non-server PID and exited. Now `-sTCP:LISTEN`.
- `start.command` and `stop.command` are committed with the executable bit set.
- The first delete of every run was refused as "This file changed outside the app
  (trash.json)". `trashIssue` asks `assertNoExternalChange` about `trash.json`
  before anything has read it, and with no snapshot from this process the check
  has to assume the file changed. `init` now reads it once, so the snapshot
  exists from the start. A restart used to re-arm the bug; opening the trash tab
  was what cleared it, which made it look intermittent.
- `restoreFromTrash` checked for external changes after `readTrash()` had already
  refreshed the snapshot, so that guard could never fire. It now checks first.

### On-disk format

- Issues gain `statusChangedAt` (ISO 8601). Set by the server whenever `status`
  differs from the stored value, on every write path. Issues written before this
  have no such field and readers fall back to `createdAt`, which over-reports the
  age until the next status change. No file is rewritten to add it; it appears
  when an issue is next saved. This is the change that moves the minor version.

## [0.1.0] — 2026-08-17

First public preview.

### The tracker

- Clients split into **own ventures** and **client work**, kept apart in the
  sidebar rather than distinguished by a tag. Entering a client tints the whole
  interface with its colour.
- Issues with a readable key (`ACME-42`), seven statuses including a first-class
  **Waiting**, four priorities, due dates, labels, a checklist and a Markdown body.
- Weekly cycles that create themselves, so there is no sprint to remember to open.
- Cycle history: step back through closed weeks and see what got finished and what
  carried over. A closed cycle always shows its finished work, and the "without
  done" toggle hides itself there rather than lying about what is on screen.
- List and board views, grouping by status, priority or client.
- One-field issue entry: `@client`, `!1`–`!4`, `~tomorrow`, `#label`.
- Undo on `⌘Z` / `Ctrl Z`, covering status, priority, dates, trashing, creating and
  moving between clients. A bulk change across a selection is one undo, not ten.
  Undo runs through the same write path as any other change, so it inherits the
  stale-write guard instead of routing around it. Undoing a move returns the issue
  to its client, not to its old number — a move takes the next free number in the
  destination, and coming back takes one again.
- Closing a week: open issues from a past cycle move to the current one in a single
  action — and a single undo.
- Keyboard-first throughout, with a command palette and `?` for the full map.
- Light and dark themes, English and Polish.

### The storage rules

- The store location is chosen, never derived from where the code sits.
- One JSON file per client, so work on one never rewrites another's file.
- A write from a stale in-memory copy is refused with a 409 instead of silently
  overwriting a change made on another machine.
- Sync conflict artefacts (`workspace 2.json`) are reported, never deleted.
- Deletion means moving to `trash.json`; a full backup is taken before the first
  write of each day and kept for 30 days.
- Identical content is not rewritten, which is also what stops the file watcher
  from waking the app in a loop.

### The security boundary

- Mutations require a loopback `Host`, a loopback `Origin` and `application/json`,
  so a page open in your browser cannot write to the tracker behind your back.
- Client keys become filenames, so they are constrained to `A-Z0-9` and must be
  unique case-insensitively — a key like `../../escaped` is refused.
- Note paths are checked after resolution and against `realpath`, so a symlink
  inside the notes folder cannot read or write outside it.
- Static files are served only from `dist`, and malformed percent-encoding returns
  400 rather than taking the server down.
- `npm run integrity` boots a real server against a throwaway store and reproduces
  every one of these, plus the stale-write and file-collision cases.

### The notes bridge

- Reads an inbox of Markdown, text files, PDFs and images — not only `.md`.
- Turns an inbox entry into an issue with the note still linked.
- Resolves `[[wikilink]]` against the notes folder, with optional `obsidian://`
  deep links.
- Writes an issue back out as a note, without a date prefix in the filename.

### Known gaps

No ordering by drag inside a list, no recurring issues, no dependencies between
issues, and no history view for past cycles.
