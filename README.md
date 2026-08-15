# plan-viewer

Browses the plans (`.plan/*.md`) and specs (`*.spec.md`, `*.spec.mdx`) of one selected project
and git worktree.

```bash
bun install
WORKSPACE_ROOT=/path/to/workspace \
EXTRA_PROJECTS=/some/other/repo:/another/repo \
bun src/server.ts
```

Everything lives under `src/`: `src/server.ts` (Bun server + `src/index.html`), `src/render/`
(markdown pipeline), `src/corpus/` (tree model) and `src/app/` (React + Tailwind v4 frontend,
bundled on the fly by Bun via the `src/index.html` import). Use `bun dev` for hot reload.

- `WORKSPACE_ROOT` (required): git repos found under it become projects.
- `EXTRA_PROJECTS` (optional): colon-separated repo paths, always included.
- `PORT` (optional): default `4321`.

Pick a project and a worktree first: `/api/projects` only discovers repos and worktrees, and
documents are listed per worktree by `/api/docs?wt=` — plans from `.plan/`, specs from
`git ls-files -- '*.spec.md' '*.spec.mdx'` (tracked files only). A document is read through
`/api/doc?wt=&path=`, which refuses anything outside that worktree.

View state lives in the URL (`?project=&wt=&tab=&doc=`), so a refresh or a shared link restores
the same view. Live-reloads on changes in the selected worktree (SSE, `/api/events?wt=`).

Three full-height columns, each scrolling on its own:

- **Plans** — project and worktree selectors, `Plans | Specs` tabs, then that worktree's
  documents with their status. Multi-file plans appear once, as their main file. Carries the
  app mark, theme selector and filter.
- **Files / Sections** — the structure of the selected plan: its phase files when it is a
  folder plan, with the open file expanded into its sections. Single-file plans show
  sections directly.
- **The page** — title, status, meters and path live inside the document itself and scroll
  with it; only the 3px status accent stays pinned at the top.

## Plan format

The server parses the format written by the `create-plan` skill
(`~/.claude/skills/create-plan/SKILL.md`, mirroring `writing-spec`):

- YAML frontmatter — `title`, `status`, `author`, `date`, `related`.
- Status vocabulary `draft | ready | in-progress | blocked | done`; anything else renders
  with a dashed neutral chip.
- Progress comes from checkboxes: `## Acceptance criteria` feeds the `AC` meter,
  `## Implementation` feeds the `T` meter. Phases are the `###` headings under
  `## Implementation`.
- Folder plans (`.plan/<slug>/`) treat `index.md` as the only status and checkbox
  authority; sibling files are listed under it as phases and carry no status of their own.
- `PREFIX-NNN` IDs (`G`, `NG`, `AC`, `T`, `KD`, `OQ`, and the spec namespaces) render as
  colored chips; clicking one copies the ID.

Plans predating the format still render: the title falls back to the H1, the status to a
`**Status:**` line, and task counts to `## Steps`. Those are labelled `legacy format` in
the header strip.

## Design

The look follows `phoenix/.claude/spec-ide` — same token names and values (`--bg`,
`--fg`, `--muted`, `--border`, `--accent`, status and xref palettes), the sticky
status accent and metadata strip, and a 96ch article column.

Theme is light / dark / system via `data-theme` on `<html>`, persisted under
`plan-viewer.theme`, with an inline bootstrap in `src/index.html` to avoid a flash.
Fonts prefer locally installed Inter and JetBrains Mono, falling back to the system
stacks — nothing is fetched over the network.
