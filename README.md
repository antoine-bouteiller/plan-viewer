# plan-viewer

A local browser for the plans (`.plan/*.md`) and specs (`*.spec.md`, `*.spec.mdx`) across one project's worktrees.

## Run a project

Install this repository's dependencies, then pass the project or worktree root explicitly:

```bash
bun install
bun src/server.ts /path/to/project-or-worktree
```

`bun start` and `bun dev` use the current directory as the root; `bun dev` enables hot reload.
The server prints its loopback URL. To choose a port, pass `--port <number>` after the root;
otherwise the OS chooses an available port.

Use any checkout or worktree as the root. The viewer discovers that Git project's worktrees and
provides a picker between them; it does not discover unrelated repositories. Plans are read from
the selected worktree's `.plan/` directory and specs are its tracked `*.spec.md` and `*.spec.mdx`
files.

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

Start pi in a trusted project or worktree. The extension starts one viewer per Git project and
shows its URL in pi's status; sessions in sibling worktrees share it, and subagent sessions do not
start it. Run `/plan-viewer` to open the viewer in your browser.

## Routes

- `GET /` — the viewer application.
- `GET /api/projects` — the project and its worktrees.
- `GET /api/docs?wt=<worktree>` — plan and spec trees for the selected worktree.
- `GET /api/doc?wt=<worktree>&path=<relative-path>` — a rendered document under that worktree.
- `GET /api/events?wt=<worktree>` — server-sent events for changes below that worktree.
- `GET /assets/mermaid/<file>` — Mermaid JavaScript assets used by rendered diagrams.

Unknown worktrees and document paths outside the selected worktree are rejected.

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
