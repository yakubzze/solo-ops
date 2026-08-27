# solo-ops

[![CI Status](https://github.com/yakubzze/solo-ops/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yakubzze/solo-ops/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/OS-Linux%20%7C%20macOS%20%7C%20Windows-708090.svg)](#compatibility)

`// one person, many fronts, files you can read`

An issue tracker for someone who is the whole company: two products of their own,
three clients, and every front landing on the same desk. It runs on your machine,
keeps everything in a folder of JSON you can open in a text editor, and has no
account, no server, and no network calls.

If you run one project, almost any todo app is fine. This exists for the case
where four things are live at once and the expensive question is not *what is on
the list* but *which of these am I allowed to forget today*.

> **v0.1 preview.** The interface is stable enough to use daily. The on-disk
> format may still change before v1; it is plain JSON, and any change will come
> with a note in [CHANGELOG.md](CHANGELOG.md).

## What it is shaped around

**Clients are a boundary, not a tag.** Own ventures and client work sit in two
separate groups in the sidebar and never blend into one list. Entering a client
tints the whole interface with that client's colour, so "which context am I in"
is answered before you read a single word.

**One field, not a form.** New issues are typed, not filled in:

```
@acme fix the pricing table !1 ~friday #ship
```

`@` client · `!1`–`!4` priority · `~friday ~tomorrow ~20.08 ~2026-09-04` due date ·
`#` label. Everything else is the title.

**Waiting is a status.** Client work spends most of its life blocked on someone
else. `Waiting` is a first-class column, so those issues stop competing for
attention with the ones you can actually move.

**The keyboard is the interface.** `?` shows every shortcut. `C` creates,
`⌘K` opens the command palette, `J`/`K` move, `S` pushes an issue one column
forward, `1`–`4` set priority, `X` selects and every shortcut then applies to the
whole selection.

## Start here

Requires Node 20.6 or newer. Nothing is installed globally.

```bash
git clone https://github.com/yakubzze/solo-ops.git
cd solo-ops
npm install
npm run serve
```

That builds, starts a server on `http://localhost:4321`, and opens a browser.
In Chrome or Edge you can install it as a PWA to get a real window with no address
bar. For working on the code, `npm run dev` runs the same single process with hot
reload — Vite runs in middleware mode inside the server, so dev and production
share one port.

Another port: `PORT=4322 npm start`.

### Capturing without opening it

The tracker only helps with what reaches it, and reaching it should not mean
being in its window.

```bash
node scripts/capture.mjs "call the accountant about the invoice"
node scripts/capture.mjs -c ACME "they still owe us the brief"
```

Both land in the inbox. Bind the first form to a system-wide shortcut — on
macOS, Shortcuts → *Run Shell Script* — to capture without switching windows.

The text is stored exactly as typed, `@client !1 ~friday` included. The script
does not parse that grammar; it is read in one place, in the app, and a second
reader here would be a second thing to keep in step. `-c` routes to a client,
the rest is triaged in the inbox.

## Where your data lives

```
~/solo-ops/
├── workspace.json        clients, projects, cycles, labels, settings
├── issues/<PREFIX>.json  one file per client
├── trash.json            deleted issues — nothing leaves the disk
└── backups/YYYY-MM-DD/   a full copy, taken before the first write of each day
```

The location is **chosen, never derived from where the code sits**. Move the
checkout, clone it somewhere else, rename a parent folder — the store does not
follow, because nothing reads the checkout path. Copy `config.example.json` to
`config.json` to point it elsewhere:

```json
{ "dataDir": "~/Dropbox/solo-ops", "notesDir": "~/notes" }
```

`SOLO_OPS_DATA_DIR` and `SOLO_OPS_NOTES_DIR` do the same for a single run.

Create that folder once — `mkdir -p ~/Dropbox/solo-ops` — before the first run. A
configured folder that is not on disk stops the app rather than being created: by far
the likeliest reason for one to go missing is that sync has not caught up, or that it
was renamed on your other machine, and seeding an example workspace on top of that is
indistinguishable from your data being gone. Only the default `~/solo-ops` is still
created on demand.

### If you sync the folder, three things will bite you

This is the same list as in [agent-ops](https://github.com/yakubzze/agent-ops),
because it is the same filesystem underneath. Here is what this app does about
each one.

**Your other machine gets silently overwritten.** Two machines, one folder, and
the one whose window has been open since yesterday writes last. Its in-memory
copy is stale and wins anyway. — *The server compares each file's mtime and
content against what it last wrote or read. If they differ, the write is refused
with a 409 and the app loads the newer version instead of clobbering it.*

**Sync leaves a conflict copy and you delete the wrong one.** `workspace 2.json`
looks like a duplicate. Sometimes it is the only remaining copy, because the
original never made it back. — *Conflict artefacts are reported in Settings →
data, with whether the original exists at all. Nothing is ever deleted for you.*

**The path is not the same string on both machines.** A synced cloud folder is
`~/Library/Mobile Documents/…` on macOS and `~/iCloudDrive/…` on Windows, so no
single absolute path is correct on both. — *`config.json` accepts `~/…`, and it
is deliberately not committed, so each machine keeps its own.*

### Two people, one folder

Nothing here assumes a single human. Share the store folder with someone — iCloud,
Dropbox, a network drive — and you both get the same tracker, because the guard
that stops your laptop overwriting your desktop does not care whose desktop it is.
Issues are numbered per client and stored per client, so two people working on
different clients never touch the same file at all.

What you would not get is assignment, comments or permissions. This has not been
run with two people, so treat it as a door left open rather than a finished
feature — and if you try it, say how it went.

There is a fourth one nothing can fix for you: on-demand files. OneDrive Files
On-Demand, iCloud Optimise Storage and Google Drive streaming leave placeholders
that look like real files in a listing and fail on read. Pin the store to
always-keep-local.

## Notes

Point `notesDir` at any folder of Markdown — an Obsidian vault, a plain notes
directory, or an [agent-ops](https://github.com/yakubzze/agent-ops) memory store —
and the tracker stops being an island.

- The **Notes** tab lists whatever is sitting in that folder's inbox, and one
  click turns an entry into an issue with the note still linked. It reads every
  file type, not just `.md`: captures arrive as text files, PDFs and images too,
  and a sweep that only looks at Markdown will tell you the inbox is empty while
  five things sit in it.
- `[[wikilink]]` in an issue description resolves against your notes and opens the
  file. Set `obsidianVault` to your vault name and it becomes an `obsidian://`
  deep link.
- The issue panel can write an issue back out as a note — no date prefix in the
  filename, `*Captured: YYYY-MM-DD*` at the end of the content.

Writes to your notes are limited to creating new files and, on an explicit click,
moving an inbox entry to `_archive`. Nothing is overwritten and nothing is deleted.

## Typeface

[Commit Mono](https://commitmono.com) is bundled in `public/fonts/` rather than
named and hoped for. A font stack that lists a font nobody installed falls back
silently, so the interface would look different on every machine and nothing would
say why. Two weights ship, regular and bold, under the SIL Open Font License 1.1 —
the licence travels with the files.

Everything set in it is small: issue keys, dates, counters, column labels. Ligatures
are switched off there, because `->` in a label should stay two characters.

## Language

English by default. Polish ships in the same build — Settings → data. The choice
lives in `workspace.json`, so it travels with your data rather than with one
browser. Dates go through `Intl`, so the calendar vocabulary follows the language
without a hand-kept list of month names.

Adding a locale is one object in [`src/i18n.ts`](src/i18n.ts) and nothing else.

## How this relates to agent-ops

[agent-ops](https://github.com/yakubzze/agent-ops) is a protocol for keeping an AI
agent's memory alive across machines and sessions. This is a tracker for a person.
They are separate tools, but they were built against the same wall, and two of
that protocol's rules are implemented here for human data:

| agent-ops rule | How solo-ops applies it |
|---|---|
| **1 — choose the location explicitly**, never derive it from where code lives | The store defaults to `~/solo-ops` and is overridden in `config.json`. Nothing reads the checkout path, so moving or cloning the repo cannot orphan your issues. |
| **2 — one working tree, one writer** | Enforced instead of trusted: a write from a stale in-memory copy is refused rather than applied. |
| 3 — exactly one file may go stale | Not applicable. Every field here is current state, and nothing is prose that quietly rots. |

If you use agent-ops, point `notesDir` at your memory store and the tracker will
read `NOW.md` and your notes alongside everything else. That is a convenience, not
a dependency — neither project needs the other installed.

## What this is not

Not a note-taking app — it links to your notes instead of replacing them. Not a
project-management suite: no reports, no estimates, no burndown.

No ranking, no ordering by drag inside a list, no recurring issues, no
dependencies between issues. Those are absent for now rather than on principle;
if one of them stands between you and using this, say so in an issue.

## Files in this repository

| Path | Purpose |
|---|---|
| `server/paths.mjs` | Where data and notes live; the only place that resolves a location |
| `server/store.mjs` | Reads and writes, backups, the stale-write guard, conflict detection |
| `server/notes.mjs` | The bridge to a Markdown folder |
| `server/index.mjs` | HTTP API, static files, the file watcher, Vite in middleware mode |
| `src/store.ts` | Application state and view selectors |
| `src/i18n.ts` | Every user-visible string, in every language |
| `src/hotkeys.ts` | One global key listener |
| `scripts/smoke.mjs` | Renders 11 interface states in Node, plus both languages |
| `scripts/capture.mjs` | Puts a line into the inbox from outside the app |

There are no runtime dependencies beyond React. Markdown, drag and drop, the
command palette and the store are all local code, which is why this has an
`npm install` measured in seconds and nothing that rots on its own.

## Checks

```bash
npm run typecheck   # types
npm run smoke       # every view, panel and overlay mounts; both languages render
npm run integrity   # boots a real server and replays every data-loss failure
npm run undo        # drives a real browser and checks undo in both directions
```

`smoke` renders the app server-side against fixed data, catching hook and render
errors without a browser. `integrity` starts an actual server against a throwaway
store in your temp directory and reproduces each way this program has previously
managed to lose, leak or overwrite a file — a cross-origin write, a client key that
escapes the store, a symlink pointing out of the notes folder, a stale copy
overwriting another machine, a third file with a colliding name. CI runs both.

## Compatibility

| Surface | Tested scope in this preview |
|---|---|
| Node | 20.6+ on Windows; CI covers Ubuntu and macOS |
| Browsers | Current Chrome and Edge. Uses `color-mix()`, so Safari 16.2+ / Firefox 113+ |
| Sync | Written against iCloud Drive's behaviour; the guards are generic and should hold for Dropbox and OneDrive, but that is reasoning, not measurement |
| Notes bridge | Obsidian vaults and plain Markdown folders |

This describes what has been tested, not everything it might happen to work with.

## Why this exists

Tools for tracking work are built for teams, and a team's hard problem is
coordination: who owns what, who is blocked on whom, what the status is for
someone who was not in the room. Running several projects yourself has a different
hard problem. Less of the work waits on someone else, so the cost is context — four
live fronts, one head, and the expensive question is not what is on the list but
which of these is allowed to wait until Thursday.

Everything here follows from that. Clients are a boundary rather than a tag,
because a single blended list makes you re-derive the context every time you look
at it. Waiting is a status, because work for other people spends most of its life
blocked on them and should stop competing for attention while it does. Cycles
create themselves, because a planning ritual that depends on remembering to
perform it will lapse in week three.

The storage rules have the same origin. A tracker for one person is used from
whatever machine that person is sitting at, which means a synced folder, which
means two copies of the truth and a stale window left open since yesterday. Those
are ordinary conditions, not edge cases, so they are handled rather than assumed
away.

This is a one-person project, shared because it might be useful — not one looking
for maintainers. Issues and forks are welcome; pull requests may sit for a while.
Security reports have their own route in [SECURITY.md](SECURITY.md).

Built by [yakubzze](https://gtlr.studio). MIT.
