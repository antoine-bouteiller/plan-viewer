import { useEffect, useMemo, useRef, useState } from 'react'

import { PlanList } from '@/components/plan-list'
import { PlanStructure } from '@/components/plan-structure'
import { ThemeSelector } from '@/components/theme-selector'
import { CopyChip } from '@/components/ui/copy-chip'
import { LoadingIcon, SearchIcon } from '@/components/ui/icons'
import { Meter } from '@/components/ui/meter'
import { StatusBadge } from '@/components/ui/status-badge'
import { ratio, statusToken, statusTone, type Counts, type Doc, type DocNode, type Docs, type Tab } from '@/lib/plan'
import { useUrlState } from '@/lib/url-state'
import { cn } from '@/lib/utils'

interface DocsState {
  docs: Docs
  error: string | null
}

interface DocState {
  key: string
  doc: Doc | null
  error: string | null
}

const NO_DOCS: Docs = { plans: [], specs: [] }

const failed = (response: Response) => Promise.reject(new Error(`${response.status} ${response.statusText}`))

const prefersDark = () => globalThis.matchMedia('(prefers-color-scheme: dark)')

const accentColor = (status: string | undefined) => (statusToken(status) === 'unknown' ? 'var(--border)' : statusTone(status))

const isDarkTheme = () => {
  const mode = document.documentElement.dataset.theme
  return mode ? mode === 'dark' : prefersDark().matches
}

const matchingDocuments = (nodes: DocNode[], needle: string): DocNode[] =>
  nodes.flatMap((node) => [
    ...(node.path && (node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)) ? [node] : []),
    ...matchingDocuments(node.children ?? [], needle),
  ])

const findNode = (node: DocNode, path: string | null): DocNode | null => {
  if (node.path === path) {
    return node
  }
  return node.children?.map((child) => findNode(child, path)).find(Boolean) ?? null
}

const onArticleClick = (event: React.MouseEvent<HTMLElement>, onOpenDoc: (path: string) => void) => {
  const target = event.target as HTMLElement
  const link = target.closest<HTMLAnchorElement>('a[data-doc]')
  if (link?.dataset.doc) {
    event.preventDefault()
    onOpenDoc(link.dataset.doc)
    return
  }

  const chip = target.closest<HTMLElement>('.xref-chip')
  if (!chip?.dataset.ref) {
    return
  }
  void navigator.clipboard.writeText(chip.dataset.ref).then(() => {
    chip.dataset.copied = 'true'
    setTimeout(() => delete chip.dataset.copied, 1200)
  })
}

const useDocs = (reloads: number) => {
  const [loaded, setLoaded] = useState<DocsState | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/docs')
      .then((response) => (response.ok ? response.json() : failed(response)))
      .then((data: Docs) => {
        if (alive) {
          setLoaded({ docs: data, error: null })
        }
      })
      .catch((error: Error) => {
        if (alive) {
          setLoaded({ docs: NO_DOCS, error: error.message })
        }
      })
    return () => {
      alive = false
    }
  }, [reloads])

  return { docs: loaded?.docs ?? NO_DOCS, error: loaded?.error ?? null }
}

const useDoc = (active: string | null, reloads: number) => {
  const [loaded, setLoaded] = useState<DocState | null>(null)
  const opened = useRef('')
  const key = active ?? ''
  const current = loaded?.key === key ? loaded : null

  useEffect(() => {
    if (!active) {
      return undefined
    }
    const silent = opened.current === key
    opened.current = key
    let alive = true
    fetch(`/api/doc?path=${encodeURIComponent(active)}`)
      .then((response) => (response.ok ? response.json() : failed(response)))
      .then((data: Doc) => {
        if (!alive) {
          return
        }
        setLoaded({ doc: data, error: null, key })
        if (!silent) {
          document.getElementById('page')?.scrollTo({ top: 0 })
        }
      })
      .catch((error: Error) => {
        if (alive) {
          setLoaded({ doc: null, error: error.message, key })
        }
      })
    return () => {
      alive = false
    }
  }, [active, key, reloads])

  return {
    doc: current?.doc ?? null,
    error: current?.error ?? null,
    pending: Boolean(key) && !current,
  }
}

const useReloads = () => {
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    const events = new EventSource('/api/events')
    events.addEventListener('message', () => setReloads((count) => count + 1))
    return () => events.close()
  }, [])
  return reloads
}

const Metric = ({ label, counts }: { label: string; counts: Counts }) => {
  if (!counts.total) {
    return null
  }
  return (
    <span className="text-muted inline-flex items-center gap-1.5 font-mono text-[11px]">
      <span className="tabular-nums">
        {label} {counts.done}/{counts.total}
      </span>
      <Meter value={ratio(counts)} tone={statusTone(counts.done === counts.total ? 'done' : 'in-progress')} />
    </span>
  )
}

const DocMeta = ({ doc, activePlan }: { doc: Doc; activePlan: DocNode | null }) => (
  <>
    <div className="text-muted mt-2 text-[13px]">
      plan
      {activePlan && activePlan.path !== doc.rootPath ? ` · ${activePlan.name}` : ''}
      {doc.meta.phases.length ? ` · ${doc.meta.phases.length} phases` : ''}
      {doc.meta.legacy ? ' · legacy format' : ''}
    </div>
    {doc.meta.author && <span>{doc.meta.author}</span>}
    {doc.meta.date && <span className="font-mono">{doc.meta.date}</span>}
    {doc.meta.related.length > 0 && <span className="font-mono text-[12px]">related: {doc.meta.related.join(', ')}</span>}
  </>
)

const DocumentPane = ({
  doc,
  error,
  activePlan,
  onOpenDoc,
}: {
  doc: Doc | null
  error: string | null
  activePlan: DocNode | null
  onOpenDoc: (path: string) => void
}) => {
  const article = useRef<HTMLElement>(null)
  const [dark, setDark] = useState(isDarkTheme)

  useEffect(() => {
    const media = prefersDark()
    const sync = () => setDark(isDarkTheme())
    const observer = new MutationObserver(sync)
    media.addEventListener('change', sync)
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', sync)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!doc?.hasMermaid || !article.current) {
      return undefined
    }
    let alive = true
    const diagrams = [...article.current.querySelectorAll<HTMLElement>('pre.mermaid')]
    for (const diagram of diagrams) {
      diagram.dataset.source ??= diagram.textContent ?? ''
      diagram.textContent = diagram.dataset.source ?? ''
      diagram.removeAttribute('data-processed')
    }

    void (async () => {
      try {
        // @ts-expect-error This same-origin asset is served dynamically by the server.
        const { default: mermaid } = await import('/assets/mermaid/dist/mermaid.esm.min.mjs')
        if (!alive) {
          return
        }
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })
        // Diagrams render one at a time: a concurrent run lets a failing diagram's error output land in another's container.
        await diagrams.reduce(
          (chain: Promise<void>, diagram) =>
            chain.then(() =>
              mermaid.run({ nodes: [diagram] }).catch(() => {
                diagram.textContent = diagram.dataset.source ?? ''
                diagram.removeAttribute('data-processed')
              })
            ),
          Promise.resolve()
        )
      } catch {
        // Leave the server-rendered Mermaid source visible when loading fails.
      }
    })()

    return () => {
      alive = false
    }
  }, [doc, dark])

  if (error) {
    return <p className="text-muted p-10 font-mono text-[13px]">Could not load this plan: {error}</p>
  }
  if (!doc) {
    return <p className="text-muted p-10">Select a document.</p>
  }

  return (
    <div className="mx-auto max-w-[calc(96ch+5rem)] px-10 pt-8 pb-16">
      <header className="mb-8 border-b pb-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-[-0.01em]">{doc.meta.title}</h1>
          {doc.meta.status && <StatusBadge status={doc.meta.status} />}
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <Metric label="AC" counts={doc.meta.acceptance} />
            <Metric label="T" counts={doc.meta.tasks} />
            <span className="text-muted font-mono text-[11px]">{doc.meta.lines} lines</span>
          </span>
        </div>

        <div className="text-muted mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <DocMeta doc={doc} activePlan={activePlan} />
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[12px]">{doc.rootPath}</span>
            <CopyChip label="path" value={doc.path} title={doc.path} />
            <CopyChip label="name" value={doc.path.split('/').pop() ?? ''} />
          </span>
        </div>
      </header>

      <article
        ref={article}
        className={cn(
          'prose prose-sm max-w-none [&>*:first-child]:mt-0',
          'prose-headings:scroll-mt-4 prose-h2:mt-10 prose-h2:border-t prose-h2:pt-2 [&>h2:first-child]:mt-0 [&>h2:first-child]:border-t-0 [&>h2:first-child]:pt-0',
          'prose-a:no-underline prose-a:border-b prose-a:border-b-[color-mix(in_srgb,var(--accent)_35%,transparent)] hover:prose-a:border-b-accent',
          '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:border [&_:not(pre)>code]:bg-[var(--code-bg)] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-normal prose-code:before:content-none prose-code:after:content-none',
          'prose-pre:border prose-th:border prose-th:bg-elevated prose-td:border prose-td:px-2.5 prose-td:py-1.5 prose-th:px-2.5 prose-th:py-1.5',
          'prose-blockquote:not-italic prose-blockquote:rounded-r prose-blockquote:bg-accent-soft prose-blockquote:py-2 prose-blockquote:pr-4 [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none',
          '[&_li:has(input)]:list-none [&_li:has(input:checked)]:text-muted [&_input]:accent-[var(--status-done)]'
        )}
        onClick={(event) => onArticleClick(event, onOpenDoc)}
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
    </div>
  )
}

export const App = () => {
  const [url, setUrl] = useUrlState()
  const [query, setQuery] = useState('')
  const tab: Tab = url.tab === 'specs' ? 'specs' : 'plans'
  const active = url.doc ?? null
  const reloads = useReloads()
  const { docs, error: docsError } = useDocs(reloads)
  const { doc, pending, error: docError } = useDoc(active, reloads)
  const openPlan = (path: string) => setUrl({ doc: path })
  const listed = tab === 'specs' ? docs.specs : docs.plans
  const needle = query.trim().toLowerCase()
  const filtered = useMemo(() => (needle ? matchingDocuments(listed, needle) : []), [listed, needle])
  const activePlan = useMemo(() => [...docs.plans, ...docs.specs].find((node) => findNode(node, active)) ?? null, [docs, active])
  return (
    <div className="flex h-screen">
      <aside className="flex w-[280px] shrink-0 flex-col border-r">
        <header className="flex items-center border-b px-4 py-3 font-mono">
          <span className="text-muted text-xs font-semibold tracking-[0.12em] uppercase">
            Plans<span className="text-accent">.</span>
          </span>
          <ThemeSelector />
        </header>

        <div className="relative border-b px-3 py-2">
          <SearchIcon className="text-muted absolute top-1/2 left-5 size-3.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter plans…"
            className="bg-elevated h-8 w-full rounded-md border pr-2 pl-7 text-[13px] outline-none"
          />
        </div>

        <nav aria-label="Plans" className="flex-1 overflow-y-auto p-3">
          <PlanList
            tab={tab}
            nodes={listed}
            filteredNodes={filtered}
            filtering={Boolean(needle)}
            active={active}
            onOpen={openPlan}
            onTab={(next) => setUrl({ doc: undefined, tab: next })}
          />
        </nav>
      </aside>

      <aside className="w-[240px] shrink-0 overflow-y-auto border-r p-3">
        <PlanStructure plan={activePlan} active={active} toc={pending ? [] : (doc?.toc ?? [])} onOpen={openPlan} />
      </aside>

      <main id="page" className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 h-[3px]" style={{ background: accentColor(pending ? undefined : doc?.meta.status) }} />
        {pending ? (
          <div className="text-muted flex h-[60vh] items-center justify-center gap-2">
            <LoadingIcon className="size-4 animate-spin" />
            <span className="font-mono text-[13px]">Loading…</span>
          </div>
        ) : (
          <DocumentPane doc={doc} error={docError ?? docsError} activePlan={activePlan} onOpenDoc={openPlan} />
        )}
      </main>
    </div>
  )
}
