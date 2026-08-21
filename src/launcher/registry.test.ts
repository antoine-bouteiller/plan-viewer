import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { configPath, readEntry, updateEntry } from './registry'

let directory = ''
let previousConfig: string | undefined = undefined
let previousXdg: string | undefined = undefined

const deadPid = async () => {
  const child = Bun.spawn([process.execPath, '-e', ''])
  await child.exited
  return child.pid
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plan-viewer-registry-'))
  previousConfig = process.env.PLAN_VIEWER_CONFIG
  previousXdg = process.env.XDG_CONFIG_HOME
  process.env.PLAN_VIEWER_CONFIG = join(directory, 'viewers.json')
})

afterEach(async () => {
  if (previousConfig === undefined) {
    delete process.env.PLAN_VIEWER_CONFIG
  } else {
    process.env.PLAN_VIEWER_CONFIG = previousConfig
  }
  if (previousXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME
  } else {
    process.env.XDG_CONFIG_HOME = previousXdg
  }
  await rm(directory, { force: true, recursive: true })
})

describe('viewer registry', () => {
  test('uses the config override, XDG directory, then home default', () => {
    expect(configPath()).toBe(join(directory, 'viewers.json'))

    delete process.env.PLAN_VIEWER_CONFIG
    process.env.XDG_CONFIG_HOME = join(directory, 'xdg')
    expect(configPath()).toBe(join(directory, 'xdg', 'plan-viewer', 'viewers.json'))

    delete process.env.XDG_CONFIG_HOME
    expect(configPath()).toBe(join(homedir(), '.config', 'plan-viewer', 'viewers.json'))
  })

  test('preserves a port when a later update clears a stopped run', async () => {
    await updateEntry('/workspace/one', () => ({ holders: [process.pid], pid: process.pid, port: 4312, url: 'http://localhost:4312' }))
    await updateEntry('/workspace/one', (entry) => ({ holders: [], port: entry?.port ?? 0 }))

    expect(await readEntry('/workspace/one')).toEqual({ holders: [], port: 4312 })
  })

  test('prunes dead holders on reads', async () => {
    const pid = await deadPid()
    await updateEntry('/workspace/one', () => ({ holders: [pid, process.pid], port: 4312 }))

    expect(await readEntry('/workspace/one')).toEqual({ holders: [process.pid], port: 4312 })
  })

  test('reports an entry with a dead pid as stopped while retaining its port', async () => {
    await updateEntry('/workspace/one', async () => ({ holders: [process.pid], pid: await deadPid(), port: 4312, url: 'http://localhost:4312' }))

    expect(await readEntry('/workspace/one')).toEqual({ holders: [], port: 4312 })
  })

  test('serializes concurrent updates to the same root without losing either holder', async () => {
    await Promise.all([
      updateEntry('/workspace/one', async (entry) => ({ holders: [...(entry?.holders ?? []), process.pid], port: entry?.port ?? 4312 })),
      updateEntry('/workspace/one', async (entry) => ({ holders: [...(entry?.holders ?? []), process.pid], port: entry?.port ?? 4312 })),
    ])

    expect(await readEntry('/workspace/one')).toEqual({ holders: [process.pid, process.pid], port: 4312 })
  })

  test('recovers a stale proper-lockfile lock directory under contention', async () => {
    const lockPath = `${configPath()}.lock`
    await mkdir(dirname(lockPath), { recursive: true })
    await mkdir(lockPath)
    const stale = new Date(Date.now() - 11_000)
    await utimes(lockPath, stale, stale)

    await Promise.all([
      updateEntry('/workspace/one', (entry) => ({ holders: [...(entry?.holders ?? []), process.pid], port: entry?.port ?? 4312 })),
      updateEntry('/workspace/one', (entry) => ({ holders: [...(entry?.holders ?? []), process.pid], port: entry?.port ?? 4312 })),
    ])

    expect(await readEntry('/workspace/one')).toEqual({ holders: [process.pid, process.pid], port: 4312 })
  })
})
