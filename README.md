# plan-viewer

A local browser for the plans (`.plan/*.md`) and specs (`*.spec.md`, `*.spec.mdx`) in one project root or worktree.

## Run a project or worktree

Install this repository's dependencies, then pass the project or worktree root explicitly:

```bash
bun install
bun src/server.ts /path/to/project-or-worktree
```

`bun start` and `bun dev` use the current directory as the root; `bun dev` enables hot reload.
The server prints its loopback URL. To choose a port, pass `--port <number>` after the root;
otherwise the OS chooses an available port.

Use a checkout or worktree as the root. Plans are read from its `.plan/` directory and specs are
its tracked `*.spec.md` and `*.spec.mdx` files. The viewer does not discover sibling repositories
or worktrees.

## Use with pi

This repository declares a pi extension. With pi installed, install it straight from the
repository:

```bash
pi install git:github.com/antoine-bouteiller/plan-viewer
```

Or install a local checkout by absolute path (or a path relative to the directory where the command
is run):

```bash
pi install /path/to/plan-viewer
```

Start pi in a trusted project or worktree. The extension starts a viewer for pi's current working
directory and announces its URL. Run `/plan-viewer` in that session to open the announced viewer
again.

## Routes

- `GET /` — the viewer application.
- `GET /api/docs` — plan and spec trees for the supplied root.
- `GET /api/doc?path=<relative-path>` — a rendered document under that root.
- `GET /api/events` — server-sent events for changes below that root.
- `GET /assets/mermaid/<file>` — Mermaid JavaScript assets used by rendered diagrams.

Document paths outside the selected root are rejected.

## Plan format

The server parses the format written by the `create-plan` skill:

- YAML frontmatter — `title`, `status`, `author`, `date`, `related`.
- Status vocabulary `draft | ready | in-progress | blocked | done`; other values render as neutral.
- `## Acceptance criteria` supplies the AC meter and `## Implementation` supplies the task meter.
  `###` headings under Implementation are phases.
- Folder plans use `.plan/<slug>/index.md` as the status and checkbox authority; sibling files are
  phases.

Older plans still render: title falls back to the H1, status to a `**Status:**` line, and task
counts to `## Steps`.
