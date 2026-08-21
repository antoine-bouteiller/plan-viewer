---
title: Document Render Pipeline
status: amended
author: Antoine Bouteiller
date: 2026-08-15
parent-spec: spec/viewer.spec.md
related: []
---

## 2. Problem Statement

This leaf owns umbrella `[G-1]`, `[G-2]` and `[G-5]`: turning one document's source into the page a
reader sees. A spec document mixes CommonMark, GFM tables, MDX components, Mermaid fences, code
fences in a dozen languages, and cross-reference IDs written both bare (`AC-001`) and bracketed
(`` `[KD-3.1]` ``); a plan document uses the same grammar minus MDX. The pipeline resolves all of it
into HTML with a heading outline, serves it over `/api/doc`, and leaves the browser only the work that
needs a layout engine.

Goals are owned by the umbrella.

## 3. Key Design Decisions

| Decision                       | Choice                                                                                                                                                                        | Rationale                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[KD-1]` Module boundary       | The pipeline is a `src/render/` module (`src/render/index.ts` + `src/render/internal/*`) imported by the server; browser code lives in `src/app/`                             | `src/app/` is the bundle: keeping the parser stack outside it is what makes umbrella `[KD-2]` observable, and a barrel with private internals mirrors the reference renderer's layout so ported plugin logic stays legible                           |
| `[KD-2]` Stage order           | `remarkParse → remarkGfm → (remarkMdx → components) → remarkRehype → mermaid → shiki → headingIds → xrefs → rehypeStringify`                                                  | Matches the reference order (`pipeline/internal/mdx.ts:33-47`, `pipeline/internal/markdown.ts:32-41`): components must resolve while the tree is still mdast, and xrefs must run after highlighting so code is never chipified                       |
| `[KD-3]` Degradation           | A parse failure re-renders the same body as plain markdown behind a `.md-degraded` banner; an unsupported component becomes a `.md-unknown` block whose children still render | Umbrella `[PI-2]` and `[KD-3]` in the small: the reader keeps the prose and the diagrams, and the gap is legible exactly where it sits                                                                                                               |
| `[KD-4]` Highlighter lifecycle | One process-wide Shiki highlighter, created at module load with `github-light` and `github-dark`, then synchronous per-fence highlighting                                     | Shiki's async cost is grammar loading, not highlighting, so prewarming once keeps per-request rendering synchronous per umbrella `[PI-4]`, as the reference renderer does (`shiki/internal/highlight.ts:60-64`, `shiki/internal/highlight.ts:83-97`) |
| `[KD-5]` Render cache          | `Map<absPath, { mtimeMs, size, result }>`, invalidated when mtime or size changes, capped at 100 entries in insertion order                                                   | Every file-change tick refetches the open document, and a reader re-opens the same specs repeatedly; mtime keying makes repeats free while staying correct for edits, and the cap bounds memory for a local tool                                     |
| `[KD-6]` Cross-reference chips | IDs render as `<button class="xref-chip" data-kind data-ref>`; one delegated click handler on the article copies `data-ref`                                                   | Markup carries the semantics and CSS carries the palette per family, so the client needs no per-chip wiring — the whole feature is one handler, which is all umbrella `[NG-8.1]` allows                                                              |
| `[KD-7]` Mermaid asset origin  | `GET /assets/mermaid/*` streams from plan-viewer's installed `mermaid` package; the client imports the ESM bundle lazily on the first diagram                                 | Same-origin ESM keeps an offline local tool off a CDN, and lazy import keeps Mermaid's multi-megabyte bundle off documents without diagrams                                                                                                          |

## 4. Principles & Intents

- `[PI-1]` Refines umbrella `[PI-3.2]`: `src/render/` receives a path string and a source string, never a
  filesystem root, so it cannot read anything.
- `[PI-2]` Refines umbrella `[PI-4]`: a render is a pure function of its inputs — no module-level
  mutable state between calls, and no streaming or incremental output.

## 5. Non-Goals

- `[NG-1]` Refines umbrella `[NG-2]`: the render output carries no diagnostics beyond the single
  `.md-degraded` banner of `[KD-3]` — no per-node markers, no line or column reporting.
- `[NG-2]` Refines umbrella `[NG-3]`: MDX attributes are read as literal strings; no attribute
  expression is evaluated.

## 6. Caveats

- `[C-1]` The MDX stage skips `inlineCode` and `code` nodes; see umbrella `[C-2]`.
- `[C-2]` Shiki's dual-theme output uses CSS variables, so the stylesheet maps them onto the
  `data-theme` attribute the theme selector sets rather than `prefers-color-scheme`.
- `[C-3.1]` Project markdown is trusted input: HTML in a document reaches the page unsanitised, so
  trusting a worktree to start the viewer also trusts its Git-enumerated sibling worktrees
  (spec/harness-integration.spec.md `[KD-8]`).

## 7. High-Level Components

Umbrella §7 rows `Render pipeline`, `Doc endpoint` and `Client viewer`.

## 8. Detailed Design

### 8.1 Module layout

```text
src/render/
├── index.ts              # renderDoc, types
└── internal/
    ├── markdown.ts       # unified processor construction (md + mdx variants)
    ├── components.ts     # mdxJsxElement → HTML bridge, dialect names
    ├── shiki.ts          # prewarmed highlighter + rehype bridge
    ├── mermaid.ts        # fence → <pre class="mermaid">
    ├── xrefs.ts          # ID chips
    └── headings.ts       # slug ids + outline collection
```

### 8.2 API surface

```ts
export type TocEntry = { id: string; text: string; depth: number }

export type RenderResult = {
  html: string
  toc: TocEntry[]
  hasMermaid: boolean
  degraded?: { reason: 'mdx-parse'; message: string; line: number }
}

export const renderDoc = (input: { path: string; source: string }) => RenderResult
```

`path` selects the MDX stages (`.mdx` suffix) and seeds the spec stem used for chip titles. `source`
is the document body below its H1 and frontmatter.

### 8.3 Stages

- **Markdown** — `unified().use(remarkParse).use(remarkGfm)`. GFM covers the tables every spec
  section relies on.
- **MDX** — for `.mdx`, `remarkMdx` then the component bridge, which visits `mdxJsxFlowElement` and
  `mdxJsxTextElement`, replaces each with an mdast `html` node, and recurses into children through the
  same processor (`pipeline/internal/components-bridge.ts:77-103`,
  `pipeline/internal/components-bridge.ts:203-230`). Supported names and emitted roots, class names
  matching the reference renderer per umbrella `[PI-5]`:

  | Component        | Children accepted | Root markup                                           |
  | ---------------- | ----------------- | ----------------------------------------------------- |
  | `CodeTabs`       | `CodeTab`         | `.md-codetabs-wrapper` > labelled `.md-codetab-panel` |
  | `Comparison`     | `Option`          | `section.md-comparison` + `.md-comparison-grid`       |
  | `DecisionMatrix` | —                 | `table.md-matrix` with `data-score` cells             |
  | `AnnotatedDiff`  | `MarginNote`      | `figure.md-annotated-diff` + `.md-margin-notes`       |
  | `Flowchart`      | `NodeDetail`      | `.md-flowchart` + `pre.mermaid` + `.md-node-details`  |
  | `StepRail`       | `Step`            | `ol.md-steprail`                                      |

  `CodeTabs` renders every tab as a labelled block rather than hidden panels, since no script switches
  them (umbrella `[NG-8.1]`). Any other capitalised element, `FeatureViewer` included (umbrella
  `[NG-7]`), becomes `<div class="md-unknown" data-component="Name">…children…</div>` per `[KD-3]`.

- **Rehype** — `remarkRehype` and `rehypeStringify`, both with `allowDangerousHtml`, so bridge HTML
  survives stringification.
- **Mermaid** — `mermaid` and `mmd` fences become `<pre class="mermaid">` holding escaped source and
  set `hasMermaid`; `Flowchart` emits the same element.
- **Shiki** — each remaining `<pre><code class="language-x">` becomes dual-theme highlighted output.
  Preloaded languages: `ts`, `tsx`, `js`, `json`, `yaml`, `bash`, `java`, `kotlin`, `sql`, `diff`,
  `md`. An unknown language emits an escaped `<pre><code>`.
- **Headings** — slug IDs from the heading text, de-duplicated with a numeric suffix, collecting depth
  ≤ 3 into `toc` for the structure rail.
- **Xrefs** — bare `PREFIX-NNN` in text and backticked `[PREFIX-N(.N)]` code spans become `.xref-chip`
  buttons per `[KD-6]`, with `data-kind` from the prefix (`g`, `ng`, `ac`, `t`, `kd`, `oq`, else
  `other`) and `data-ref` the bare ID. Content inside `code` and `pre` is untouched.

### 8.4 `/api/doc` contract

```json
{
  "path": "/abs/path",
  "rootPath": "doc/x.spec.mdx",
  "meta": { "title": "…", "status": "accepted", "…": "…" },
  "html": "<h2 id=…>",
  "toc": [{ "id": "problem", "text": "Problem", "depth": 2 }],
  "hasMermaid": true,
  "degraded": null
}
```

The endpoint accepts `wt` plus a worktree-relative path under `.plan/` with a `.md` suffix, or any
`*.spec.md(x)`, `*.discovery.md(x)`, `*.examples.md(x)` inside that worktree (umbrella `[KD-8]`).
It first requires `wt` to belong to the fixed project, then resolves both the path and its realpath
against that worktree per umbrella `[PI-3.2]`. Responses: 403 for an unknown worktree, a path outside
the worktree, or a disallowed suffix; 404 for a missing file; otherwise 200. A render
throw yields a `degraded` document containing the escaped source, never a 500 (umbrella `[PI-2]`).

### 8.5 Client

- The page consumes `html` and `toc` from the response: `html` into the article element, `toc` into
  the structure rail.
- When `hasMermaid`, an effect keyed on the rendered document and the effective theme imports
  `/assets/mermaid/dist/mermaid.esm.min.mjs`, calls
  `initialize({ startOnLoad: false, theme: dark ? "dark" : "default" })`, and runs it over
  `pre.mermaid` inside the article. The effective theme is the `data-theme` attribute when the reader
  pinned a mode and the `prefers-color-scheme` match otherwise; each `pre.mermaid` keeps its source in
  `data-source`, so a theme change or a Mermaid failure restores the fence and re-renders it (umbrella
  `[C-3.1]`).
- One delegated click handler on the article implements `[KD-6]` and is the only in-article behaviour
  (umbrella `[NG-8.1]`).

### 8.6 Dependencies

`unified`, `remark-parse`, `remark-gfm`, `remark-mdx`, `remark-rehype`, `rehype-stringify`,
`unist-util-visit`, `shiki`, `mermaid`.

### 8.7 Error handling

| Failure                  | Behaviour                                                                |
| ------------------------ | ------------------------------------------------------------------------ |
| MDX parse error          | `degraded: { reason: "mdx-parse", … }`, body rendered as markdown        |
| Unsupported component    | `.md-unknown` placeholder, children still rendered                       |
| Unknown fence language   | Escaped `<pre><code>`                                                    |
| Malformed Mermaid source | The `<pre>` text stays visible; Mermaid's own error output is suppressed |
| Highlighter unavailable  | Every fence falls back to escaped `<pre><code>`                          |

## 9. Open Questions

None; see umbrella §9.

## Changelog

| Date       | Amendment                                                            | Sections affected | Reason                                                                                |
| ---------- | -------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| 2026-08-14 | Diagrams track the effective theme                                   | 8.5               | Diagram palette must follow `prefers-color-scheme` and theme switches                 |
| 2026-08-15 | `/api/doc` confines paths to the root folder (`[C-3.1]`, `rootPath`) | 6, 8.4            | Umbrella `[KD-9]`: the session supplies the folder, so there is no worktree parameter |
| 2026-08-21 | `/api/doc` requires an allowlisted `wt` (`[PI-3.2]`)                 | 6, 8.4            | One project viewer can serve multiple worktrees without accepting arbitrary roots     |
