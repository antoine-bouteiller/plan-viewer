import { type Element, type Root, type RootContent } from 'hast'
import { type Plugin } from 'unified'
import { visit } from 'unist-util-visit'

import { type RenderState } from './markdown'

const textOf = (node: RootContent): string => {
  if (node.type === 'text') {
    return node.value
  }
  if (node.type === 'element') {
    return node.children.map(textOf).join('')
  }
  return ''
}

const isMermaid = (node: Element) => {
  const classes = node.properties.className
  const classNames: unknown[] = Array.isArray(classes) ? classes : [classes]

  return classNames.includes('language-mermaid') || classNames.includes('language-mmd')
}

const mermaid: Plugin<[RenderState], Root> = (state) => (tree) => {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'pre') {
      return
    }

    const code = node.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code')
    if (!code || !isMermaid(code)) {
      return
    }

    node.properties = { className: ['mermaid'] }
    node.children = [{ type: 'text', value: textOf(code) }]
    state.hasMermaid = true
  })
}

export default mermaid
