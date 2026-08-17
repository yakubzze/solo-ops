# AGENTS.md

Guidance for anyone — human or agent — working in this repository.

## What this is

A local-first issue tracker for one person running several projects at once. One
Node process serves an HTTP API and, in development, Vite in middleware mode. Data
is a folder of JSON. There are no runtime dependencies beyond React: the Markdown
renderer, drag and drop, the command palette and the store are all local code.

```
server/paths.mjs    the ONLY place that resolves where data or notes live
server/store.mjs    the ONLY place that writes data files
server/notes.mjs    the bridge to a Markdown folder
server/index.mjs    HTTP API, static files, file watcher
src/store.ts        application state and view selectors
src/i18n.ts         the ONLY place a user-visible string is spelled
src/hotkeys.ts      one global key listener
scripts/smoke.mjs   renders every interface state in Node
```

Those three "only" lines are the architecture. Adding a second place that
resolves a path, writes a data file, or spells a string is the change most likely
to be rejected.

## Invariants — do not weaken these without discussion

Each one exists because of a specific failure.

1. **The store location is chosen, never derived from where the code sits.**
   Nothing outside `paths.mjs` may look at the checkout path. Deriving state
   location from code location is how you silently orphan a store the day someone
   moves or clones the repo.

2. **A write from a stale in-memory copy is refused, not applied.** `store.mjs`
   compares mtime and content against what this process last wrote or read, and
   returns 409 instead of overwriting. Two machines on one synced folder is the
   normal case, not the exotic one.

3. **Nothing is deleted on a user's behalf.** Deleting an issue moves it to
   `trash.json`. Sync conflict artefacts (`workspace 2.json`) are reported and
   never removed — that suffixed copy is sometimes the only surviving one.

4. **A note is never overwritten.** Writing to the notes folder creates a new file;
   a name collision produces a new name. The only other write is moving an inbox
   entry to `_archive`, and only on an explicit click.

5. **Identical content is not rewritten.** This is not only an optimisation: the
   file watcher reacts to writes, so a pointless write makes the app wake itself,
   reload, write again, and loop. That bug shipped once.

6. **Every user-visible string goes through `t()`, in both languages.** English is
   the default; a key missing from the Polish dictionary is a type error.

7. **Binding to loopback is not a boundary.** A page in the browser can still POST
   to localhost. Mutations require a loopback `Host`, a loopback `Origin` and a JSON
   content type. Anything reaching the filesystem — a client key, a notes path, a
   static file — is validated after resolution, not by inspecting the raw string.

## Checks

```bash
npm run build        # REQUIRED before undo: the browser gets dist, not src
npm run typecheck
npm run smoke        # renders 11 interface states plus both languages, in Node
npm run integrity    # boots a server on a throwaway store, replays every past failure
npm run undo         # drives a real browser through every undoable action
```

`smoke` compiles from source, so it sees an edit immediately. `undo` does not: it
starts the server the ordinary way, and the ordinary way serves `dist`. Running it
on a stale build tests the previous version of your change and reports success —
which is worse than reporting nothing. Build first.

`smoke` is the cheap test that catches hook and render mistakes without a browser.
If you add a view or an overlay, add it there. `integrity` is the one that matters
when touching `server/`: each case in it is a real failure that shipped once, so a
change which makes one of them pass by disabling the mechanism is not a fix.
Verify both directions — that the guard refuses what it should, and that ordinary
writes still succeed.

Look at the result in a browser before claiming a UI change works. Neither check
knows what anything looks like.

## Conventions

- Comments explain **why**, especially where a line looks redundant. Several here
  are load-bearing and would be "cleaned up" by anyone who did not know the story.
- Prose in the interface is plain and specific. Errors say what happened and what
  to do; empty states invite an action rather than apologising.
- Dates go through `Intl`. Do not add hand-kept month names.
- No new runtime dependency without a reason that survives the question "what
  breaks if this package is abandoned in a year".

## Related

[agent-ops](https://github.com/yakubzze/agent-ops) is the protocol these storage
rules come from — invariants 1 and 2 here are its rules 1 and 2, applied to a
person's data instead of an agent's memory. If you keep memory for an agent
working in this repository, follow that protocol: choose the location explicitly
rather than letting it default to something derived from this checkout's path.
