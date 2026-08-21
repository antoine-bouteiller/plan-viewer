---
title: Harness Session Integration
status: amended
author: Antoine Bouteiller
date: 2026-08-15
related: [spec/viewer.spec.md]
---

## 2. Problem Statement

plan-viewer reads the design corpus of the Git project a coding agent is working in — the plans it
is executing and the specs it is writing across that project's worktrees. The session identifies the
project; the reader selects the worktree inside one shared viewer. The first session in any worktree
starts that project viewer, and the last session in the project releases it. Coding harnesses differ
in how they expose that lifecycle — pi loads in-process TypeScript extensions and emits
`session_start` / `session_shutdown`, Claude Code and Codex run external commands from a hook manifest
— so the integration is one harness-agnostic launcher plus a thin adapter per harness.

- `[G-1]` The viewer serves exactly one Git project and lets the reader select among its worktrees,
  without scanning for unrelated projects.
- `[G-2]` A viewer exists for as long as at least one agent session needs it, and no listening
  process outlives the sessions that asked for it.
- `[G-3]` Harness knowledge lives in adapters over one contract, so pi, Claude Code, Codex, or any
  harness with a session lifecycle integrates without touching the viewer.
- `[G-4]` The reader sees the viewer URL in persistent session status and can open it explicitly;
  an open tab keeps working across the session churn of `/reload`, `/new`, `/resume` and `/fork`.
- `[G-5]` A viewer runs only for a project the reader has trusted through an agent session; that
  trust covers its Git-enumerated sibling worktrees.

## 3. Key Design Decisions

| Decision                             | Choice                                                                                                                                                                                                                                                                                                                                                       | Rationale                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[KD-1]` Root is required            | The server takes one project worktree as its single positional argument, derives the Git common directory, and exits non-zero when the argument is missing or not a directory                                                                                                                                                                                | A worktree gives the server both the trusted initial folder and enough Git metadata to enumerate only sibling worktrees; no workspace scan is needed                                                                                                                                                                                                               |
| `[KD-2.1]` Port persists per project | The OS assigns the port the first time a project is served (`127.0.0.1:0`); it is stored under the Git common-directory key and requested again on every later start, falling back to a fresh OS-assigned port when it is taken. The server writes one newline-terminated line, `plan-viewer listening on <url>`, to stdout; every diagnostic goes to stderr | Sessions start concurrently and unpredictably, so a fixed or derived port eventually collides and the OS is the only sound arbiter; remembering its answer per project makes the URL stable enough to bookmark and keep in a pinned tab across days, and one parseable line on an otherwise silent stdout is the smallest contract every adapter language can read |
| `[KD-3]` Launcher is a child         | The launcher spawns the server as a child process and reads its announce line, rather than importing the server                                                                                                                                                                                                                                              | Adapters differ in runtime — pi loads TypeScript in-process, Claude Code and Codex exec a shell command — and a subprocess is the one shape all three share; it also keeps a server crash out of the harness                                                                                                                                                       |
| `[KD-4]` Acquire / release           | The contract is `acquire(root, holder) → { url, release }`; nothing else crosses the boundary                                                                                                                                                                                                                                                                | Every harness lifecycle reduces to "a session needs this folder" and "it no longer does", and naming the holder rather than the process makes sharing and teardown the launcher's business instead of each adapter's                                                                                                                                               |
| `[KD-5.2]` One viewer per project    | One user-level config file holds one entry per Git common directory; `acquire` from any worktree adopts that project's live server instead of spawning                                                                                                                                                                                                       | Worktrees are views of one project, so separate servers produce duplicate tabs and ports; the common Git directory is their stable shared identity and lets the port of `[KD-2.1]` outlive the process that chose it                                                                                                                                               |
| `[KD-6.1]` Holders own the server    | An entry lists holder process ids; `release` drops one, and a server that claimed an entry exits when no holder is alive, polling its entry on an interval; a server started by hand claims nothing and never self-exits                                                                                                                                     | A session-end hook is not guaranteed to run — a killed terminal, a crashed harness, a harness with no end event — so liveness cannot be delegated to a farewell message; polling pids needs no supervisor and covers both graceful and abrupt ends                                                                                                                 |
| `[KD-7]` Explicit browser open       | Starting a session only publishes the URL as pi status; `/plan-viewer` invokes the platform opener on demand                                                                                                                                                                                                                                                 | Automatic browser tabs interrupt the reader, while persistent status keeps the address available and the command provides a deliberate open action                                                                                                                                                                                                                 |
| `[KD-8]` Trust gates the start       | An adapter acquires only from a worktree its harness reports as trusted; pi reads `ctx.isProjectTrusted()`, and that grant applies to the worktree's Git project                                                                                                                                                                                             | A rendered document may carry raw HTML that executes in the viewer's origin, so automatic startup requires the harness's trust decision; project-level trust is necessary because the viewer intentionally exposes sibling worktrees                                                                                                                               |
| `[KD-9]` Adapters ship here          | The pi adapter lives in this repo under `extensions/pi/`, discovered as a pi package or a directory extension                                                                                                                                                                                                                                                | The adapter tracks the launcher contract, not the harness release cycle, so colocating removes a cross-repo version pair; pi discovers extensions from a package manifest, so no copy step is needed                                                                                                                                                               |

## 4. Principles & Intents

- `[PI-1]` One project, one viewer — the project is fixed at start; only Git-enumerated worktrees
  can be selected, and every document path stays inside the selected worktree.
- `[PI-2]` The core knows no harness — the launcher names no harness, and each adapter names exactly
  one.
- `[PI-3]` No stray processes — every started server has a defined way to die that does not depend on
  anything running at the right moment.
- `[PI-4]` Quiet start — a session exposes its viewer URL as status without adding transcript output or opening a browser.

## 5. Non-Goals

- `[NG-1]` No workspace scan or cross-project selection: `/api/projects` exposes only the server's
  project and its Git-enumerated worktrees.
- `[NG-2]` No daemon: sharing is per project and lasts only while a holder lives; nothing is
  pre-started, kept warm, or restarted.
- `[NG-3]` No network exposure and no authentication: loopback only.
- `[NG-4]` No agent surface inside the viewer — it renders the corpus and does not read the
  transcript, show session state, or send anything back to the harness.
- `[NG-5]` No Claude Code or Codex adapter is built here, and no hook manifest, hook input shape, or
  command wiring for them is designed; `[KD-4]` and `[KD-6.1]` are what keep them a small addition.
- `[NG-6]` No process supervision: a server that exits on its own is not restarted.

## 6. Caveats

- `[C-1]` A root that is not a Git worktree is treated as a one-worktree project and lists plans
  only, since the spec corpus is enumerated with `git ls-files`.
- `[C-2]` Loopback binding makes the viewer unreachable from another host, which includes a session
  running inside a container or over SSH.
- `[C-3]` The launcher requires `bun` resolvable from the harness environment; a login-shell-only
  PATH makes the acquire fail, and the adapter reports that failure rather than retrying.
- `[C-4]` `/plan-viewer` uses the platform opener (`open`, `xdg-open`, `explorer.exe`); in a
  headless environment the status URL remains available to open elsewhere.
- `[C-5]` A process id can be reused, so an entry whose holder pid now belongs to an unrelated
  process keeps a viewer alive until the next reader closes it; it costs one idle Bun process.
- `[C-6]` A project that is moved or deleted leaves a stale common-directory entry behind until it
  is pruned.
- `[C-7]` A viewer serves whatever the selected worktree contains at request time, and `[KD-8]` is a start-time
  gate: a session that becomes trusted mid-run gets its viewer on the next session start.
- `[C-8]` A remembered port is a hint, not a reservation: another program can hold it by the next
  start, in which case the viewer moves and the bookmark goes stale `[KD-2.1]`.

## 7. High-Level Components

```text
harness session ──► adapter ──► launcher ──► bun src/server.ts <root>
   start / end      (pi, …)   acquire/release      │
        ▲                          │               └─► "listening on <url>"
        │                          ▼                        │
        └── url, status ─── viewers.json ◄── holder pids ─┘
           ($XDG_CONFIG_HOME|~/.config)/plan-viewer/viewers.json
```

| Component       | Module type      | Responsibility                                                                             | Public API surface                                  |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Project server  | Bun server entry | Bind one project, enumerate its worktrees, announce the URL, and watch holders             | `bun src/server.ts <root> [--port]`                 |
| Launcher        | TS module        | Acquire a viewer for a root's project — adopt or spawn — and release it                    | `acquire(root, holder) → { url, created, release }` |
| Viewer registry | TS module        | The config file of per-project entries: read, claim, add and drop holders, prune dead ones | `readEntry`, `updateEntry`                          |
| Pi adapter      | pi extension     | Map pi session events onto the contract, publish status, expose the open command           | `extensions/pi/index.ts`, `/plan-viewer`            |

## 8. Detailed Design

### 8.1 Project server

The server takes one worktree root as its positional argument, resolves its Git common directory,
enumerates that project's worktrees, and exits `1` with a one-line stderr message when the root is
missing or invalid `[KD-1]`. It binds `127.0.0.1` on
`--port` when given, retrying on port `0` when that port is taken, and writes one line to stdout
`[KD-2.1]`:

```text
plan-viewer listening on http://127.0.0.1:53421
```

The HTTP surface exposes that one project and requires a selected worktree for corpus routes:

| Route           | Params         | Returns                                                 |
| --------------- | -------------- | ------------------------------------------------------- |
| `GET /`         | —              | The app                                                 |
| `/api/projects` | —              | The project and its Git-enumerated worktrees            |
| `/api/docs`     | `wt=`          | `{ plans, specs }` for the selected worktree            |
| `/api/doc`      | `wt=`, `path=` | Rendered HTML for a selected-worktree-confined document |
| `/api/events`   | `wt=`          | SSE reload stream for the selected worktree             |

An unknown `wt=` is refused. Every `path=` is resolved against the selected worktree and refused
outside it, symlinks included `[PI-1]`. The client stores `wt` in the URL, defaults to the main
worktree, and clears the open document when the selection changes.

Every 5 seconds a server whose entry names it as `pid` reads that entry and exits `0` when no listed
holder is alive — a holder is alive when `process.kill(pid, 0)` succeeds or fails with `EPERM`
`[KD-6.1]`. A missing entry or an unreadable config counts as no holders. On exit it clears `pid` and
`holders` from its entry when it still owns it, leaving `port` behind for the next start `[KD-2.1]`.
A server nobody claimed — one started by hand or by `bun run dev` — has no holder to outlive, so it
does not poll and runs until it is stopped.

### 8.2 Viewer registry

One user-level config file, `$XDG_CONFIG_HOME/plan-viewer/viewers.json` — `~/.config` when
`XDG_CONFIG_HOME` is unset — holds one entry per resolved Git common directory `[KD-5.2]`. The location is
harness-agnostic per `[PI-2]`, which a directory under any one harness's config tree would not be:

```ts
type ViewerEntry = { port: number; pid?: number; url?: string; holders: number[] }
type ViewersConfig = { viewers: Record<string, ViewerEntry> } // key: realpath of the Git common directory
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

`acquire` resolves the root and its Git common directory, reads the project entry, and either adds
`holder` to a live viewer and returns it with `created: false`, or claims the entry and spawns
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

`extensions/pi/index.ts` exports the default factory pi calls with `ExtensionAPI`. It does not
register when `PI_SUBAGENT_OWNER_TOKEN` is present, which is how `antoine-bouteiller/pi-extension`
identifies child agents. Otherwise it holds one viewer per pi process, with `process.pid` as its
holder id. Concurrent pi processes in one project therefore contribute distinct holders, and the
server exits only after all of them have quit. `/reload`, `/new`, `/resume` and `/fork` change
nothing about the running viewer `[KD-5.2]`.

- `session_start` → when `ctx.isProjectTrusted()` `[KD-8]`, `acquire(ctx.cwd, process.pid)` and set
  the persistent `plan-viewer` status to its URL, whether created or adopted `[PI-4]`. It does not
  open a browser. An untrusted project or failed acquire emits one informational notification and
  never fails the session.
- `session_shutdown` → `release()` only when `event.reason === 'quit'`; the other reasons are the
  same reader continuing in the same process. Pi may re-import the extension across a reload, so the
  in-memory handle is rebuilt from the registry on the next `session_start` rather than assumed.
- `/plan-viewer` → refresh the URL status and open it; with no viewer it says why (untrusted, or not
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
| 2026-08-21 | One viewer per Git project with a worktree picker (`[KD-5.2]`, `[PI-1]`)      | 2–8               | Worktrees share project identity but retain distinct corpora                            |
| 2026-08-21 | Pi startup publishes status without opening; subagents skip the integration   | 2–8               | Keep startup unobtrusive and prevent delegated child sessions from acquiring viewers    |
