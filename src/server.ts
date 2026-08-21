import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, watch } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { buildTree, type DocMeta, type DocNode } from './corpus/tree.ts'
import index from './index.html'
import { readEntry, updateEntry } from './launcher/registry.ts'
import { projectOf } from './project.ts'
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
// Plan format: ~/.claude/skills/create-plan, mirroring ~/.claude/skills/writing-spec.
// Frontmatter, then `## Problem`, `## Scope`, `## Context`, `## Acceptance criteria`
// (AC-NNN), `## Implementation` (T-NNN), … Files predating it carry `**Status:**`
// Under the H1 instead.
const fail = (message: string): never => {
  process.stderr.write(`plan-viewer: ${message}\n`)
  process.exit(1)
}

const [_bun, _script, rootArgument, ...args] = Bun.argv
if (!rootArgument) {
  fail('root directory is required')
}

let ROOT = ''
try {
  ROOT = realpathSync(rootArgument)
  if (!statSync(ROOT).isDirectory()) {
    fail(`root is not a directory: ${rootArgument}`)
  }
} catch {
  fail(`cannot resolve root: ${rootArgument}`)
}

const PROJECT = projectOf(ROOT)

const portArgument = args.indexOf('--port')
const portValue = portArgument === -1 ? undefined : args[portArgument + 1]
if (portArgument !== -1 && portValue === undefined) {
  fail('--port requires a value')
}
const PORT = portValue === undefined ? 0 : Number(portValue)
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65_535) {
  fail(`invalid port: ${portValue ?? ''}`)
}
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

const listPlans = (dir: string, root: string, kind: 'plan' | 'phase' = 'plan'): DocMeta[] => {
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
          plans.push(...listPlans(full, root, 'phase'))
        } else if (entry.endsWith('.md')) {
          const realFile = realFileInRoot(full, root)
          if (realFile) {
            // Folder plan: index.md owns status and checkboxes, siblings are phases.
            plans.push(toDocMeta(realFile, relative(root, full), kind === 'phase' && entry === 'index.md' ? 'plan' : kind))
          }
        }
      }
    } catch {
      // Ignore entries which disappear during traversal.
    }
  }
  return plans
}

// A listed worktree is the only root a request may read under.
const sameProject = (path: string) => {
  try {
    return projectOf(path).key === PROJECT.key
  } catch {
    return false
  }
}

const projectAt = (root: string) => {
  try {
    return projectOf(root)
  } catch {
    return undefined
  }
}

const currentProject = () => {
  for (const root of [ROOT, ...PROJECT.worktrees.map((worktree) => worktree.path)]) {
    const project = projectAt(root)
    if (project?.key === PROJECT.key) {
      return { ...project, worktrees: project.worktrees.filter((worktree) => sameProject(worktree.path)) }
    }
  }
  return { ...PROJECT, worktrees: [] }
}

const worktreeAt = (path: string): string | undefined => {
  if (!path) {
    return undefined
  }
  let wanted = ''
  try {
    wanted = realpathSync(path)
  } catch {
    return undefined
  }
  return currentProject().worktrees.find((worktree) => worktree.path === wanted)?.path
}

const SPEC = /\.(?<kind>spec|discovery|examples)\.mdx?$/

const contained = (file: string, root: string) => {
  const relativePath = relative(root, file)
  return Boolean(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

const isAllowed = (file: string, root: string) => {
  if (!contained(file, root)) {
    return false
  }
  const relativePath = relative(root, file)
  return (relativePath.startsWith(`.plan${sep}`) && relativePath.endsWith('.md')) || SPEC.test(relativePath)
}

const realFileInRoot = (file: string, root: string): string | undefined => {
  try {
    const realFile = realpathSync(file)
    return contained(realFile, realpathSync(root)) ? realFile : undefined
  } catch {
    return undefined
  }
}

const specPaths = (root: string): string[] => {
  let output = ''
  try {
    output = execFileSync(
      'git',
      ['-C', root, 'ls-files', '--', '*.spec.md', '*.spec.mdx', '*.discovery.md', '*.discovery.mdx', '*.examples.md', '*.examples.mdx'],
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

const listSpecs = (root: string): DocMeta[] =>
  specPaths(root).flatMap((path) => {
    const full = realFileInRoot(join(root, path), root)
    return full ? [toDocMeta(full, path)] : []
  })

const gitIndexPath = (root: string): string | undefined => {
  try {
    const output = execFileSync('git', ['-C', root, 'rev-parse', '--git-path', 'index'], { encoding: 'utf8' }).trim()
    return resolve(root, output)
  } catch {
    return undefined
  }
}

const isGitIndexEntry = (filename: string | Buffer | null) => {
  const entry = filename?.toString()
  return entry === 'index' || entry === 'index.lock'
}

const eventsResponse = (request: Request, root: string) => {
  const dirs = new Set<string>()
  const gitIndex = gitIndexPath(root)
  const planDir = join(root, '.plan')
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
        for (const directory of specPaths(root)
          .map((path) => resolve(root, path, '..'))
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

const resolvedDocumentFile = (file: string, root: string) => {
  try {
    const realFile = realpathSync(file)
    return { file: contained(realFile, realpathSync(root)) ? realFile : undefined, forbidden: !contained(realFile, realpathSync(root)) }
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

const documentResponse = async (root: string, path: string) => {
  if (path.includes('\0') || isAbsolute(path)) {
    return new Response('forbidden', { status: 403 })
  }
  const file = resolve(root, path)
  if (!isAllowed(file, root)) {
    return new Response('forbidden', { status: 403 })
  }
  const resolved = resolvedDocumentFile(file, root)
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
  const result = cachedRender(realFile, { mtimeMs, size }, () => renderDoc({ path: relative(root, realFile), source: bodyBelowHeader(source) }))
  return Response.json({
    degraded: result.degraded ?? null,
    hasMermaid: result.hasMermaid,
    html: result.html,
    meta: metaOf(source, file),
    path: file,
    rootPath: relative(root, file),
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

const serve = (port: number) =>
  Bun.serve({
    development: process.env.NODE_ENV !== 'production',
    async fetch(request) {
      const url = new URL(request.url)

      if (url.pathname === '/api/projects') {
        const { key: _key, ...project } = currentProject()
        return Response.json({ projects: [project] })
      }

      if (url.pathname === '/api/docs') {
        const worktree = worktreeAt(url.searchParams.get('wt') ?? '')
        if (!worktree) {
          return new Response('forbidden', { status: 403 })
        }
        return Response.json({
          plans: buildTree(listPlans(join(worktree, '.plan'), worktree), { flat: true }),
          project: PROJECT.name,
          specs: buildTree(listSpecs(worktree)),
        })
      }

      if (url.pathname === '/api/doc') {
        const worktree = worktreeAt(url.searchParams.get('wt') ?? '')
        return worktree ? documentResponse(worktree, url.searchParams.get('path') ?? '') : new Response('forbidden', { status: 403 })
      }

      if (url.pathname === '/api/events') {
        const worktree = worktreeAt(url.searchParams.get('wt') ?? '')
        return worktree ? eventsResponse(request, worktree) : new Response('forbidden', { status: 403 })
      }

      if (request.method === 'GET' && url.pathname.startsWith('/assets/mermaid/')) {
        return mermaidResponse(url.pathname.slice('/assets/mermaid/'.length))
      }

      return new Response('not found', { status: 404 })
    },
    hostname: '127.0.0.1',
    // /api/events is a long-lived SSE stream with no traffic between file changes.
    idleTimeout: 0,
    port,
    routes: { '/': index },
  })

const server = (() => {
  try {
    return serve(PORT)
  } catch (error) {
    if (PORT !== 0 && typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE') {
      return serve(0)
    }
    throw error
  }
})()
process.stdout.write(`plan-viewer listening on ${server.url.origin}\n`)

if (process.env.PLAN_VIEWER_MANAGED === '1') {
  let stopping = false
  let operations = Promise.resolve()

  const queue = (operation: () => Promise<void>) => {
    operations = operations.then(operation, operation)
    return operations
  }

  const clearOwnedRun = () => updateEntry(PROJECT.key, (entry) => (entry?.pid === process.pid ? { holders: [], port: entry.port } : entry))

  const shouldStopForEmptyRun = async () => {
    let shouldStop = true
    await updateEntry(PROJECT.key, (entry) => {
      if (entry?.pid === process.pid && entry.holders.length > 0) {
        shouldStop = false
        return entry
      }
      return entry?.pid === process.pid ? { holders: [], port: entry.port } : entry
    })
    return shouldStop
  }

  const stop = async () => {
    try {
      await clearOwnedRun()
    } finally {
      process.exit(0)
    }
  }

  const tick = () => {
    void queue(async () => {
      if (stopping) {
        return
      }

      let entry: Awaited<ReturnType<typeof readEntry>> = undefined
      try {
        entry = await readEntry(PROJECT.key)
      } catch {
        await stop()
        return
      }

      if (entry?.pid !== process.pid) {
        await stop()
        return
      }

      if (entry.holders.length === 0 && (await shouldStopForEmptyRun())) {
        process.exit(0)
      }
    })
  }

  const interval = setInterval(tick, 5000)
  const shutdown = () => {
    if (stopping) {
      return
    }
    stopping = true
    clearInterval(interval)
    void queue(stop)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
