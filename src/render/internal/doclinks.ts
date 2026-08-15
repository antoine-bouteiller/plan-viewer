import { type Element, type Root } from 'hast'
import { type Plugin } from 'unified'
import { visit } from 'unist-util-visit'

const DOC_HREF = /^(?<target>[^#?:]+\.mdx?)(?:#.*)?$/

const resolveFrom = (docPath: string, target: string) => {
  const segments = docPath.split('/').slice(0, -1)
  let escapes = false

  for (const segment of target.split('/').filter((part) => part !== '' && part !== '.')) {
    if (segment !== '..') {
      segments.push(segment)
    } else if (segments.length > 0) {
      segments.pop()
    } else {
      escapes = true
    }
  }

  return escapes ? null : segments.join('/')
}

// Relative links between corpus documents become in-app navigation targets; the client reads data-doc.
const docLinks: Plugin<[string], Root> = (docPath) => (tree) => {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'a' || typeof node.properties.href !== 'string' || node.properties.href.startsWith('/')) {
      return
    }

    const match = DOC_HREF.exec(node.properties.href)
    const target = match?.groups?.target
    if (!target) {
      return
    }

    const resolved = resolveFrom(docPath, target)
    if (resolved) {
      node.properties.dataDoc = resolved
    }
  })
}

export default docLinks
