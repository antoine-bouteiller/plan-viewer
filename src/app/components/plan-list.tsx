import { DocTree } from '@/components/doc-tree'
import { Select } from '@/components/ui/select'
import { StatusBadge } from '@/components/ui/status-badge'
import { TreeRow } from '@/components/ui/tree-row'
import { type DocNode, type Project, type Tab, type Worktree } from '@/lib/plan'

const PlanList = ({
  projects,
  project,
  worktree,
  tab,
  nodes,
  filteredNodes,
  filtering,
  active,
  onOpen,
  onProject,
  onWorktree,
  onTab,
}: {
  projects: Project[]
  project: Project | undefined
  worktree: Worktree | undefined
  tab: Tab
  nodes: DocNode[]
  filteredNodes: DocNode[]
  filtering: boolean
  active: string | null
  onOpen: (path: string) => void
  onProject: (name: string) => void
  onWorktree: (path: string) => void
  onTab: (tab: Tab) => void
}) => (
  <>
    <div className="mb-3 flex flex-col gap-2">
      <Select value={project?.name ?? ''} onChange={(event) => onProject(event.target.value)} aria-label="Project">
        <option value="" disabled>
          Select a project…
        </option>
        {projects.map((projectOption) => (
          <option key={projectOption.path} value={projectOption.name}>
            {projectOption.name}
          </option>
        ))}
      </Select>

      {project && (
        <Select value={worktree?.path ?? ''} onChange={(event) => onWorktree(event.target.value)} aria-label="Worktree">
          {project.worktrees.map((worktreeOption) => (
            <option key={worktreeOption.path} value={worktreeOption.path}>
              {worktreeOption.name}
              {worktreeOption.main ? ' (main)' : ''}
            </option>
          ))}
        </Select>
      )}
    </div>

    {worktree && (
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
            <DocTree key={`${worktree.path}:${tab}`} nodes={nodes} active={active} onOpen={onOpen} />
          </div>
        ) : (
          !filtering && <p className="text-muted/70 px-3 py-0.5 text-[12px] italic">no {tab}</p>
        )}
      </>
    )}

    {!project && <p className="text-muted px-2 py-1 text-[13px] italic">Select a project to browse.</p>}
  </>
)

export { PlanList }
