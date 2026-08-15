export interface Counts {
  done: number
  total: number
}

interface Meta {
  title: string
  status?: string
  author?: string
  date?: string
  related: string[]
  tasks: Counts
  acceptance: Counts
  phases: string[]
  lines: number
  legacy: boolean
}

export interface DocNode {
  name: string
  path?: string
  kind: 'dir' | 'plan' | 'phase' | 'umbrella' | 'leaf' | 'discovery' | 'examples'
  status?: string
  archived?: boolean
  tasks?: Counts
  acceptance?: Counts
  children?: DocNode[]
}

export interface Worktree {
  name: string
  main: boolean
  path: string
}
export interface Project {
  name: string
  path: string
  worktrees: Worktree[]
}

export interface Docs {
  plans: DocNode[]
  specs: DocNode[]
}
export type Tab = 'plans' | 'specs'

export interface TocEntry {
  id: string
  text: string
  depth: number
}

export interface Doc {
  path: string
  repoPath: string
  meta: Meta
  html: string
  toc: TocEntry[]
  hasMermaid: boolean
  degraded: { reason: 'mdx-parse'; message: string; line: number } | null
}

const KNOWN = new Set([
  'draft',
  'ready',
  'in-progress',
  'blocked',
  'done',
  'review',
  'accepted',
  'implemented',
  'amended',
  'archived',
  'implementing',
  'converging',
])
const statusToken = (status: string | undefined) => (status && KNOWN.has(status) ? status : 'unknown')

const TONES: Record<string, string> = {
  accepted: 'var(--status-ready)',
  amended: 'var(--status-draft)',
  archived: 'var(--status-unknown)',
  blocked: 'var(--status-blocked)',
  converging: 'var(--status-ready)',
  done: 'var(--status-done)',
  draft: 'var(--status-draft)',
  implemented: 'var(--status-done)',
  implementing: 'var(--status-in-progress)',
  'in-progress': 'var(--status-in-progress)',
  ready: 'var(--status-ready)',
  review: 'var(--status-in-progress)',
}

const statusTone = (status: string | undefined) => TONES[statusToken(status)] ?? 'var(--status-unknown)'
const ratio = (counts: Counts | undefined) => (counts && counts.total ? counts.done / counts.total : 0)

const isFamilyRoot = (node: DocNode) => Boolean(node.path) && Boolean(node.children?.length)

const containsPath = (node: DocNode, path: string | null): boolean =>
  node.path === path || (node.children ?? []).some((child) => containsPath(child, path))

export { statusToken, statusTone, ratio, isFamilyRoot, containsPath }
