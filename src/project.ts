import { execFileSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

interface Worktree {
  name: string
  main: boolean
  path: string
}

export interface Project {
  key: string
  name: string
  path: string
  worktrees: Worktree[]
}

export const projectOf = (root: string): Project => {
  const resolvedRoot = realpathSync(root)
  if (!statSync(resolvedRoot).isDirectory()) {
    throw new Error('not a directory')
  }

  let common = ''
  try {
    common = execFileSync('git', ['-C', resolvedRoot, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return {
      key: resolvedRoot,
      name: basename(resolvedRoot),
      path: resolvedRoot,
      worktrees: [{ main: true, name: basename(resolvedRoot), path: resolvedRoot }],
    }
  }

  const key = realpathSync(resolve(resolvedRoot, common))
  const output = execFileSync('git', ['-C', resolvedRoot, 'worktree', 'list', '--porcelain', '-z'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const worktrees = output
    .trim()
    .split('\0\0')
    .map((block) => block.replaceAll('\0', '\n'))
    .flatMap((block, index): Worktree[] => {
      const path = /^worktree (?<path>.+)$/m.exec(block)?.groups?.path
      const branch = /^branch refs\/heads\/(?<branch>.+)$/m.exec(block)?.groups?.branch
      if (!path) {
        return []
      }
      try {
        const resolvedPath = realpathSync(path)
        return [{ main: index === 0, name: branch ?? basename(resolvedPath), path: resolvedPath }]
      } catch {
        return []
      }
    })
  const main = worktrees.find((worktree) => worktree.main) ?? worktrees[0]
  if (!main) {
    throw new Error('project has no worktrees')
  }
  return { key, name: basename(main.path), path: main.path, worktrees }
}
