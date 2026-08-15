import { markdownProcessor } from './internal/markdown'

export { ready } from './internal/shiki'

interface TocEntry {
  id: string
  text: string
  depth: number
}

export interface RenderResult {
  html: string
  toc: TocEntry[]
  hasMermaid: boolean
  degraded?: { reason: 'mdx-parse'; message: string; line: number }
}

const escaped = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const degradedBanner = '<div class="md-degraded">MDX parsing failed; this document is shown as plain markdown.</div>'

const failureDetails = (error: unknown) => {
  const details =
    typeof error === 'object' && error !== null
      ? (error as { line?: unknown; message?: unknown; place?: { line?: unknown; start?: { line?: unknown } } })
      : undefined
  const line = details?.line ?? details?.place?.line ?? details?.place?.start?.line
  let message = 'Unknown render failure'

  const { message: detailMessage } = details ?? {}
  if (typeof detailMessage === 'string') {
    message = detailMessage
  } else if (typeof error === 'string') {
    message = error
  }

  return { line: typeof line === 'number' ? line : 0, message }
}

const render = (source: string, path: string) => {
  const state = { hasMermaid: false, toc: [] as TocEntry[], used: new Set<string>() }
  const html = String(markdownProcessor(state, path).processSync(source))
  const seen = new Set<string>()
  const toc = state.toc
    .map((entry) => ({ entry, position: html.indexOf(`id="${entry.id}"`) }))
    .filter(({ entry, position }) => {
      if (position === -1 || seen.has(entry.id)) {
        return false
      }
      seen.add(entry.id)
      return true
    })
    .toSorted((left, right) => left.position - right.position)
    .map(({ entry }) => entry)

  return { hasMermaid: state.hasMermaid, html, toc }
}

export const renderDoc = (input: { path: string; source: string }): RenderResult => {
  try {
    return render(input.source, input.path)
  } catch (error) {
    const degraded = { reason: 'mdx-parse' as const, ...failureDetails(error) }
    const markdownPath = input.path.endsWith('.mdx') ? input.path.slice(0, -1) : input.path

    try {
      const result = render(input.source, markdownPath)

      return { ...result, degraded, html: `${degradedBanner}${result.html}` }
    } catch {
      return {
        degraded,
        hasMermaid: false,
        html: `${degradedBanner}<pre>${escaped(input.source)}</pre>`,
        toc: [],
      }
    }
  }
}
