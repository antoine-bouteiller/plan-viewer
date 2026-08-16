---
title: Corpus Tree Navigation
status: amended
author: Antoine Bouteiller
date: 2026-08-15
parent-spec: spec/viewer.spec.md
related: []
---

## 2. Problem Statement

This leaf owns umbrella `[G-3]` and the navigation half of `[G-5]`: getting a reader from the
server's root folder to one of a few hundred documents. Those documents carry two overlapping structures — the
directory layout that puts a spec beside the code it describes, and the `parent-spec` graph that binds
umbrellas to their leaves — plus companion discovery and example documents sharing a spec's stem, and
plan folders whose `index.md` owns the status of its phase files. The sidebar renders all of it as one
tree, and the server decides its shape.

Goals are owned by the umbrella.

## 3. Key Design Decisions

| Decision                                                 | Choice                                                                                                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[KD-1]` Tree built server-side                          | `/api/docs` returns nested nodes; the client renders what it receives                                                                                                                                                                                               | The server parses each document's frontmatter for title, status, `kind` and `parent-spec` anyway, so nesting there keeps one definition of the tree and leaves the client a renderer                                                                                                                   |
| `[KD-2.1]` Directory rows are real rows in the spec tree | In the specs tab every path segment is a node, so the tree reads as the repo's layout rather than a purely logical graph (`convention-inference/internal/sidebar.ts:1-18`); the plans tab is flat, one row per plan                                                 | Refines umbrella `[KD-5]`: a spec's location is what a reader recognises first, and it is the only structure every corpus has, umbrella links or not. `.plan/` is one authored folder of plans whose subdirectories only group a plan index with its phases, so its layout carries nothing to navigate |
| `[KD-3.2]` Umbrella owns a folder it fully explains      | A directory renders as its umbrella's row, labelled with that spec's title, only when it holds no subdirectory and every other document in it resolves to that umbrella through `parent-spec`; otherwise it stays a folder row with the umbrella as a row inside it | One umbrella that accounts for everything beside it _is_ that folder's meaning, and two rows for one concept costs a click; a subdirectory or an unlinked sibling means the folder holds documents the umbrella does not own, and absorbing it would file them under a design they are not part of     |
| `[KD-4]` Compact single-child chains                     | A directory whose only child is another directory renders as one row with a joined label (`doc/architecture/specs`)                                                                                                                                                 | Spec paths nest three to five levels deep with no choice to make at the intermediate levels, so collapsing them removes clicks while the full path stays visible in the label                                                                                                                          |
| `[KD-5]` `parent-spec` nests in place                    | A spec whose `parent-spec` resolves to another listed document becomes its child; an unresolvable link leaves the spec where its path puts it                                                                                                                       | Shows the umbrella graph without letting a stale or cross-repo link make a document unreachable — umbrella `[PI-2]` applied to navigation                                                                                                                                                              |
| `[KD-6.1]` Expansion is derived state                    | Ancestors of the open document are expanded, the rest start collapsed, and toggles live in component state                                                                                                                                                          | The URL already identifies tab and document, and re-deriving ancestors from that restores the useful part of the view, so persisting toggles adds state without adding recall                                                                                                                          |
| `[KD-7]` Filter flattens                                 | A non-empty filter renders matches as a flat list labelled with each document's path                                                                                                                                                                                | Filtering is a search affordance; keeping matches inside the tree hides the answer behind expanders                                                                                                                                                                                                    |
| `[KD-8]` Companions by stem                              | `<stem>.discovery.md(x)` and `<stem>.examples.md(x)` are children of `<stem>.spec.md(x)` when it is listed, otherwise normal rows in their directory                                                                                                                | The shared stem is the authored link between a spec and its companions (the reference sidebar synthesises the same relation, `convention-inference/internal/sidebar.ts:15-18`), and the fallback keeps orphans reachable                                                                               |

## 4. Principles & Intents

- `[PI-1.1]` Refines umbrella `[PI-3.1]`: discovery lists tracked files with `git ls-files` inside the
  root folder, so it cannot follow a link out of it.

## 5. Non-Goals

- `[NG-1]` Refines umbrella `[NG-1]`: the tree offers no drag, reorder, rename, or any other mutation.
- `[NG-2.1]` Refines umbrella `[NG-4]` and `[NG-9]`: the tree is scoped to the server's root folder —
  it carries no project or worktree selector and no cross-folder view — and renders its rows directly,
  without virtualisation.

## 6. Caveats

- `[C-1]` `git ls-files` omits untracked files, so a newly written spec appears once it is added to
  the index.
- `[C-2]` Statuses the corpus uses beyond the plan set (`archived`, `implementing`, `converging`) need
  their own tones in the stylesheet; an unmapped value renders as a dashed `unknown` chip.
- `[C-3]` Expansion state is per session under `[KD-6.1]` and resets on reload.

## 7. High-Level Components

Umbrella §7 rows `Corpus tree` and `Sidebar tree UI`.

## 8. Detailed Design

### 8.1 Wire model

```ts
export type DocNode = {
  name: string // row label: directory segment(s) or document title
  path?: string // root-relative file path; absent for a directory with no umbrella
  kind: 'dir' | 'plan' | 'phase' | 'umbrella' | 'leaf' | 'discovery' | 'examples'
  status?: string
  archived?: boolean
  tasks?: Counts
  acceptance?: Counts
  children?: DocNode[]
}
```

`/api/docs` returns `{ plans: DocNode[], specs: DocNode[] }`, one tree per tab. `tasks` and
`acceptance` carry the AC/T meter counts for plan documents.

### 8.2 Build steps (server)

1. **List** — `.plan/**/*.md` by directory walk, and
   `git ls-files -- *.spec.md *.spec.mdx *.discovery.md *.discovery.mdx *.examples.md *.examples.mdx`
   for the spec corpus.
2. **Read metadata** — per document, frontmatter `title`, `status`, `kind`, `parent-spec`, `archived`,
   plus the acceptance and implementation checkbox counts.
3. **Nest by path** — split each root-relative path on `/` and insert directory nodes.
4. **Attach umbrellas** — in a directory with no subdirectory whose other documents all resolve to it
   through `parent-spec` (companions of `[KD-8]` counting as their spec's), the single document with
   `kind: umbrella` moves onto the directory node and lends it its title per `[KD-3.2]`; with two such
   documents the first by path wins and the other stays a normal row. A `.plan/` folder's `index.md`
   attaches the same way, keeping the folder label and leaving its phase files as children.
5. **Attach companions** — discovery and examples documents move under their stem's spec per `[KD-8]`,
   ordered examples then discovery.
6. **Apply `parent-spec`** — re-parent documents whose link resolves to another listed document,
   skipping any move that would make a node its own ancestor (`[KD-5]`).
7. **Compact** — join directory chains with a single directory child per `[KD-4]`. The plans tree instead
   drops every directory row, hoisting its documents to the top level, and a plan index takes its own
   title as label per `[KD-2.1]`.
8. **Sort** — directories before documents, then by label case-insensitively; a spec before its
   companions; phase files in file order; archived documents last within their parent.

### 8.3 Sidebar UI

The sidebar holds the plans/specs tabs and a recursive `DocTree`:

- A row is one click target: a folder row toggles expansion, a document row opens the document, and the
  chevron is the only nested control. Rows share the tree row styling, current-row highlight, and status
  chip used across the app.
- A document row never expands. A document holding members — umbrella leaves under `[KD-5]`, companions
  under `[KD-8]`, plan phases — is one row in the tree, highlighted as current whenever any member is
  open, and the structure rail beside the article lists that family: the owning document first, then its
  members, stopping at a member that owns a family of its own so a nested umbrella contributes one row
  rather than its whole subtree. A document whose nearest owner is a plain directory has no family, so
  the rail shows the document's section outline instead.
- Indentation by depth, children in a `<ul role="group">`, `aria-expanded` on the toggle and
  `aria-current="page"` on the open document.
- Keyboard: `ArrowRight` / `ArrowLeft` expand and collapse, `ArrowUp` / `ArrowDown` move between
  visible rows, `Enter` opens.
- An archived document shows an `archived` status chip.
- A non-empty filter switches to the flat list of `[KD-7]`.

### 8.4 Live reload

The server watches `.plan/` recursively plus every directory containing a listed document and pushes a
reload event over SSE. A reload event refetches `/api/docs`, which re-runs discovery, so a new
document or directory shows up on the next event; the open document refetches with it.

## 9. Open Questions

None; see umbrella §9.

## Changelog

| Date       | Amendment                                                              | Sections affected | Reason                                                                                    |
| ---------- | ---------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| 2026-08-14 | Umbrella absorbs only a leaf directory, and takes its title as label   | 3, 8.2            | A folder with subdirectories pulled their specs into the umbrella's family                |
| 2026-08-14 | Document rows are flat rows; families are listed in the structure rail | 8.3               | Specs with members rendered as folder-looking expanders and duplicated navigation         |
| 2026-08-14 | The whole row is the click target                                      | 8.3               | Only the label was clickable, and folders needed a chevron hit                            |
| 2026-08-14 | The plans tree is flat                                                 | 3, 8.2            | `.plan/` subdirectories only group a plan index with its phases, which is already one row |
| 2026-08-15 | Root-scoped tree, no selectors (`[NG-2.1]`, `[KD-6.1]`, `[PI-1.1]`)    | 2, 3, 4, 5, 8     | Umbrella `[KD-9]`: the session supplies the folder                                        |
| 2026-08-15 | Absorption requires every sibling to link to the umbrella (`[KD-3.2]`) | 3, 8.2            | A standalone spec beside an umbrella rendered as one of its leaves                        |
