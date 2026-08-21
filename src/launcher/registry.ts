import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { lock } from 'proper-lockfile'

export interface ViewerEntry {
  port: number
  pid?: number
  url?: string
  holders: number[]
}
export interface ViewersConfig {
  viewers: Record<string, ViewerEntry>
}

export type EntryMutation = (entry: ViewerEntry | undefined) => ViewerEntry | undefined | Promise<ViewerEntry | undefined>

const lockStaleAfterMs = 10_000
const lockUpdateMs = 3000

export const configPath = () => {
  if (process.env.PLAN_VIEWER_CONFIG) {
    return process.env.PLAN_VIEWER_CONFIG
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'plan-viewer', 'viewers.json')
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException
    if (code === 'EPERM') {
      return true
    }
    if (code === 'ESRCH') {
      return false
    }
    throw error
  }
}

const pruneEntry = (value: unknown): ViewerEntry | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  const entry = value as Partial<ViewerEntry>
  if (typeof entry.port !== 'number' || !Array.isArray(entry.holders)) {
    return undefined
  }

  const holders = entry.holders.filter((pid): pid is number => typeof pid === 'number' && alive(pid))
  const pid = typeof entry.pid === 'number' ? entry.pid : undefined

  if (pid !== undefined && !alive(pid)) {
    return { holders: [], port: entry.port }
  }

  const pruned: ViewerEntry = { holders, port: entry.port }
  if (pid !== undefined) {
    pruned.pid = pid
  }
  if (typeof entry.url === 'string') {
    pruned.url = entry.url
  }
  return pruned
}

const readConfig = async (path: string): Promise<ViewersConfig> => {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { viewers: {} }
    }

    const { viewers } = value as { viewers?: unknown }
    if (typeof viewers !== 'object' || viewers === null || Array.isArray(viewers)) {
      return { viewers: {} }
    }

    const pruned = Object.entries(viewers).reduce<Record<string, ViewerEntry>>((result, [root, entry]) => {
      const viewer = pruneEntry(entry)
      if (viewer) {
        result[root] = viewer
      }
      return result
    }, {})
    return { viewers: pruned }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return { viewers: {} }
    }
    throw error
  }
}

const acquireLock = async (path: string) => {
  await mkdir(dirname(path), { recursive: true })
  return lock(path, {
    lockfilePath: `${path}.lock`,
    realpath: false,
    retries: {
      factor: 1.2,
      maxTimeout: 100,
      minTimeout: 10,
      retries: 140,
    },
    stale: lockStaleAfterMs,
    update: lockUpdateMs,
  })
}

export const readEntry = async (root: string): Promise<ViewerEntry | undefined> => {
  const config = await readConfig(configPath())
  return config.viewers[root]
}

const applyEntry = (config: ViewersConfig, root: string, entry: ViewerEntry | undefined) =>
  entry === undefined ? delete config.viewers[root] : (config.viewers[root] = entry)

export const updateEntry = async (root: string, mutate: EntryMutation): Promise<ViewerEntry | undefined> => {
  const path = configPath()
  const releaseLock = await acquireLock(path)

  try {
    const config = await readConfig(path)
    const entry = await mutate(config.viewers[root])
    applyEntry(config, root, entry)

    const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, JSON.stringify(config))
      await rename(temporaryPath, path)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
    return entry
  } finally {
    await releaseLock()
  }
}
