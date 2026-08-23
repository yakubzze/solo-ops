# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches v1;
during the preview, the minor version moves when the on-disk format changes.

## [Unreleased]

### Added

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
