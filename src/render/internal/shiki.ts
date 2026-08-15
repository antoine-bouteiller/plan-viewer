import { type Element, type Root, type RootContent } from 'hast'
import { createHighlighter, type Highlighter } from 'shiki'
import { type Plugin } from 'unified'
import { visit } from 'unist-util-visit'

const languages = ['ts', 'tsx', 'js', 'json', 'yaml', 'bash', 'java', 'kotlin', 'sql', 'diff', 'md']

let highlighter: Highlighter | undefined = undefined

export const ready: Promise<void> = createHighlighter({
  langs: languages,
  themes: ['github-light', 'github-dark'],
})
  .then((instance) => {
    highlighter = instance
  })
  .catch(() => {
    highlighter = undefined
  })

const textOf = (node: RootContent): string => {
  if (node.type === 'text') {
    return node.value
  }
  if (node.type === 'element') {
    return node.children.map(textOf).join('')
  }
  return ''
}

const languageOf = (node: Element): string | undefined => {
  const classes = node.properties.className
  const classNames = Array.isArray(classes) ? classes : []
  const language = classNames.find((className): className is string => typeof className === 'string' && className.startsWith('language-'))

  return language?.slice('language-'.length)
}

const shiki: Plugin<[], Root> = () => (tree) => {
  const instance = highlighter
  if (!instance) {
    return
  }

  visit(tree, 'element', (node: Element, index, parent) => {
    if (node.tagName !== 'pre' || index === undefined || !parent) {
      return
    }

    const code = node.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code')
    const language = code && languageOf(code)
    if (!code || !language) {
      return
    }

    try {
      const highlighted = instance.codeToHast(textOf(code), {
        lang: language,
        themes: { dark: 'github-dark', light: 'github-light' },
      })
      const pre = highlighted.children.find((child): child is Element => child.type === 'element' && child.tagName === 'pre')

      if (pre) {
        parent.children[index] = pre
      }
    } catch {
      // Leave unsupported or malformed fences unhighlighted.
    }
  })
}

export default shiki
