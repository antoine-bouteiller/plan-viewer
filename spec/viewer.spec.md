---
title: Plan Viewer Document Rendering & Corpus Navigation
kind: umbrella
status: amended
author: Antoine Bouteiller
date: 2026-08-15
related: [spec/harness-integration.spec.md]
---

## 2. Problem Statement

plan-viewer browses the design corpus of the one folder it is started on: implementation plans under
`.plan/` and specs colocated with the code they describe. That folder is given at start-up — an agent
session supplies its own working directory (spec/harness-integration.spec.md) — so the viewer never
discovers or selects one. That corpus is authored in a richer dialect
than plain CommonMark — MDX documents carrying a small set of structural components, Mermaid
diagrams, highlighted code fences, and cross-reference IDs — and it is large and nested: a repo like
phoenix holds ~250 spec documents across dozens of directories, linked into umbrella trees by
`parent-spec`. A reader needs those documents rendered faithfully and reachable in a few clicks,
against any repo, without that repo installing tooling of its own.

- `[G-1]` Render every listed document, `.md` and `.mdx` alike, reproducing the spec dialect's
  component structures, with any unsupported construct visible in place rather than blanking the page.
- `[G-2]` Render Mermaid fences as diagrams and code fences with syntax highlighting.
- `[G-3]` Present plans and specs as a collapsible folder tree that also reflects `parent-spec`
  umbrella nesting.
- `[G-4.1]` Stay repo-agnostic: a folder needs no renderer, config file, or build step of its own for
  its documents to render.
- `[G-5]` Serve plan documents and spec documents through one viewer: same status badges, AC/T
  meters, phase structure, cross-reference chips, and live reload for both.

## 3. Key Design Decisions

| Decision                      | Choice                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[KD-1]` Renderer ownership   | plan-viewer owns its rendering pipeline (unified/remark/rehype), reproducing the spec dialect rather than calling a renderer vendored in a repo | A vendored renderer is reachable only from the repo that carries it, with its own dependencies and consumer config, so every other folder would render nothing — `[G-4.1]` fails. Owning the pipeline costs its plugin logic once and pins its own dependencies              |
| `[KD-2]` Render location      | The Bun server renders; `/api/doc` returns HTML plus a heading outline                                                                          | Shiki's grammars and the remark/MDX stack are megabytes of parser, which would dominate a browser bundle for a local tool; the server already reads and confines the file, so rendering there costs no extra I/O and permits an mtime-keyed cache                            |
| `[KD-3]` Dialect failure mode | An unknown component, JSX expression, or parse error renders as a visible placeholder inside the document                                       | A viewer's contract is to show the document. Authoring feedback belongs to the authoring tool, which validates a fixed component allowlist (`dialect/internal/allowlist.ts:8-26`, `dialect/internal/scan.ts:36-135`) and fails the render (`pipeline/internal/mdx.ts:49-56`) |
| `[KD-4]` Mermaid              | Diagrams render client-side by `mermaid.run()` over `<pre class="mermaid">`, from plan-viewer's own `mermaid` dependency                        | Mermaid needs a layout engine; server-side rendering requires jsdom and still yields degraded SVG, which is why the reference renderer resolves diagrams in the browser too (`pipeline/internal/render.ts:70-78`)                                                            |
| `[KD-5]` Tree shape           | Filesystem directories form the tree's backbone; `parent-spec` nests specs within their directory                                               | A doc's path is its identity in a code repo, and specs sit beside the code they describe, so `libs/java/…/spec` versus `doc/architecture/specs` is the reader's first discriminator. Umbrella links layer logical structure on top of that                                   |
| `[KD-6]` Styling              | Rendered HTML is styled with plan-viewer's own CSS tokens and light/dark themes                                                                 | plan-viewer owns a themed design system driven by a theme selector; a second generated token set (`theme/internal/css.ts`) would collide with it and force every colour decision twice                                                                                       |
| `[KD-7]` One pipeline         | Plan documents and spec documents render through the same pipeline, with `.mdx` adding stages                                                   | Two renderers give one markdown construct two behaviours and double every fix; the dialect pipeline is a superset of what plans need                                                                                                                                         |
| `[KD-8]` Corpus scope         | The corpus is `.plan/**/*.md`, `*.spec.md(x)`, and `*.discovery.md(x)` / `*.examples.md(x)`; feature sidecars are out                           | Discovery and example documents are prose this pipeline already renders and part of the same design record; `*.feature.json` is progress tracking, which is the authoring tool's surface, not a viewer's (`[NG-7]`)                                                          |
| `[KD-9]` One root             | The corpus is the server's root folder, fixed at start-up; there is no project, workspace, or worktree dimension anywhere in the model          | A session already decided which folder matters, so a selector asks the reader to re-answer a settled question, and the extra dimension propagates into every route, URL key, cache key and sidebar control                                                                   |

## 4. Principles & Intents

- `[PI-1]` One pipeline — every listed document takes the same render path; `.mdx` adds stages, never
  a second renderer.
- `[PI-2]` Never blank — a readable file always produces a page, with degradation visible where it
  occurs.
- `[PI-3.1]` Confined reads — every path is resolved against the root folder and refused outside it,
  symlinks included; rendering widens nothing.
- `[PI-4]` Warm, then synchronous — per-request rendering awaits nothing beyond a process-wide
  prewarmed highlighter.
- `[PI-5]` Parity by structure — the same input yields the same element structure and class names as
  the reference renderer, so its visual conventions are reproducible under `[KD-6]`.

## 5. Non-Goals

- `[NG-1]` No authoring: no editing, creation, or writes of any kind.
- `[NG-2]` No linting surface: no error panels, line/column diagnostics, or authoring hints.
- `[NG-3]` No JSX evaluation: `import`/`export`, expressions, and a React runtime for MDX are outside
  the dialect.
- `[NG-4]` No consumer configuration: no per-repo config file, corpus warnings, or feature
  dashboards; the viewer's behaviour is the same in every folder.
- `[NG-5]` No server-side Mermaid SVG.
- `[NG-6]` No full-text search; navigation is the tree plus a title and path filter.
- `[NG-7]` No feature-sidecar reading and no `FeatureViewer` component; it degrades per `[KD-3]`.
- `[NG-8.1]` No in-article interactivity beyond copying a cross-reference ID: no tab switching and no
  per-fence copy buttons.
- `[NG-9]` No workspace scan and no selection surface: no project discovery, no `/api/projects`, no
  worktree switch, no cross-folder view.

## 6. Caveats

- `[C-1]` Shiki prewarming loads grammars and two themes at boot, so the first render waits on it and
  start-up costs a few hundred milliseconds.
- `[C-2]` Specs contain many capitalised `<…>` sequences that are generic type parameters inside code
  spans and fences (for example `List<String>` in
  `doc/architecture/specs/authoring-context-surface/corpus-search.spec.mdx:286`), not components, so
  the MDX stage leaves code content untouched.
- `[C-3.1]` A diagram follows the active palette: the effective theme is `data-theme` when the reader
  pinned one and `prefers-color-scheme` otherwise, and open diagrams re-render from their cached
  source when it changes.
- `[C-4]` Parity is structural, not pixel-exact: `[KD-6]` re-expresses the component families
  (`.md-*`) in plan-viewer tokens, so colours and spacing differ from the reference renderer.
- `[C-5]` A rendered spec is tens of kilobytes of HTML per open, which `[KD-2]` puts on the wire.

## 7. High-Level Components

```text
root folder files ──► corpus scan (server) ──► tree model ──► sidebar tree (client)
       │                                       ▲
       └──► /api/doc ──► render pipeline ───────┘
                          (md | mdx ─► components ─► shiki ─► xrefs ─► headings)
                                    │
                                    └─► html + toc ──► <article> + mermaid.run() (client)
```

| Component       | Module type       | Responsibility                                                               | Public API surface                                   |
| --------------- | ----------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| Render pipeline | Bun/TS module     | Markdown/MDX → HTML, outline, highlighting, Mermaid placeholders, xrefs      | `renderDoc({ path, source })` → `{ html, toc, … }`   |
| Doc endpoint    | Bun server route  | Serve rendered HTML plus metadata for one root-confined path                 | `GET /api/doc`                                       |
| Client viewer   | React + assets    | Inject HTML, run Mermaid, copy cross-reference IDs                           | `<article className="article">`, `/assets/mermaid/*` |
| Corpus tree     | Bun server module | Build the folder + umbrella tree from plans, specs, discovery and examples   | `GET /api/docs` returning tree nodes                 |
| Sidebar tree UI | React component   | Collapsible tree navigation with status chips and current-document highlight | `<DocTree>`                                          |

Leaf execution order:

| Leaf              | Depends on                 | Rationale                                                                 |
| ----------------- | -------------------------- | ------------------------------------------------------------------------- |
| `document-render` | —                          | Owns the pipeline and the `/api/doc` contract every other surface reads   |
| `corpus-tree`     | `document-render` `[KD-2]` | Reuses the pipeline's frontmatter parsing for `kind` / `parent-spec` data |

## 8. Detailed Design

Detailed design lives in the leaves; the umbrella owns `[KD-1]`–`[KD-9]` and `[PI-1]`–`[PI-5]`.

| Leaf                                               | Covers                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [document-render.spec.md](document-render.spec.md) | Pipeline stages, MDX dialect, Shiki, Mermaid, `/api/doc`, client bootstrap |
| [corpus-tree.spec.md](corpus-tree.spec.md)         | Corpus scan, tree model, `/api/docs`, sidebar tree UI                      |

## 9. Open Questions

None.

## Changelog

| Date       | Amendment                                                                                    | Sections affected | Reason                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| 2026-08-14 | Diagrams follow the effective theme                                                          | 5, 6              | `system` theme mode left diagrams in the light palette on a dark page                               |
| 2026-08-15 | The corpus is one root folder, given at start-up (`[KD-9]`, `[NG-9]`, `[G-4.1]`, `[PI-3.1]`) | 2, 3, 4, 5, 7, 8  | A session supplies the folder, so workspace scan and worktree selection answered a settled question |
