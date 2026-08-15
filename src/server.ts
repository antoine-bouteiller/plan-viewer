import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, watch } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { buildTree, type DocMeta, type DocNode } from './corpus/tree.ts'
import index from './index.html'
import { cachedRender } from './render/cache'
import { ready, renderDoc } from './render/index'

interface Counts {
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
  kind?: DocNode['kind']
  'parent-spec'?: string
  archived?: boolean
}
interface Worktree {
  name: string
  main: boolean
  path: string
}
interface Project {
  name: string
  path: string
  worktrees: Worktree[]
}

// Plan format: ~/.claude/skills/create-plan, mirroring ~/.claude/skills/writing-spec.
// Frontmatter, then `## Problem`, `## Scope`, `## Context`, `## Acceptance criteria`
// (AC-NNN), `## Implementation` (T-NNN), … Files predating it carry `**Status:**`
// Under the H1 instead.
let cache: { at: number; projects: Project[] } | undefined = undefined

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.exit(1)
const EXTRA_PROJECTS = (process.env.EXTRA_PROJECTS ?? '')
  .split(':')
  .map((projectPath) => projectPath.trim())
  .filter(Boolean)
const PORT = Number(process.env.PORT ?? 4321)
const MERMAID_DIR = dirname(Bun.resolveSync('mermaid/package.json', import.meta.dir))
const label = (name: string) => name.replace(/\.md$/, '')
const unquote = (value: string) =>
  value
    .trim()
    .replaceAll(/^['"]|['"]$/g, '')
    .trim()

const parseValue = (value: string): string | string[] => {
  if (!value) {
    return []
  }
  if (value.startsWith('[')) {
    return value
      .replaceAll(/^\[|\]$/g, '')
      .split(',')
      .map(unquote)
      .filter(Boolean)
  }
  return unquote(value)
}

const parseFrontmatter = (source: string): Record<string, string | string[]> => {
  const block = /^---[^\S\n]*\r?\n(?<content>[\s\S]*?)\r?\n---[^\S\n]*(?:\r?\n|$)/.exec(source)
  const out: Record<string, string | string[]> = {}
  const content = block?.groups?.content
  let key: string | null = null
  if (!content) {
    return {}
  }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\s+#\s.*$/, '')
    const item = /^\s*-\s+(?<value>.*)$/.exec(line)
    const pair = /^(?<key>[A-Za-z0-9_-]+):[^\S\n]*(?<value>.*)$/.exec(line)
    if (line.trim()) {
      if (item && key) {
        const current = out[key]
        out[key] = [...(Array.isArray(current) ? current : []), unquote(item.groups?.value ?? '')]
      } else if (pair) {
        const { key: parsedKey = '', value: rawValue = '' } = pair.groups ?? {}
        const value = rawValue.trim()
        key = parsedKey
        out[key] = parseValue(value)
      }
    }
  }
  return out
}

const text = (value: string | string[] | undefined) => (typeof value === 'string' && value.length ? value : undefined)
const list = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value
  }
  return typeof value === 'string' && value.length ? [value] : []
}

const stripFrontmatter = (source: string) => source.replace(/^---[^\S\n]*\r?\n[\s\S]*?\r?\n---[^\S\n]*(?:\r?\n|$)/, '')

const stripFences = (source: string) => source.replaceAll(/^ {0,3}(?<fence>```|~~~)[\s\S]*?^ {0,3}\k<fence>[^\n]*$/gm, '')

const sectionsOf = (body: string): Map<string, string> => {
  const found: { name: string; from: number; to: number }[] = []
  const pattern = /^##[^\S\n]+(?<name>.+?)[^\S\n]*$/gm
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    const previous = found[found.length - 1]
    if (previous) {
      previous.to = match.index
    }
    found.push({ from: pattern.lastIndex, name: match.groups?.name?.toLowerCase() ?? '', to: body.length })
  }
  return new Map(found.map((section) => [section.name, body.slice(section.from, section.to)]))
}

const countChecks = (source: string | undefined): Counts => ({
  done: source?.match(/^\s*[-*]\s+\[[xX]\]/gm)?.length ?? 0,
  total: source?.match(/^\s*[-*]\s+\[[ xX]\]/gm)?.length ?? 0,
})

const STATUS_ALIASES: Record<string, string> = {
  complete: 'done',
  completed: 'done',
  finished: 'done',
  implemented: 'done',
  'in progress': 'in-progress',
  planned: 'draft',
  review: 'ready',
  todo: 'draft',
  wip: 'in-progress',
}

const normalizeStatus = (raw: string | undefined): string | undefined => {
  const cleaned = raw
    ?.trim()
    .toLowerCase()
    .replace(/[.;,—-]+$/, '')
    .trim()
  const head = cleaned?.split(/[;,—]| - /)[0].trim()
  if (!cleaned || !head) {
    return undefined
  }
  return STATUS_ALIASES[head] ?? head
}

const metaIdentity = (frontmatter: Record<string, string | string[]>, body: string, file: string) => {
  const legacyStatus = /^\*\*Status:\*\*[^\S\n]*(?<status>.+)$/im.exec(body)?.groups?.status
  const status = text(frontmatter.status)
  const title = text(frontmatter.title)
  const fallbackTitle = /^#[^\S\n]+(?<title>.+)$/m.exec(body)?.groups?.title?.trim() ?? label(basename(file))

  return {
    archived: text(frontmatter.archived)?.toLowerCase() === 'true' || undefined,
    legacy: !status && !title && Boolean(legacyStatus),
    status: normalizeStatus(status ?? legacyStatus),
    title: title ?? fallbackTitle,
  }
}

const metaOf = (source: string, file: string): Meta => {
  const frontmatter = parseFrontmatter(source)
  const raw = stripFrontmatter(source)
  const body = stripFences(raw)
  const sections = sectionsOf(body)
  const implementation = sections.get('implementation') ?? sections.get('steps')
  const phases = [...(implementation?.matchAll(/^###[^\S\n]+(?<name>.+?)[^\S\n]*$/gm) ?? [])].map((match) => match.groups?.name ?? '')

  return {
    ...metaIdentity(frontmatter, body, file),
    acceptance: countChecks(sections.get('acceptance criteria')),
    author: text(frontmatter.author),
    date: text(frontmatter.date),
    kind: text(frontmatter.kind) as DocNode['kind'] | undefined,
    lines: raw.trim().split('\n').length,
    'parent-spec': text(frontmatter['parent-spec']),
    phases,
    related: list(frontmatter.related),
    tasks: countChecks(implementation),
  }
}

const readMeta = (file: string): Meta | undefined => {
  try {
    return metaOf(readFileSync(file, 'utf8'), file)
  } catch {
    return undefined
  }
}

const bodyBelowHeader = (src: string) =>
  stripFrontmatter(src)
    .replace(/^#[^\S\n]+.+$/m, '')
    .replace(/^\*\*Status:\*\*.*$/im, '')
    .trimStart()

const toDocMeta = (full: string, path: string, kind?: DocNode['kind']): DocMeta => {
  const meta = readMeta(full)
  return {
    acceptance: meta?.acceptance,
    archived: meta?.archived,
    kind: kind ?? meta?.kind,
    'parent-spec': meta?.['parent-spec'],
    path,
    status: meta?.status,
    tasks: meta?.tasks,
    title: meta?.title ?? label(basename(path)),
  }
}

const listPlans = (dir: string, worktree: string, kind: 'plan' | 'phase' = 'plan'): DocMeta[] => {
  if (!existsSync(dir)) {
    return []
  }
  const plans: DocMeta[] = []
  for (const entry of readdirSync(dir).toSorted((first, second) => first.localeCompare(second))) {
    const full = join(dir, entry)
    try {
      const stats = lstatSync(full)
      if (!stats.isSymbolicLink()) {
        if (stats.isDirectory()) {
          plans.push(...listPlans(full, worktree, 'phase'))
        } else if (entry.endsWith('.md')) {
          const realFile = realFileInWorktree(full, worktree)
          if (realFile) {
            // Folder plan: index.md owns status and checkboxes, siblings are phases.
            plans.push(toDocMeta(realFile, relative(worktree, full), kind === 'phase' && entry === 'index.md' ? 'plan' : kind))
          }
        }
      }
    } catch {
      // Ignore entries which disappear during traversal.
    }
  }
  return plans
}

const isGitRepo = (dir: string) => existsSync(join(dir, '.git'))

const worktreesOf = (repo: string): { path: string; main: boolean; label: string }[] => {
  let output = ''
  try {
    output = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    })
  } catch {
    return [{ label: 'main', main: true, path: repo }]
  }
  const trees: { path: string; branch?: string }[] = []
  for (const block of output.trim().split('\n\n')) {
    const path = /^worktree (?<path>.+)$/m.exec(block)?.groups?.path
    const branch = /^branch (?<branch>.+)$/m.exec(block)?.groups?.branch?.replace('refs/heads/', '')
    if (path) {
      trees.push({ branch, path })
    }
  }
  return trees.map((tree, treeIndex) => ({
    label: tree.branch ?? basename(tree.path),
    main: treeIndex === 0,
    path: tree.path,
  }))
}

const commonDir = (repo: string): string => {
  try {
    const output = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
    }).trim()
    return resolve(repo, output)
  } catch {
    return resolve(repo)
  }
}

const toProject = (dir: string): Project => {
  const trees = worktreesOf(dir)
  const worktrees: Worktree[] = trees.map((worktree) => ({
    main: worktree.main,
    name: worktree.label,
    path: worktree.path,
  }))
  const mainPath = trees.find((tree) => tree.main)?.path ?? dir
  return { name: basename(mainPath), path: mainPath, worktrees }
}

const MAX_DEPTH = 4

const findRepos = (dir: string, depth: number, output: string[]) => {
  if (depth > MAX_DEPTH) {
    return
  }
  if (isGitRepo(dir)) {
    output.push(dir)
    return
  }
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith('.') && entry !== 'node_modules') {
      const child = join(dir, entry)
      try {
        if (statSync(child).isDirectory()) {
          findRepos(child, depth + 1, output)
        }
      } catch {
        // Ignore entries which disappear during traversal.
      }
    }
  }
}

const discover = (): Project[] => {
  const dirs: string[] = []
  const seen = new Set<string>()
  const projects: Project[] = []
  findRepos(WORKSPACE_ROOT, 0, dirs)
  for (const projectPath of EXTRA_PROJECTS) {
    const dir = resolve(projectPath)
    if (existsSync(dir) && !dirs.includes(dir)) {
      dirs.push(dir)
    }
  }

  for (const dir of dirs) {
    const key = commonDir(dir)
    if (!seen.has(key)) {
      seen.add(key)
      projects.push(toProject(dir))
    }
  }
  projects.sort((first, second) => first.name.localeCompare(second.name))
  return projects
}

const TTL = 5000

const scan = (): Project[] => {
  if (!cache || Date.now() - cache.at > TTL) {
    const projects = discover()
    cache = { at: Date.now(), projects }
  }
  return cache.projects
}

// A worktree path from discovery is the only root a request may read under.
const worktreeAt = (path: string): string | undefined => {
  const wantedPath = resolve(path)
  for (const project of scan()) {
    for (const worktree of project.worktrees) {
      if (resolve(worktree.path) === wantedPath) {
        return resolve(worktree.path)
      }
    }
  }
  return undefined
}

const SPEC = /\.(?<kind>spec|discovery|examples)\.mdx?$/

const contained = (file: string, worktree: string) => {
  const relativePath = relative(worktree, file)
  return Boolean(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

const isAllowed = (file: string, worktree: string) => {
  if (!contained(file, worktree)) {
    return false
  }
  const relativePath = relative(worktree, file)
  return (relativePath.startsWith(`.plan${sep}`) && relativePath.endsWith('.md')) || SPEC.test(relativePath)
}

const realFileInWorktree = (file: string, worktree: string): string | undefined => {
  try {
    const realFile = realpathSync(file)
    return contained(realFile, realpathSync(worktree)) ? realFile : undefined
  } catch {
    return undefined
  }
}

const specPaths = (worktree: string): string[] => {
  let output = ''
  try {
    output = execFileSync(
      'git',
      ['-C', worktree, 'ls-files', '--', '*.spec.md', '*.spec.mdx', '*.discovery.md', '*.discovery.mdx', '*.examples.md', '*.examples.mdx'],
      { encoding: 'utf8' }
    )
  } catch {
    return []
  }
  return output
    .split('\n')
    .filter(Boolean)
    .toSorted((first, second) => first.localeCompare(second))
}

const listSpecs = (worktree: string): DocMeta[] =>
  specPaths(worktree).flatMap((path) => {
    const full = realFileInWorktree(join(worktree, path), worktree)
    return full ? [toDocMeta(full, path)] : []
  })

const gitIndexPath = (worktree: string): string | undefined => {
  try {
    const output = execFileSync('git', ['-C', worktree, 'rev-parse', '--git-path', 'index'], { encoding: 'utf8' }).trim()
    return resolve(worktree, output)
  } catch {
    return undefined
  }
}

const isGitIndexEntry = (filename: string | Buffer | null) => {
  const entry = filename?.toString()
  return entry === 'index' || entry === 'index.lock'
}

const eventsResponse = (request: Request, worktree: string) => {
  const dirs = new Set<string>()
  const gitIndex = gitIndexPath(worktree)
  const planDir = join(worktree, '.plan')
  const watchers: ReturnType<typeof watch>[] = []
  const stream = new ReadableStream({
    start(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined = undefined
      const send = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          try {
            controller.enqueue('data: reload\n\n')
          } catch {
            // The stream may have been closed while the timer was pending.
          }
        }, 100)
      }
      const watchDocumentDirectories = () => {
        for (const directory of specPaths(worktree)
          .map((path) => resolve(worktree, path, '..'))
          .filter((path) => existsSync(path))) {
          if (!dirs.has(directory)) {
            try {
              watchers.push(watch(directory, () => changed()))
              dirs.add(directory)
            } catch {
              // Ignore directories which cannot be watched.
            }
          }
        }
      }
      const changed = () => {
        watchDocumentDirectories()
        send()
      }
      if (existsSync(planDir)) {
        try {
          watchers.push(watch(planDir, { recursive: true }, () => changed()))
        } catch {
          // Recursive watching is not supported by every platform.
        }
      }
      if (gitIndex && existsSync(dirname(gitIndex))) {
        try {
          watchers.push(
            watch(dirname(gitIndex), (_event, filename) => {
              if (isGitIndexEntry(filename)) {
                changed()
              }
            })
          )
        } catch {
          // Ignore Git directories which cannot be watched.
        }
      }
      watchDocumentDirectories()
      request.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        for (const watcher of watchers) {
          watcher.close()
        }
        try {
          controller.close()
        } catch {
          // The stream may already be closed.
        }
      })
    },
  })
  return new Response(stream, { headers: { 'cache-control': 'no-cache', 'content-type': 'text/event-stream' } })
}

const resolvedDocumentFile = (file: string, worktree: string) => {
  try {
    const realFile = realpathSync(file)
    return { file: contained(realFile, realpathSync(worktree)) ? realFile : undefined, forbidden: !contained(realFile, realpathSync(worktree)) }
  } catch {
    return { file: undefined, forbidden: false }
  }
}

const readDocumentSource = async (file: string) => {
  try {
    const stamp = statSync(file)
    const source = await Bun.file(file).text()
    return { source, stamp }
  } catch {
    return undefined
  }
}

const documentResponse = async (worktree: string, path: string) => {
  if (path.includes('\0') || isAbsolute(path)) {
    return new Response('forbidden', { status: 403 })
  }
  const file = resolve(worktree, path)
  if (!isAllowed(file, worktree)) {
    return new Response('forbidden', { status: 403 })
  }
  const resolved = resolvedDocumentFile(file, worktree)
  if (resolved.forbidden) {
    return new Response('forbidden', { status: 403 })
  }
  if (!resolved.file) {
    return new Response('not found', { status: 404 })
  }
  const realFile = resolved.file
  const sourceAndStamp = await readDocumentSource(realFile)
  if (!sourceAndStamp) {
    return new Response('not found', { status: 404 })
  }
  const { source, stamp } = sourceAndStamp
  const { mtimeMs, size } = stamp
  const result = cachedRender(realFile, { mtimeMs, size }, () => renderDoc({ path: relative(worktree, realFile), source: bodyBelowHeader(source) }))
  return Response.json({
    degraded: result.degraded ?? null,
    hasMermaid: result.hasMermaid,
    html: result.html,
    meta: metaOf(source, file),
    path: file,
    repoPath: relative(worktree, file),
    toc: result.toc,
  })
}

const mermaidResponse = async (assetPath: string) => {
  const file = resolve(MERMAID_DIR, assetPath)
  if (!contained(file, MERMAID_DIR)) {
    return new Response('forbidden', { status: 403 })
  }
  if (!assetPath.endsWith('.mjs') && !assetPath.endsWith('.js')) {
    return new Response('not found', { status: 404 })
  }
  const fileHandle = Bun.file(file)
  if (!(await fileHandle.exists())) {
    return new Response('not found', { status: 404 })
  }
  const realPaths = (() => {
    try {
      return { file: realpathSync(file), mermaidDir: realpathSync(MERMAID_DIR) }
    } catch {
      return undefined
    }
  })()
  if (!realPaths) {
    return new Response('not found', { status: 404 })
  }
  if (!contained(realPaths.file, realPaths.mermaidDir)) {
    return new Response('forbidden', { status: 403 })
  }
  return new Response(Bun.file(realPaths.file), {
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
  })
}

await ready

const _server = Bun.serve({
  development: process.env.NODE_ENV !== 'production',
  async fetch(request) {
    const url = new URL(request.url)
    const worktree = worktreeAt(url.searchParams.get('wt') ?? '')

    if (url.pathname === '/api/projects') {
      return Response.json({ projects: scan(), root: WORKSPACE_ROOT })
    }

    if (url.pathname === '/api/docs') {
      if (!worktree) {
        return new Response('forbidden', { status: 403 })
      }
      return Response.json({
        plans: buildTree(listPlans(join(worktree, '.plan'), worktree), { flat: true }),
        specs: buildTree(listSpecs(worktree)),
      })
    }

    if (url.pathname === '/api/doc') {
      return worktree ? documentResponse(worktree, url.searchParams.get('path') ?? '') : new Response('forbidden', { status: 403 })
    }

    if (url.pathname === '/api/events') {
      return worktree ? eventsResponse(request, worktree) : new Response('forbidden', { status: 403 })
    }

    if (request.method === 'GET' && url.pathname.startsWith('/assets/mermaid/')) {
      return mermaidResponse(url.pathname.slice('/assets/mermaid/'.length))
    }

    return new Response('not found', { status: 404 })
  },
  // /api/events is a long-lived SSE stream with no traffic between file changes.
  idleTimeout: 0,
  port: PORT,
  routes: { '/': index },
})
