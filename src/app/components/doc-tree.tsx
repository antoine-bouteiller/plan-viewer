import { useRef, useState } from 'react'

import { ChevronRightIcon } from '@/components/ui/icons'
import { StatusBadge } from '@/components/ui/status-badge'
import { RowName, treeRowClass } from '@/components/ui/tree-row'
import { containsPath, isFamilyRoot, type DocNode } from '@/lib/plan'
import { cn } from '@/lib/utils'

const nodeKey = (node: DocNode, parentKey: string) => node.path ?? `${parentKey}/${node.name}`

const childrenOf = (node: DocNode) => (isFamilyRoot(node) ? [] : (node.children ?? []))

const ancestorKeys = (nodes: DocNode[], active: string | null, parentKey = ''): string[] => {
  for (const node of nodes) {
    const key = nodeKey(node, parentKey)
    if (node.path === active) {
      return []
    }
    const ancestors = ancestorKeys(node.children ?? [], active, key)
    if (ancestors.length || node.children?.some((child) => child.path === active)) {
      return [key, ...ancestors]
    }
  }
  return []
}

const findNodeKey = (nodes: DocNode[], active: string | null, parentKey = ''): string | null => {
  for (const node of nodes) {
    const key = nodeKey(node, parentKey)
    if (node.path === active) {
      return key
    }
    const descendant = findNodeKey(node.children ?? [], active, key)
    if (descendant) {
      return descendant
    }
  }
  return null
}

interface VisibleRow {
  node: DocNode
  key: string
  parentKey: string | null
  depth: number
}

const DocTreeContents = ({ nodes, active, onOpen }: { nodes: DocNode[]; active: string | null; onOpen: (path: string) => void }) => {
  const [expanded, setExpanded] = useState(() => new Set(ancestorKeys(nodes, active)))
  const [focusedKey, setFocusedKey] = useState(() => findNodeKey(nodes, active) ?? (nodes[0] ? nodeKey(nodes[0], '') : ''))
  const rows = useRef(new Map<string, HTMLDivElement>())
  const [seenActive, setSeenActive] = useState(active)

  if (seenActive !== active) {
    setSeenActive(active)
    setExpanded((current) => new Set([...current, ...ancestorKeys(nodes, active)]))
  }

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const visibleRows: VisibleRow[] = []
  const collectVisibleRows = (
    items: DocNode[],
    { depth = 0, keyPrefix = '', parentKey = null }: { depth?: number; keyPrefix?: string; parentKey?: string | null } = {}
  ) => {
    for (const node of items) {
      const key = nodeKey(node, keyPrefix)
      visibleRows.push({ depth, key, node, parentKey })
      if (expanded.has(key)) {
        collectVisibleRows(childrenOf(node), { depth: depth + 1, keyPrefix: key, parentKey: key })
      }
    }
  }
  collectVisibleRows(nodes)

  const activeRow = visibleRows.find((row) => row.node.path === active)
  const focusedRow = visibleRows.find((row) => row.key === focusedKey)
  const focusKey = focusedRow?.key ?? activeRow?.key ?? visibleRows[0]?.key ?? ''

  const focusRow = (key: string) => {
    setFocusedKey(key)
    requestAnimationFrame(() => rows.current.get(key)?.focus())
  }

  const renderNodes = (items: DocNode[], depth = 0, parentKey = '') => (
    <ul className={depth ? 'ml-2.5 border-l pl-2.5' : undefined} role={depth ? 'group' : undefined}>
      {items.map((node) => {
        const key = nodeKey(node, parentKey)
        const children = childrenOf(node)
        const hasChildren = children.length > 0
        const isCurrent = node.path === active || (isFamilyRoot(node) && containsPath(node, active))
        const isExpanded = expanded.has(key)
        const { path } = node
        const status = node.archived ? 'archived' : node.status

        const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
          const index = visibleRows.findIndex((row) => row.key === key)
          const previous = visibleRows[index - 1]
          const next = visibleRows[index + 1]
          const firstChild = visibleRows.find((row) => row.parentKey === key)
          const parent = visibleRows.find((row) => row.key === visibleRows[index]?.parentKey)

          switch (event.key) {
            case 'ArrowDown': {
              event.preventDefault()
              if (next) {
                focusRow(next.key)
              }
              break
            }
            case 'ArrowUp': {
              event.preventDefault()
              if (previous) {
                focusRow(previous.key)
              }
              break
            }
            case 'ArrowRight': {
              event.preventDefault()
              if (hasChildren && !isExpanded) {
                toggle(key)
              } else if (firstChild) {
                focusRow(firstChild.key)
              }
              break
            }
            case 'ArrowLeft': {
              event.preventDefault()
              if (hasChildren && isExpanded) {
                toggle(key)
              } else if (parent) {
                focusRow(parent.key)
              }
              break
            }
            case 'Enter': {
              if (path) {
                event.preventDefault()
                onOpen(path)
              }
              break
            }
            default:
          }
        }

        return (
          <li key={key}>
            <div
              ref={(element) => {
                if (element) {
                  rows.current.set(key, element)
                } else {
                  rows.current.delete(key)
                }
              }}
              className={cn(treeRowClass(isCurrent), 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent')}
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => {
                focusRow(key)
                if (path) {
                  onOpen(path)
                } else if (hasChildren) {
                  toggle(key)
                }
              }}
              onFocus={() => setFocusedKey(key)}
              tabIndex={focusKey === key ? 0 : -1}
              onKeyDown={onKeyDown}
            >
              {hasChildren && (
                <button
                  type="button"
                  className="text-muted shrink-0"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle(key)
                  }}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
                  aria-expanded={isExpanded}
                >
                  <ChevronRightIcon className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')} />
                </button>
              )}
              <RowName current={isCurrent} title={path}>
                {node.name}
              </RowName>
              {status && <StatusBadge status={status} variant="chip" />}
            </div>
            {hasChildren && isExpanded && renderNodes(children, depth + 1, key)}
          </li>
        )
      })}
    </ul>
  )

  return renderNodes(nodes)
}

const DocTree = ({ nodes, active, onOpen }: { nodes: DocNode[]; active: string | null; onOpen: (path: string) => void }) => (
  <DocTreeContents nodes={nodes} active={active} onOpen={onOpen} />
)

export { DocTree }
