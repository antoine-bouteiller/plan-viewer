import { execFileSync } from 'node:child_process'

const SPEC_PATHS = ['*.spec.md', '*.spec.mdx', '*.discovery.md', '*.discovery.mdx', '*.examples.md', '*.examples.mdx']

const remoteMain = (root: string): string | undefined => {
  try {
    const refs = execFileSync('git', ['-C', root, 'for-each-ref', '--format=%(refname)', 'refs/remotes'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter((ref) => ref.endsWith('/main'))
    return refs.find((ref) => ref === 'refs/remotes/origin/main') ?? refs[0]
  } catch {
    return undefined
  }
}

export const changedSpecPaths = (root: string): string[] | null => {
  const remote = remoteMain(root)
  if (!remote) {
    return null
  }
  try {
    const base = execFileSync('git', ['-C', root, 'merge-base', 'HEAD', remote], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return execFileSync('git', ['-C', root, 'diff', '--name-only', '-z', base, '--', ...SPEC_PATHS], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean)
  } catch {
    return null
  }
}
