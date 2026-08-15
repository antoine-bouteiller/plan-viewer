import { type Element, type Root, type RootContent, type Text } from 'hast'
import { type Plugin } from 'unified'

const ID_KINDS = new Set(['g', 'ng', 'ac', 't', 'kd', 'oq'])
const ID_PATTERN = /\b(?<prefix>G|NG|AC|T|KD|OQ|FR|NFR|US|SC|EC|VC)-(?<number>\d{1,4})\b/g
const BRACKETED_ID = /^\[(?<prefix>[A-Z]+)-(?<number>\d+(?:\.\d+)?)\]$/

const chip = (id: string, prefix: string): Element => ({
  children: [{ type: 'text', value: id }],
  properties: {
    className: ['xref-chip'],
    dataKind: ID_KINDS.has(prefix.toLowerCase()) ? prefix.toLowerCase() : 'other',
    dataRef: id,
    title: `Copy ${id}`,
    type: 'button',
  },
  tagName: 'button',
  type: 'element',
})

const chipify = (node: Text): RootContent[] => {
  const children: RootContent[] = []
  let offset = 0

  for (const match of node.value.matchAll(ID_PATTERN)) {
    const [id] = match
    const prefix = match.groups?.prefix
    const index = match.index ?? 0

    if (index > offset) {
      children.push({ type: 'text', value: node.value.slice(offset, index) })
    }
    if (prefix) {
      children.push(chip(id, prefix))
    }
    offset = index + id.length
  }

  if (offset === 0) {
    return [node]
  }
  if (offset < node.value.length) {
    children.push({ type: 'text', value: node.value.slice(offset) })
  }

  return children
}

const textOf = (node: RootContent): string => {
  if (node.type === 'text') {
    return node.value
  }
  if (node.type === 'element') {
    return node.children.map(textOf).join('')
  }
  return ''
}

const xrefs: Plugin<[], Root> = () => (tree) => {
  const walk = (parent: Root | Element, protectedContent = false) => {
    for (let index = 0; index < parent.children.length; index++) {
      const node = parent.children[index]

      if (node.type === 'text') {
        if (!protectedContent) {
          const children = chipify(node)
          parent.children.splice(index, 1, ...children)
          index += children.length - 1
        }
      } else if (node.type === 'element') {
        const match = node.tagName === 'code' && !protectedContent ? BRACKETED_ID.exec(textOf(node)) : undefined
        if (match?.groups?.prefix) {
          parent.children[index] = chip(node.children.map(textOf).join('').slice(1, -1), match.groups.prefix)
        } else {
          walk(node, protectedContent || node.tagName === 'code' || node.tagName === 'pre')
        }
      }
    }
  }

  walk(tree)
}

export default xrefs
