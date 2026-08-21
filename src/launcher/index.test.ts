/* eslint-disable complexity, init-declarations, no-await-in-loop, unicorn/no-await-expression-member, unicorn/numeric-separators-style */
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquire, type Viewer } from './index'
import { readEntry } from './registry'

const waitFor = async (condition: () => boolean | Promise<boolean>, timeout = 10_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await condition()) {
      return
    }
    await Bun.sleep(50)
  }
  if (await condition()) {
    return
  }
  throw new Error(`condition was not met within ${timeout}ms`)
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const stop = async (pid: number) => {
  if (!alive(pid)) {
    return
  }
  try {
    process.kill(pid)
  } catch {
    return
  }
  try {
    await waitFor(() => !alive(pid), 1_000)
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      return
    }
    await waitFor(() => !alive(pid))
  }
}

const rejected = async (operation: () => Promise<unknown>) => {
  try {
    await operation()
  } catch (error) {
    return error
  }
  throw new Error('operation unexpectedly succeeded')
}

test(
  'acquires, shares, releases, restarts, and cleans up plan-viewer servers',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'plan-viewer-launcher-'))
    const root = join(directory, 'root')
    const earlyExitRoot = join(directory, 'early-exit-root')
    const timeoutRoot = join(directory, 'timeout-root')
    const pathlessRoot = join(directory, 'pathless-root')
    const config = join(directory, 'viewers.json')
    const earlyExitServer = join(directory, 'exits-before-announcing.ts')
    const timeoutServer = join(directory, 'never-announces.ts')
    const earlyExitPidPath = join(directory, 'early-exit.pid')
    const timeoutPidPath = join(directory, 'timeout.pid')
    const previousConfig = process.env.PLAN_VIEWER_CONFIG
    const previousPath = process.env.PATH
    const previousServerEntry = process.env.PLAN_VIEWER_SERVER_ENTRY
    const viewers: Viewer[] = []
    const serverPids = new Set<number>()
    const childPidPaths = [earlyExitPidPath, timeoutPidPath]
    let registryRoot = root
    let registryEarlyExitRoot = earlyExitRoot
    let registryTimeoutRoot = timeoutRoot
    let registryPathlessRoot = pathlessRoot
    let helper: Bun.Subprocess | undefined

    process.env.PLAN_VIEWER_CONFIG = config
    delete process.env.PLAN_VIEWER_SERVER_ENTRY
    try {
      await Promise.all([mkdir(root), mkdir(earlyExitRoot), mkdir(timeoutRoot), mkdir(pathlessRoot)])
      ;[registryRoot, registryEarlyExitRoot, registryTimeoutRoot, registryPathlessRoot] = await Promise.all([
        realpath(root),
        realpath(earlyExitRoot),
        realpath(timeoutRoot),
        realpath(pathlessRoot),
      ])

      const first = await acquire(root, process.pid)
      viewers.push(first)
      expect(first.created).toBe(true)
      const firstResponse = await fetch(`${first.url}/api/docs`)
      expect(firstResponse.status).toBe(200)
      expect((await firstResponse.json()).project).toBe('root')
      const firstEntry = await readEntry(registryRoot)
      expect(firstEntry).toEqual({
        holders: [process.pid],
        pid: firstEntry?.pid,
        port: Number(new URL(first.url).port),
        url: first.url,
      })
      expect(firstEntry?.pid).toBeNumber()
      if (firstEntry?.pid !== undefined) {
        serverPids.add(firstEntry.pid)
      }

      helper = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'])
      const second = await acquire(root, helper.pid)
      viewers.push(second)
      expect(second).toEqual(expect.objectContaining({ created: false, url: first.url }))
      expect((await readEntry(registryRoot))?.holders).toEqual([process.pid, helper.pid])

      await first.release()
      const secondResponse = await fetch(`${second.url}/api/docs`)
      expect(secondResponse.status).toBe(200)
      expect((await readEntry(registryRoot))?.holders).toEqual([helper.pid])

      await second.release()
      await waitFor(() => !alive(firstEntry?.pid ?? 0))
      await waitFor(async () => {
        const entry = await readEntry(registryRoot)
        return entry?.pid === undefined && entry?.url === undefined && entry?.holders.length === 0
      })
      const stopped = await readEntry(registryRoot)
      expect(stopped).toEqual({ holders: [], port: Number(new URL(first.url).port) })

      const restarted = await acquire(root, process.pid)
      viewers.push(restarted)
      expect(restarted.created).toBe(true)
      expect(new URL(restarted.url).port).toBe(new URL(first.url).port)
      const restartedEntry = await readEntry(registryRoot)
      if (restartedEntry?.pid !== undefined) {
        serverPids.add(restartedEntry.pid)
      }
      await restarted.release()
      await waitFor(() => !alive(restartedEntry?.pid ?? 0))

      await writeFile(
        earlyExitServer,
        `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(earlyExitPidPath)}, String(process.pid))\nprocess.stderr.write('intentional early-exit launcher test failure\\n')\nprocess.exitCode = 1\n`
      )
      process.env.PLAN_VIEWER_SERVER_ENTRY = earlyExitServer
      const earlyExitFailure = await rejected(() => acquire(earlyExitRoot, process.pid))
      const earlyExitPid = Number(await readFile(earlyExitPidPath, 'utf8'))
      expect(earlyExitFailure).toBeInstanceOf(Error)
      expect((earlyExitFailure as Error).cause).toBeInstanceOf(Error)
      expect(((earlyExitFailure as Error).cause as Error).message).toContain('intentional early-exit launcher test failure')
      await waitFor(() => !alive(earlyExitPid))
      expect(await readEntry(registryEarlyExitRoot)).toEqual({ holders: [], port: 0 })

      await writeFile(
        timeoutServer,
        `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(timeoutPidPath)}, String(process.pid))\nprocess.stderr.write('intentional never-announce launcher test failure\\n')\nsetInterval(() => {}, 1000)\n`
      )
      process.env.PLAN_VIEWER_SERVER_ENTRY = timeoutServer
      const timeoutFailure = await rejected(() => acquire(timeoutRoot, process.pid))
      const timeoutPid = Number(await readFile(timeoutPidPath, 'utf8'))
      expect(timeoutFailure).toBeInstanceOf(Error)
      expect((timeoutFailure as Error).message).toContain('timed out waiting for plan-viewer server to start')
      expect((timeoutFailure as Error).cause).toBeInstanceOf(Error)
      expect(((timeoutFailure as Error).cause as Error).message).toContain('intentional never-announce launcher test failure')
      await waitFor(() => !alive(timeoutPid))
      expect(await readEntry(registryTimeoutRoot)).toEqual({ holders: [], port: 0 })

      delete process.env.PLAN_VIEWER_SERVER_ENTRY
      const emptyPath = join(directory, 'empty-path')
      await mkdir(emptyPath)
      process.env.PATH = emptyPath
      let pathlessFailure: unknown
      try {
        pathlessFailure = await rejected(() => acquire(pathlessRoot, process.pid))
      } finally {
        if (previousPath === undefined) {
          delete process.env.PATH
        } else {
          process.env.PATH = previousPath
        }
      }
      expect(pathlessFailure).toBeInstanceOf(Error)
      expect((pathlessFailure as Error).cause).toBeInstanceOf(Error)
      expect(await readEntry(registryPathlessRoot)).toEqual({ holders: [], port: 0 })
    } finally {
      try {
        await Promise.allSettled(viewers.map(async (viewer) => viewer.release()))
        const entries = await Promise.all(
          [registryRoot, registryEarlyExitRoot, registryTimeoutRoot, registryPathlessRoot].map(async (rootPath) =>
            readEntry(rootPath).catch(() => undefined)
          )
        )
        for (const entry of entries) {
          if (entry?.pid !== undefined) {
            serverPids.add(entry.pid)
          }
        }
        const childPids = await Promise.all(childPidPaths.map(async (path) => Number(await readFile(path, 'utf8').catch(() => '0'))))
        for (const pid of childPids) {
          if (pid > 0) {
            serverPids.add(pid)
          }
        }
        const cleanup = [...serverPids].map((pid) => stop(pid))
        if (helper) {
          const child = helper
          cleanup.push(
            (async () => {
              await stop(child.pid)
              await child.exited.catch(() => undefined)
            })()
          )
        }
        await Promise.allSettled(cleanup)
      } finally {
        try {
          if (previousConfig === undefined) {
            delete process.env.PLAN_VIEWER_CONFIG
          } else {
            process.env.PLAN_VIEWER_CONFIG = previousConfig
          }
          if (previousPath === undefined) {
            delete process.env.PATH
          } else {
            process.env.PATH = previousPath
          }
          if (previousServerEntry === undefined) {
            delete process.env.PLAN_VIEWER_SERVER_ENTRY
          } else {
            process.env.PLAN_VIEWER_SERVER_ENTRY = previousServerEntry
          }
        } finally {
          await rm(directory, { force: true, recursive: true })
        }
      }
    }
  },
  { timeout: 55_000 }
)
