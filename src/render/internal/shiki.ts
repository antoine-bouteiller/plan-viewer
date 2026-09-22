import { type Element, type Root, type RootContent } from 'hast'
import { createHighlighter, type Highlighter } from 'shiki'
import { type Plugin } from 'unified'
import { visit } from 'unist-util-visit'

const languages = ['ts', 'tsx', 'js', 'json', 'yaml', 'bash', 'java', 'kotlin', 'sql', 'diff', 'md']

let highlighter: Highlighter | undefined = undefined

export const ready: Promise<void> = createHighlighter({
  langs: languages,
  themes: ['catppuccin-latte', 'catppuccin-mocha'],
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
        colorReplacements: {
          '#04a5e5': 'var(--status-in-progress)',
          '#179299': 'var(--xref-g)',
          '#1e1e2e': 'var(--code-bg)',
          '#1e66f5': 'var(--status-ready)',
          '#209fb5': '#326c7a',
          '#40a02b': 'var(--status-done)',
          '#4c4f69': 'var(--code-fg)',
          '#6c6f85': 'var(--muted)',
          '#7287fd': '#606a9e',
          '#74c7ec': '#92c3d9',
          '#7c7f93': 'var(--muted)',
          '#8839ef': 'var(--accent)',
          '#89b4fa': 'var(--status-ready)',
          '#89dceb': 'var(--status-in-progress)',
          '#9399b2': 'var(--muted)',
          '#94e2d5': 'var(--xref-g)',
          '#a6adc8': 'var(--muted)',
          '#a6e3a1': 'var(--status-done)',
          '#b4befe': '#bdc3ed',
          '#cba6f7': 'var(--accent)',
          '#cdd6f4': 'var(--code-fg)',
          '#d20f39': 'var(--status-blocked)',
          '#dc8a78': '#946459',
          '#dd7878': '#9a5e56',
          '#df8e1d': 'var(--status-draft)',
          '#e64553': '#995366',
          '#ea76cb': 'var(--xref-oq)',
          '#eba0ac': '#d99ca7',
          '#eff1f5': 'var(--code-bg)',
          '#f2cdcd': '#e6bfba',
          '#f38ba8': 'var(--status-blocked)',
          '#f5c2e7': 'var(--xref-oq)',
          '#f5e0dc': '#ead5cf',
          '#f9e2af': 'var(--status-draft)',
          '#fab387': '#f5b56f',
          '#fe640b': '#995c22',
        },
        lang: language,
        themes: { dark: 'catppuccin-mocha', light: 'catppuccin-latte' },
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
