# Security

`solo-ops` reads and writes a folder of your data, and — when you configure one —
reads a folder of your notes and can create files in it. A bug can therefore
expose note contents, overwrite a file, or make the live copy of your issues hard
to find, even when nothing is intentionally deleted.

## Report a vulnerability privately

Please use GitHub's private vulnerability-reporting flow for this repository:

<https://github.com/yakubzze/solo-ops/security/advisories/new>

If that flow is unavailable, open a public issue containing **no exploit, private
path, secret, or real note content**, or email
[`hello@gtlr.studio`](mailto:hello@gtlr.studio). Do not publish a working
destructive case before a fix is available.

Include the operating system, Node version, browser, the exact steps with private
paths replaced, expected result, observed result, and whether the daily backup
under `backups/` still holds a good copy. A minimal synthetic store is ideal.

Only the latest code on the default branch is supported during the v0.1 preview.
There is no guaranteed response time, but reports that can cause data loss, write
outside the configured folders, or execute code are the priority.

## What the app is allowed to touch

By design, and worth verifying if you review the code:

- It binds to `127.0.0.1` only. It is not reachable from your network.
- It makes no outbound network requests. There is no telemetry, no update check,
  and no account.
- Writes to the data folder are limited to `workspace.json`, `issues/*.json`,
  `trash.json` and `backups/`.
- Writes to a configured notes folder are limited to **creating a new file** and,
  on an explicit click, **moving an inbox entry to `_archive`**. Existing files are
  never overwritten; a name collision produces a new name instead.
- Every path from the browser is resolved against the notes root and rejected if it
  escapes it.
- Markdown in issue bodies is escaped before rendering. Raw HTML in a description
  is shown as text, not executed.

## User safety boundary

- Anyone who can reach `localhost:4321` on your machine can read and change
  everything in the store. Do not run it on a shared account or forward the port.
- Treat issue bodies and linked notes as sensitive. Do not put credentials, tokens,
  private keys, or regulated data in them.
- Cloud and sync providers keep additional copies and often retain deleted
  versions. Review visibility, retention and any organisational policy before
  pointing `dataDir` or `notesDir` into one.
- Keep a backup independent of the app itself. `backups/` lives inside the same
  folder as the data it protects, which is enough for a mistake and not enough for
  a lost disk.
- Do not run a fork's server code without reading it. It has read and write access
  to whatever you configure.

The project cannot protect data after you place it in a third-party store or grant
another process access to these folders.
