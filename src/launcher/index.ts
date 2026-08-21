/* eslint-disable complexity, init-declarations, max-params, no-await-in-loop, typescript/consistent-type-definitions */
import { realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { updateEntry, type ViewerEntry } from './registry.ts'

export type Viewer = {
  url: string
  created: boolean
  release: () => Promise<void>
}

type Claim = { kind: 'adopt'; url: string } | { kind: 'wait' } | { kind: 'create'; port: number }

const announcePrefix = 'plan-viewer listening on '
const startupTimeoutMs = 15_000
const pollIntervalMs = 50
const stderrLimit = 4096
const packageRoot = pathResolve(dirname(fileURLToPath(import.meta.url)), '../..')

const addHolder = (entry: ViewerEntry, holder: number): ViewerEntry =>
  entry.holders.includes(holder) ? entry : { ...entry, holders: [...entry.holders, holder] }

const delay = (milliseconds: number) => new Promise<void>((complete) => setTimeout(complete, milliseconds))

const stderrTail = (stream: ReadableStream<Uint8Array> | null | undefined) => {
  let tail = ''
  if (!stream) {
    return { read: Promise.resolve(), text: () => tail }
  }

  const read = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      tail = `${tail}${decoder.decode(chunk, { stream: true })}`.slice(-stderrLimit)
    }
    tail = `${tail}${decoder.decode()}`.slice(-stderrLimit)
  })().catch(() => undefined)
  return { read, text: () => tail }
}

const launchError = (message: string, stderr: string, cause?: unknown) =>
  new Error(message, { cause: stderr.trim() ? new Error(stderr.trim()) : cause })

const validatedRoot = async (root: string) => {
  try {
    const resolved = await realpath(root)
    const details = await stat(resolved)
    if (!details.isDirectory()) {
      throw new Error('not a directory')
    }
    return resolved
  } catch (error) {
    throw new Error(`cannot resolve root: ${root}`, { cause: error })
  }
}

const claim = async (root: string, holder: number): Promise<Claim> => {
  let result: Claim = { kind: 'wait' }
  await updateEntry(root, (entry) => {
    if (entry?.pid !== undefined) {
      const next = addHolder(entry, holder)
      result = entry.url ? { kind: 'adopt', url: entry.url } : { kind: 'wait' }
      return next
    }

    if (entry && entry.holders.length > 0) {
      result = { kind: 'wait' }
      return addHolder(entry, holder)
    }

    const port = entry?.port ?? 0
    result = { kind: 'create', port }
    return { holders: [holder], port }
  })
  return result
}

const releaseHolder = async (root: string, holder: number) => {
  await updateEntry(root, (entry) => (entry ? { ...entry, holders: entry.holders.filter((candidate) => candidate !== holder) } : entry))
}

const clearFailedRun = async (root: string, pid: number) => {
  await updateEntry(root, (entry) => (entry?.pid === pid ? { holders: [], port: entry.port } : entry))
}

const clearFailedClaim = async (root: string, holder: number) => {
  await updateEntry(root, (entry) => {
    if (entry && entry.pid === undefined && entry.holders.includes(holder)) {
      return { holders: [], port: entry.port }
    }
    return entry
  })
}

const spawnCreator = async (root: string, holder: number, port: number, deadline: number): Promise<string> => {
  const serverEntry = process.env.PLAN_VIEWER_SERVER_ENTRY ?? join(packageRoot, 'src', 'server.ts')
  const command = ['bun', serverEntry, root]
  if (port !== 0) {
    command.push('--port', String(port))
  }

  let child: Bun.Subprocess | undefined
  let diagnostics: ReturnType<typeof stderrTail> | undefined
  try {
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for plan-viewer server to start')
    }
    const spawned = Bun.spawn(command, {
      cwd: packageRoot,
      env: { ...process.env, PLAN_VIEWER_MANAGED: '1' },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    child = spawned
    diagnostics = stderrTail(spawned.stderr)
    await updateEntry(root, (entry) => (entry ? { ...entry, pid: spawned.pid, url: undefined } : entry))

    const announced = new Promise<string>((complete, reject) => {
      const readOutput = async () => {
        const output = spawned.stdout as ReadableStream<Uint8Array> | null | undefined
        if (!output) {
          return
        }
        const decoder = new TextDecoder()
        let pending = ''
        for await (const chunk of output) {
          pending += decoder.decode(chunk, { stream: true })
          const lines = pending.split(/\r?\n/)
          pending = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith(announcePrefix)) {
              complete(line.slice(announcePrefix.length))
              return
            }
          }
        }
        pending += decoder.decode()
        if (pending.startsWith(announcePrefix)) {
          complete(pending.slice(announcePrefix.length))
        }
      }
      void readOutput().catch(reject)
      void spawned.exited.then(() => reject(new Error('server exited before announcing its URL')))
    })

    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error('timed out waiting for plan-viewer server to start')
    }
    const url = await Promise.race([
      announced,
      delay(remaining).then(() => Promise.reject(new Error('timed out waiting for plan-viewer server to start'))),
    ])
    const parsed = new URL(url)
    const announcedPort = Number(parsed.port)
    if (!Number.isInteger(announcedPort) || announcedPort < 1 || announcedPort > 65_535) {
      throw new Error(`server announced an invalid URL: ${url}`)
    }

    const saved = await updateEntry(root, (entry) => (entry?.pid === spawned.pid ? { ...entry, port: announcedPort, url } : entry))
    if (saved?.pid !== spawned.pid || saved.url !== url) {
      throw new Error('plan-viewer server ownership was replaced during startup')
    }
    return url
  } catch (error) {
    if (child) {
      try {
        child.kill()
      } catch {
        void 0
      }
      await child.exited.catch(() => undefined)
      await clearFailedRun(root, child.pid)
      await diagnostics?.read
    }
    await clearFailedClaim(root, holder)
    const message = error instanceof Error ? error.message : 'failed to start plan-viewer server'
    throw launchError(message, diagnostics?.text() ?? '', error)
  }
}

export const acquire = async (root: string, holder: number): Promise<Viewer> => {
  const resolvedRoot = await validatedRoot(root)
  const deadline = Date.now() + startupTimeoutMs

  let created = false
  let url = ''
  while (Date.now() < deadline) {
    const decision = await claim(resolvedRoot, holder)
    if (Date.now() >= deadline) {
      await (decision.kind === 'create' ? clearFailedClaim(resolvedRoot, holder) : releaseHolder(resolvedRoot, holder))
      throw new Error('timed out waiting for plan-viewer server to announce its URL')
    }
    if (decision.kind === 'adopt') {
      const { url: adoptedUrl } = decision
      url = adoptedUrl
      break
    }
    if (decision.kind === 'create') {
      created = true
      url = await spawnCreator(resolvedRoot, holder, decision.port, deadline)
      break
    }

    await delay(Math.min(pollIntervalMs, deadline - Date.now()))
  }

  if (!url) {
    await releaseHolder(resolvedRoot, holder)
    throw new Error('timed out waiting for plan-viewer server to announce its URL')
  }

  let released: Promise<void> | undefined
  return {
    created,
    release: () => {
      released ??= releaseHolder(resolvedRoot, holder)
      return released
    },
    url,
  }
}
