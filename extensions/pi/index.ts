import { realpath } from 'node:fs/promises'

import { type ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { acquire, type Viewer } from '../../src/launcher/index.ts'

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const resolveRoot = (cwd: string) => realpath(cwd)

const browserCommand = (url: string): [string, string[]] => {
  if (process.platform === 'darwin') {
    return ['open', [url]]
  }
  if (process.platform === 'win32') {
    return ['explorer.exe', [url]]
  }
  return ['xdg-open', [url]]
}

const planViewerExtension = (pi: ExtensionAPI) => {
  if (process.env.PI_SUBAGENT_OWNER_TOKEN !== undefined) {
    return
  }

  const viewers = new Map<string, Promise<Viewer>>()

  const forget = (root: string, viewer: Promise<Viewer>) => {
    if (viewers.get(root) === viewer) {
      viewers.delete(root)
    }
  }

  const openBrowser = (url: string) => {
    const [command, args] = browserCommand(url)
    void pi.exec(command, args).catch(() => undefined)
  }

  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setStatus('plan-viewer', undefined)
    if (!ctx.isProjectTrusted()) {
      ctx.ui.notify('plan-viewer: untrusted project', 'info')
      return
    }

    try {
      const root = await resolveRoot(ctx.cwd)
      const existing = viewers.get(root)
      const viewer = existing ?? acquire(root, process.pid)
      if (!existing) {
        viewers.set(root, viewer)
      }

      try {
        const handle = await viewer
        ctx.ui.setStatus('plan-viewer', `plan-viewer: ${handle.url}`)
      } catch (error) {
        forget(root, viewer)
        ctx.ui.notify(`plan-viewer: ${errorMessage(error)}`, 'info')
      }
    } catch (error) {
      ctx.ui.notify(`plan-viewer: ${errorMessage(error)}`, 'info')
    }
  })

  pi.on('session_shutdown', async (event) => {
    if (event.reason !== 'quit') {
      return
    }

    const pending = [...viewers.values()]
    viewers.clear()
    const acquired = await Promise.allSettled(pending)
    await Promise.allSettled(acquired.flatMap((result) => (result.status === 'fulfilled' ? [result.value.release()] : [])))
  })

  pi.registerCommand('plan-viewer', {
    description: 'Open the plan viewer',
    handler: async (_args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify('plan-viewer: untrusted project', 'info')
        return
      }

      try {
        const root = await resolveRoot(ctx.cwd)
        const viewer = viewers.get(root)
        if (!viewer) {
          ctx.ui.notify('plan-viewer: not started', 'info')
          return
        }

        try {
          const handle = await viewer
          ctx.ui.setStatus('plan-viewer', `plan-viewer: ${handle.url}`)
          openBrowser(handle.url)
        } catch (error) {
          forget(root, viewer)
          ctx.ui.notify(`plan-viewer: ${errorMessage(error)}`, 'info')
        }
      } catch (error) {
        ctx.ui.notify(`plan-viewer: ${errorMessage(error)}`, 'info')
      }
    },
  })
}

export default planViewerExtension
