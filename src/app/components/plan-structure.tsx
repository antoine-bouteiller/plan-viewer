import { useEffect, useState } from 'react'

import { RowName, TreeRow } from '@/components/ui/tree-row'
import { containsPath, isFamilyRoot, type DocNode, type TocEntry } from '@/lib/plan'
import { cn } from '@/lib/utils'

const findNode = (node: DocNode, path: string | null): DocNode | null => {
  if (node.path === path) {
    return node
  }
  return node.children?.map((child) => findNode(child, path)).find(Boolean) ?? null
}

const documentsOf = (nodes: DocNode[]): DocNode[] =>
  nodes.flatMap((node) => [...(node.path ? [node] : []), ...(isFamilyRoot(node) ? [] : documentsOf(node.children ?? []))])

const familyOf = (node: DocNode, path: string | null): DocNode[] | null => {
  const nested = (node.children ?? []).map((child) => familyOf(child, path)).find(Boolean)
  if (nested) {
    return nested
  }
  return isFamilyRoot(node) && containsPath(node, path) ? [node, ...documentsOf(node.children ?? [])] : null
}

const Sections = ({ entries, nested }: { entries: TocEntry[]; nested?: boolean }) => {
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const page = document.getElementById('page')
    const headings = entries.map((entry) => document.getElementById(entry.id)).filter((el): el is HTMLElement => Boolean(el))
    let cleanup = () => {
      /* Empty */
    }

    if (page && headings.length) {
      const onScroll = () => {
        const top = page.getBoundingClientRect().top + 24
        let active = headings[0].id
        for (const el of headings) {
          if (el.getBoundingClientRect().top <= top) {
            active = el.id
          }
        }
        setCurrent(active)
      }

      onScroll()
      page.addEventListener('scroll', onScroll, { passive: true })
      cleanup = () => page.removeEventListener('scroll', onScroll)
    }

    return cleanup
  }, [entries])

  if (!entries.length) {
    return null
  }

  return (
    <ol className={cn('m-0 list-none border-l p-0', nested && 'my-1 ml-2')}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            className={cn(
              '-ml-px block border-l-2 border-transparent px-3 py-1 text-[13px] leading-tight text-muted no-underline hover:text-fg',
              entry.depth === 3 && 'pl-6',
              current === entry.id && 'border-l-accent font-semibold text-fg'
            )}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  )
}

const RAIL_HEADING = 'text-[11px] font-semibold tracking-[0.05em] text-muted uppercase'

const PlanStructure = ({
  plan,
  active,
  toc,
  onOpen,
}: {
  plan: DocNode | null
  active: string | null
  toc: TocEntry[]
  onOpen: (path: string) => void
}) => {
  if (!plan) {
    return <p className="text-muted text-[13px] italic">No plan selected.</p>
  }

  const files = familyOf(plan, active)
  const activeNode = findNode(plan, active)

  if (!files) {
    return (
      <nav aria-label="Plan structure">
        <h2 className={cn(RAIL_HEADING, 'mb-3')}>Sections</h2>
        <Sections entries={toc} />
      </nav>
    )
  }

  return (
    <nav aria-label="Plan structure">
      <h2 className={cn(RAIL_HEADING, 'mb-3')}>Files</h2>
      <ul>
        {files.map((file, index) => (
          <li key={file.path ?? file.name}>
            <TreeRow current={active === file.path} onClick={() => file.path && onOpen(file.path)} title={file.name}>
              <RowName current={active === file.path}>{file.name}</RowName>
              {index === 0 && (
                <span className="bg-bg text-muted rounded-[3px] border px-1 font-mono text-[9px]/[1.5] font-semibold tracking-[0.04em] uppercase">
                  index
                </span>
              )}
            </TreeRow>
            {active === file.path && <Sections entries={toc} nested />}
          </li>
        ))}
      </ul>
      {activeNode && !files.some((file) => file.path === active) && (
        <>
          <h2 className={cn(RAIL_HEADING, 'mt-5 mb-3')}>Sections</h2>
          <Sections entries={toc} />
        </>
      )}
    </nav>
  )
}

export { PlanStructure }
