import { type Element, type Root, type RootContent } from 'hast'
import { type Plugin } from 'unified'
import { visit } from 'unist-util-visit'

export interface HeadingState {
  toc: { id: string; text: string; depth: number }[]
  used: Set<string>
}

const textOf = (node: RootContent): string => {
  if (node.type === 'text') {
    return node.value
  }
  if (node.type === 'element') {
    return node.children.map(textOf).join('')
  }
  if (node.type === 'raw') {
    return node.value.replaceAll(/<[^>]*>/g, '')
  }
  return ''
}

const slug = (text: string) =>
  text
    .replaceAll(/<[^>]*>/g, '')
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, '')
    .trim()
    .replaceAll(/\s+/g, '-') || 'section'

const headings: Plugin<[HeadingState], Root> = (state) => (tree) => {
  visit(tree, 'element', (node: Element) => {
    const match = /^h(?<depth>[1-6])$/.exec(node.tagName)
    if (!match) {
      return
    }

    const depth = Number(match.groups?.depth)
    const text = node.children.map(textOf).join('')
    const base = slug(text)
    let id = base
    for (let number = 2; state.used.has(id); number++) {
      id = `${base}-${number}`
    }
    state.used.add(id)
    node.properties.id = id

    if (depth <= 3) {
      state.toc.push({ depth, id, text })
    }
  })
}

export default headings
