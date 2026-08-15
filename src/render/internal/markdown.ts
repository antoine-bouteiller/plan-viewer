import { type RootContent } from 'mdast'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

import components from './components'
import docLinks from './doclinks'
import headings, { type HeadingState } from './headings'
import mermaid from './mermaid'
import shiki from './shiki'
import xrefs from './xrefs'

export type RenderState = HeadingState & {
  hasMermaid: boolean
}

export const markdownProcessor = (state: RenderState, path: string) => {
  const renderChildren = (children: RootContent[]) => {
    const processor = markdownProcessor(state, path)
    const tree = processor.runSync({ children, type: 'root' })

    return processor.stringify(tree)
  }

  const processor = unified().use(remarkParse).use(remarkGfm)

  if (path.endsWith('.mdx')) {
    processor.use(remarkMdx).use(components, state, renderChildren)
  }

  return processor
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(headings, state)
    .use(docLinks, path)
    .use(mermaid, state)
    .use(shiki)
    .use(xrefs)
    .use(rehypeStringify, { allowDangerousHtml: true })
}
