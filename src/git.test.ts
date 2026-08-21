import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { changedSpecPaths } from './git'

const directories: string[] = []

const repository = () => {
  const root = mkdtempSync(join(tmpdir(), 'plan-viewer-git-'))
  directories.push(root)
  execFileSync('git', ['init', '-qb', 'main', root])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'plan-viewer@example.test'])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Plan Viewer Test'])
  return root
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('changedSpecPaths', () => {
  test('returns committed and working-tree spec changes from a remote main ref', () => {
    const root = repository()
    writeFileSync(join(root, 'first.spec.md'), 'first\n')
    writeFileSync(join(root, 'second.spec.md'), 'second\n')
    writeFileSync(join(root, 'remote-only.spec.md'), 'remote only\n')
    writeFileSync(join(root, 'README.md'), 'readme\n')
    execFileSync('git', ['-C', root, 'add', '.'])
    execFileSync('git', ['-C', root, 'commit', '-qm', 'base'])

    execFileSync('git', ['-C', root, 'switch', '-qc', 'remote-update'])
    writeFileSync(join(root, 'remote-only.spec.md'), 'changed only on remote main\n')
    execFileSync('git', ['-C', root, 'commit', '-qam', 'advance remote main'])
    execFileSync('git', ['-C', root, 'update-ref', 'refs/remotes/upstream/main', 'HEAD'])
    execFileSync('git', ['-C', root, 'switch', '-q', 'main'])

    writeFileSync(join(root, 'first.spec.md'), 'changed in working tree\n')
    writeFileSync(join(root, 'second.spec.md'), 'changed in commit\n')
    writeFileSync(join(root, 'README.md'), 'not a spec\n')
    execFileSync('git', ['-C', root, 'add', 'second.spec.md'])
    execFileSync('git', ['-C', root, 'commit', '-qm', 'change second spec'])

    expect(changedSpecPaths(root)?.toSorted()).toEqual(['first.spec.md', 'second.spec.md'])
  })

  test('reports when no remote main ref exists', () => {
    expect(changedSpecPaths(repository())).toBeNull()
  })
})
