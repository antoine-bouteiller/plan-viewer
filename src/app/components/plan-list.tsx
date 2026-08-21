import { DocTree } from '@/components/doc-tree'
import { StatusBadge } from '@/components/ui/status-badge'
import { TreeRow } from '@/components/ui/tree-row'
import { type DocNode, type Tab } from '@/lib/plan'

const PlanList = ({
  tab,
  nodes,
  filteredNodes,
  filtering,
  active,
  onOpen,
  onTab,
}: {
  tab: Tab
  nodes: DocNode[]
  filteredNodes: DocNode[]
  filtering: boolean
  active: string | null
  onOpen: (path: string) => void
  onTab: (tab: Tab) => void
}) => (
  <>
    <div className="mb-2 flex gap-1">
      {(['plans', 'specs'] as Tab[]).map((name) => (
        <TreeRow key={name} current={tab === name} onClick={() => onTab(name)} className="flex-1 justify-center">
          <span className="capitalize">{name}</span>
        </TreeRow>
      ))}
    </div>

    {filtering &&
      (filteredNodes.length ? (
        <ul>
          {filteredNodes.map((node) => {
            const status = node.archived ? 'archived' : node.status
            return (
              <li key={node.path}>
                <TreeRow
                  current={active === node.path}
                  onClick={() => node.path && onOpen(node.path)}
                  aria-current={active === node.path ? 'page' : undefined}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{node.name}</span>
                    <span className="text-muted truncate font-mono text-[11px]">{node.path}</span>
                  </span>
                  {status && <StatusBadge status={status} variant="chip" />}
                </TreeRow>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted/70 px-3 py-0.5 text-[12px] italic">no matching {tab}</p>
      ))}
    {nodes.length ? (
      <div hidden={filtering}>
        <DocTree key={tab} nodes={nodes} active={active} onOpen={onOpen} />
      </div>
    ) : (
      !filtering && <p className="text-muted/70 px-3 py-0.5 text-[12px] italic">no {tab}</p>
    )}
  </>
)

export { PlanList }
