---
title: Harness Session Integration
status: amended
author: Antoine Bouteiller
date: 2026-08-15
related: [spec/viewer.spec.md]
---

## 2. Problem Statement

plan-viewer reads the design corpus of the folder a coding agent is working in — the plans it is
executing and the specs it is writing. That folder is already decided by the agent session, so the
viewer asks the reader for nothing: the session starts, a viewer for that folder starts with it and
opens; the last session on that folder ends, the viewer is gone. Coding harnesses differ in how they
expose that lifecycle — pi loads in-process TypeScript extensions and emits `session_start` /
`session_shutdown`, Claude Code and Codex run external commands from a hook manifest — so the
integration is one harness-agnostic launcher plus a thin adapter per harness.

- `[G-1]` The viewer serves exactly the folder its session runs in, with no discovery or selection
  step of any kind.
- `[G-2]` A viewer exists for as long as at least one agent session needs it, and no listening
  process outlives the sessions that asked for it.
- `[G-3]` Harness knowledge lives in adapters over one contract, so pi, Claude Code, Codex, or any
  harness with a session lifecycle integrates without touching the viewer.
- `[G-4]` The reader reaches the viewer without looking for its URL, and the tab they opened keeps
  working across the session churn of `/reload`, `/new`, `/resume` and `/fork`.
- `[G-5]` A viewer runs only for a folder the reader has already trusted with agent execution.

## 3. Key Design Decisions

| Decision                          | Choice                                                                                                                                                                                                                                                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[KD-1]` Root is required         | The server takes one root folder as its single positional argument and exits non-zero when it is missing or not a directory                                                                                                                                                                                                                        | A viewer with no root has nothing to show, and any fallback — scan a workspace, guess the cwd, list projects — reintroduces a selection step `[G-1]` exists to remove                                                                                                                                                                                                                                              |
| `[KD-2.1]` Port persists per root | The OS assigns the port the first time a root is served (`127.0.0.1:0`); it is stored in that root's config entry and requested again on every later start, falling back to a fresh OS-assigned port when it is taken. The server writes one newline-terminated line, `plan-viewer listening on <url>`, to stdout; every diagnostic goes to stderr | Sessions start concurrently and unpredictably, so a fixed or derived port eventually collides and the OS is the only sound arbiter; remembering its answer per root makes the URL stable enough to bookmark and keep in a pinned tab across days, and one parseable line on an otherwise silent stdout is the smallest contract every adapter language can read                                                    |
| `[KD-3]` Launcher is a child      | The launcher spawns the server as a child process and reads its announce line, rather than importing the server                                                                                                                                                                                                                                    | Adapters differ in runtime — pi loads TypeScript in-process, Claude Code and Codex exec a shell command — and a subprocess is the one shape all three share; it also keeps a server crash out of the harness                                                                                                                                                                                                       |
| `[KD-4]` Acquire / release        | The contract is `acquire(root, holder) → { url, release }`; nothing else crosses the boundary                                                                                                                                                                                                                                                      | Every harness lifecycle reduces to "a session needs this folder" and "it no longer does", and naming the holder rather than the process makes sharing and teardown the launcher's business instead of each adapter's                                                                                                                                                                                               |
| `[KD-5.1]` One viewer per root    | One user-level config file holds one entry per root path; a root has at most one server, and `acquire` adopts the entry's live server instead of spawning                                                                                                                                                                                          | Two pi sessions in one project are one project, so a second server would be a second window on the same corpus; `/reload`, `/new`, `/resume` and `/fork` also tear a session down and start another, and a viewer bound to a session lifetime would die under a reader who never left the page — `[G-4]` fails. One file keyed by path is also what makes the port of `[KD-2.1]` outlive the process that chose it |
| `[KD-6.1]` Holders own the server | An entry lists holder process ids; `release` drops one, and a server that claimed an entry exits when no holder is alive, polling its entry on an interval; a server started by hand claims nothing and never self-exits                                                                                                                           | A session-end hook is not guaranteed to run — a killed terminal, a crashed harness, a harness with no end event — so liveness cannot be delegated to a farewell message; polling pids needs no supervisor and covers both graceful and abrupt ends                                                                                                                                                                 |
| `[KD-7]` Open once per viewer     | The adapter opens the browser when `acquire` created the server, never when it adopted one, and a harness command reopens the URL on demand                                                                                                                                                                                                        | Under `[KD-5.1]` the reader's tab survives session churn, so a second tab would be pure noise; the command covers the tab they closed                                                                                                                                                                                                                                                                              |
| `[KD-8]` Trust gates the start    | An adapter acquires only for a root its harness reports as trusted; pi reads `ctx.isProjectTrusted()`                                                                                                                                                                                                                                              | A rendered document may carry raw HTML that executes in the viewer's origin, so starting automatically on any folder an agent opens would execute a stranger's markup; the harness has already asked the reader that exact question                                                                                                                                                                                |
| `[KD-9]` Adapters ship here       | The pi adapter lives in this repo under `extensions/pi/`, discovered as a pi package or a directory extension                                                                                                                                                                                                                                      | The adapter tracks the launcher contract, not the harness release cycle, so colocating removes a cross-repo version pair; pi discovers extensions from a package manifest, so no copy step is needed                                                                                                                                                                                                               |

## 4. Principles & Intents

- `[PI-1]` One folder, one viewer — the root is fixed at start and every path the server resolves
  stays inside it.
- `[PI-2]` The core knows no harness — the launcher names no harness, and each adapter names exactly
  one.
- `[PI-3]` No stray processes — every started server has a defined way to die that does not depend on
  anything running at the right moment.
- `[PI-4]` Quiet start — a session that starts a viewer says so in one line and asks nothing.

## 5. Non-Goals

- `[NG-1]` No workspace scan, project list, or worktree switch: no repo discovery, no
  `/api/projects`, no cross-folder view.
- `[NG-2]` No daemon: sharing is per root and lasts only while a holder lives; nothing is
  pre-started, kept warm, or restarted.
- `[NG-3]` No network exposure and no authentication: loopback only.
- `[NG-4]` No agent surface inside the viewer — it renders the corpus and does not read the
  transcript, show session state, or send anything back to the harness.
- `[NG-5]` No Claude Code or Codex adapter is built here, and no hook manifest, hook input shape, or
  command wiring for them is designed; `[KD-4]` and `[KD-6.1]` are what keep them a small addition.
- `[NG-6]` No process supervision: a server that exits on its own is not restarted.

## 6. Caveats

- `[C-1]` A root that is not a git worktree lists plans only, since the spec corpus is enumerated
  with `git ls-files`.
- `[C-2]` Loopback binding makes the viewer unreachable from another host, which includes a session
  running inside a container or over SSH.
- `[C-3]` The launcher requires `bun` resolvable from the harness environment; a login-shell-only
  PATH makes the acquire fail, and the adapter reports that failure rather than retrying.
- `[C-4]` Opening the browser uses the platform opener (`open`, `xdg-open`, `start`); a headless
  environment has none, and the announced URL remains the fallback.
- `[C-5]` A process id can be reused, so an entry whose holder pid now belongs to an unrelated
  process keeps a viewer alive until the next reader closes it; it costs one idle Bun process.
- `[C-6]` Two roots that differ only by symlink are two entries, since the config is keyed by the
  resolved root path, and a root that is moved or deleted leaves a stale entry behind until it is
  pruned.
- `[C-7]` A viewer serves whatever the root contains at request time, and `[KD-8]` is a start-time
  gate: a session that becomes trusted mid-run gets its viewer on the next session start.
- `[C-8]` A remembered port is a hint, not a reservation: another program can hold it by the next
  start, in which case the viewer moves and the bookmark goes stale `[KD-2.1]`.

## 7. High-Level Components

```text
harness session ──► adapter ──► launcher ──► bun src/server.ts <root>
   start / end      (pi, …)   acquire/release      │
        ▲                          │               └─► "listening on <url>"
        │                          ▼                        │
        └──── url, open ─── viewers.json ◄─── holder pids ─┘
           ($XDG_CONFIG_HOME|~/.config)/plan-viewer/viewers.json
```

| Component       | Module type      | Responsibility                                                                           | Public API surface                                  |
| --------------- | ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Server root     | Bun server entry | Bind one root folder on a requested or OS-assigned port, announce the URL, watch holders | `bun src/server.ts <root> [--port]`                 |
| Launcher        | TS module        | Acquire a viewer for a root — adopt or spawn — and release it                            | `acquire(root, holder) → { url, created, release }` |
| Viewer registry | TS module        | The config file of per-root entries: read, claim, add and drop holders, prune dead ones  | `readEntry`, `updateEntry`                          |
| Pi adapter      | pi extension     | Map pi session events onto the contract, open, announce, expose the command              | `extensions/pi/index.ts`, `/plan-viewer`            |

## 8. Detailed Design

### 8.1 Server root

The server takes the root as its single positional argument, resolves it to a real path, requires a
directory, and exits `1` with a one-line stderr message otherwise `[KD-1]`. It binds `127.0.0.1` on
`--port` when given, retrying on port `0` when that port is taken, and writes one line to stdout
`[KD-2.1]`:

```text
plan-viewer listening on http://127.0.0.1:53421
```

The HTTP surface is rooted at that folder and carries no worktree parameter:

| Route         | Params  | Returns                                    |
| ------------- | ------- | ------------------------------------------ |
| `GET /`       | —       | The app                                    |
| `/api/docs`   | —       | `{ plans, specs }` for the root            |
| `/api/doc`    | `path=` | Rendered HTML for a root-confined document |
| `/api/events` | —       | SSE reload stream for the root             |

Every `path=` is resolved against the root and refused outside it, symlinks included `[PI-1]`.

Every 5 seconds a server whose entry names it as `pid` reads that entry and exits `0` when no listed
holder is alive — a holder is alive when `process.kill(pid, 0)` succeeds or fails with `EPERM`
`[KD-6.1]`. A missing entry or an unreadable config counts as no holders. On exit it clears `pid` and
`holders` from its entry when it still owns it, leaving `port` behind for the next start `[KD-2.1]`.
A server nobody claimed — one started by hand or by `bun run dev` — has no holder to outlive, so it
does not poll and runs until it is stopped.

### 8.2 Viewer registry

One user-level config file, `$XDG_CONFIG_HOME/plan-viewer/viewers.json` — `~/.config` when
`XDG_CONFIG_HOME` is unset — holds one entry per resolved root path `[KD-5.1]`. The location is
harness-agnostic per `[PI-2]`, which a directory under any one harness's config tree would not be:

```ts
type ViewerEntry = { port: number; pid?: number; url?: string; holders: number[] }
type ViewersConfig = { viewers: Record<string, ViewerEntry> } // key: realpath of the root
```

`port` is the durable half of an entry and survives every stop; `pid`, `url` and `holders` describe
the run in progress. Every read-modify-write takes an exclusive lock (`viewers.json.lock`, created
`wx`, stale after 10 seconds), rewrites the whole file, and renames it into place, so concurrent
sessions never interleave. Every read prunes holders that are no longer alive, and an entry whose
`pid` is dead is treated as stopped.

Creation is racy by nature: two sessions may find no running viewer at the same instant, so under the
lock a creator writes its entry with its own pid as the sole holder before spawning, and the loser of
that race waits for the winner's `url` to appear and adopts it.

### 8.3 Launcher

```ts
export type Viewer = { url: string; created: boolean; release: () => Promise<void> }

export function acquire(root: string, holder: number): Promise<Viewer>
```

`acquire` resolves the root, reads its entry, and either adds `holder` to a live viewer and returns
it with `created: false`, or claims the entry and spawns
`bun <server entry> <resolved root> --port <remembered port>` — omitting `--port` when the entry is
new — with the package root as its working directory, stdout piped `[KD-3]`. It reads stdout lines
until the announce line matches, then records `pid`, `url` and the announced `port`, which is the
remembered one unless it was taken `[KD-2.1]`, and returns `created: true`.

It rejects when the child exits first, when the announce line does not arrive within 15 seconds, or
when `bun` is not executable `[C-3]`. Every rejection path kills the child, awaits its exit, and
clears the run fields of the claimed entry, so a failed acquire leaves nothing running `[PI-3]`. The rejection
carries the child's stderr tail as its cause; the launcher itself never opens a browser and never
writes to the harness's output — reporting belongs to the adapter `[PI-2]`.

`release` removes `holder` from the entry and is idempotent. It does not kill anything: the
server's own holder poll `[KD-6.1]` is the single teardown authority, which keeps abrupt and graceful
ends on one path. An adapter that releases while an `acquire` is still in flight awaits it first, so
the holder is never dropped before it is added.

### 8.4 Pi adapter

`extensions/pi/index.ts` exports the default factory pi calls with `ExtensionAPI` and holds one
viewer per pi process, with `process.pid` as its holder id — so every session of one pi process
shares one entry and `/reload`, `/new`, `/resume` and `/fork` change nothing about the running
viewer `[KD-5.1]`.

- `session_start` → when `ctx.isProjectTrusted()` `[KD-8]`, `acquire(ctx.cwd, process.pid)`. On
  `created`, open the URL with the platform opener `[KD-7]`. Announce the URL in one line, whether
  created or adopted `[PI-4]`. An untrusted project or a failed acquire is one announced line and
  never fails the session.
- `session_shutdown` → `release()` only when `event.reason === 'quit'`; the other reasons are the
  same reader continuing in the same process. Pi may re-import the extension across a reload, so the
  in-memory handle is rebuilt from the registry on the next `session_start` rather than assumed.
- `/plan-viewer` → announce and open the current URL; with no viewer it says why (untrusted, or not
  started).

The extension is declared in this repo's `package.json` under `pi.extensions`, and every dependency
the spawned server needs at runtime — including the Tailwind bundling plugin used to serve the app —
is a runtime dependency, so `pi install` from a published or git source yields a working launch
`[KD-9]`.

## 9. Open Questions

None.

## Changelog

| Date       | Amendment                                                                     | Sections affected | Reason                                                                                  |
| ---------- | ----------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| 2026-08-15 | The registry file lives at `$XDG_CONFIG_HOME`, `~/.config` by default         | 7, 8.2            | `[PI-2]`: a path under one harness's config tree would make the launcher that harness's |
| 2026-08-15 | Only a server that claimed an entry polls holders and self-exits (`[KD-6.1]`) | 3, 5, 8.1, 8.3    | A hand-started or `bun run dev` server has no holder and would exit on its first poll   |
