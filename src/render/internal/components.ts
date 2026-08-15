import { type RootContent } from 'mdast'
import { type MdxFlowExpression, type MdxTextExpression } from 'mdast-util-mdx-expression'
import { type MdxJsxAttribute, type MdxJsxFlowElement, type MdxJsxTextElement } from 'mdast-util-mdx-jsx'
import { type Plugin } from 'unified'
import { visit } from 'unist-util-visit'

import { type RenderState } from './markdown'

type MdxElement = MdxJsxFlowElement | MdxJsxTextElement
type RenderChildren = (children: RootContent[]) => string

const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')

const attributes = (node: MdxElement) => {
  const values = new Map<string, string>()

  for (const attribute of node.attributes) {
    if (attribute.type === 'mdxJsxAttribute' && typeof attribute.value === 'string') {
      values.set(attribute.name, attribute.value)
    }
  }

  return values
}

const attributeMarkup = (node: MdxElement) =>
  node.attributes
    .filter((attribute): attribute is MdxJsxAttribute => attribute.type === 'mdxJsxAttribute' && typeof attribute.value === 'string')
    .filter((attribute) => /^[A-Za-z_:][A-Za-z0-9:_.-]*$/.test(attribute.name))
    .map((attribute) => ` ${attribute.name}="${escape(attribute.value as string)}"`)
    .join('')

const isElement = (node: RootContent, name: string): node is MdxElement =>
  (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === name

const sourceOf = (node: RootContent): string => {
  if ('value' in node && typeof node.value === 'string') {
    return node.value
  }
  if ('children' in node) {
    return node.children.map(sourceOf).join('')
  }
  return ''
}

const unknown = (name: string, children: string, inline: boolean) =>
  `<${inline ? 'span' : 'div'} class="md-unknown" data-component="${escape(name)}">${children}</${inline ? 'span' : 'div'}>`

const componentMarkup = (node: MdxElement, render: RenderChildren, state: RenderState): string => {
  const name = node.name ?? 'unknown'
  const attrs = attributes(node)
  const childHtml = (children: RootContent[]) => render(children)
  const childGroups = (childName: string) => {
    const accepted: MdxElement[] = []
    const remaining: RootContent[] = []

    for (const child of node.children) {
      const isElementChild = isElement(child, childName)
      const isElementParagraph =
        child.type === 'paragraph' &&
        child.children.some((paragraphChild) => isElement(paragraphChild, childName)) &&
        child.children.every(
          (paragraphChild) => isElement(paragraphChild, childName) || (paragraphChild.type === 'text' && /^\s*$/.test(paragraphChild.value))
        )

      if (isElementChild) {
        accepted.push(child)
      } else if (isElementParagraph) {
        accepted.push(...child.children.filter((paragraphChild) => isElement(paragraphChild, childName)))
      } else {
        remaining.push(child)
      }
    }

    return { accepted, remaining }
  }

  switch (name) {
    case 'CodeTabs': {
      const { accepted: tabs, remaining } = childGroups('CodeTab')
      const panels = tabs
        .map((tab, index) => {
          const label = attributes(tab).get('label') ?? `Tab ${index + 1}`
          return `<section class="md-codetab-panel" data-label="${escape(label)}"><h3>${escape(label)}</h3>${childHtml(tab.children)}</section>`
        })
        .join('')
      return `<div class="md-codetabs-wrapper">${panels}${childHtml(remaining)}</div>`
    }

    case 'Comparison': {
      const { accepted: options, remaining } = childGroups('Option')
      const optionMarkup = options
        .map((option, index) => {
          const optionName = attributes(option).get('name') ?? `Option ${index + 1}`
          return `<article class="md-comparison-option" data-name="${escape(optionName)}"><h3>${escape(optionName)}</h3>${childHtml(option.children)}</article>`
        })
        .join('')
      return `<section class="md-comparison"><div class="md-comparison-grid">${optionMarkup}${childHtml(remaining)}</div></section>`
    }

    case 'DecisionMatrix': {
      const score = attrs.get('score') ?? ''
      return `<table class="md-matrix"><tbody><tr><td data-score="${escape(score)}">${childHtml(node.children)}</td></tr></tbody></table>`
    }

    case 'AnnotatedDiff': {
      const { accepted: notes, remaining } = childGroups('MarginNote')
      const noteMarkup = notes
        .map((note, index) => {
          const line = attributes(note).get('line') ?? String(index + 1)
          return `<li class="md-margin-note" data-line="${escape(line)}">${childHtml(note.children)}</li>`
        })
        .join('')
      return `<figure class="md-annotated-diff"><div class="md-annotated-diff-content">${childHtml(remaining)}</div><ol class="md-margin-notes">${noteMarkup}</ol></figure>`
    }

    case 'Flowchart': {
      const { accepted: details, remaining } = childGroups('NodeDetail')
      const detailMarkup = details
        .map((detail, index) => {
          const detailName = attributes(detail).get('name') ?? `Node ${index + 1}`
          return `<section class="md-node-detail" data-name="${escape(detailName)}"><h3>${escape(detailName)}</h3>${childHtml(detail.children)}</section>`
        })
        .join('')
      const diagram = remaining.map(sourceOf).join('')
      state.hasMermaid = true
      return `<div class="md-flowchart"><pre class="mermaid">${escape(diagram)}</pre><div class="md-node-details">${detailMarkup}</div></div>`
    }

    case 'StepRail': {
      const { accepted: steps, remaining } = childGroups('Step')
      const stepMarkup = steps
        .map((step, index) => {
          const title = attributes(step).get('title') ?? `Step ${index + 1}`
          return `<li class="md-step" data-title="${escape(title)}"><h3>${escape(title)}</h3>${childHtml(step.children)}</li>`
        })
        .join('')
      return `<ol class="md-steprail">${stepMarkup}${childHtml(remaining)}</ol>`
    }

    default: {
      if (/^[A-Z]/.test(name)) {
        return unknown(name, childHtml(node.children), node.type === 'mdxJsxTextElement')
      }
      return `<${name}${attributeMarkup(node)}>${childHtml(node.children)}</${name}>`
    }
  }
}

const expressionMarkup = (node: MdxFlowExpression | MdxTextExpression) =>
  `<span class="md-unknown" data-component="expression">${escape(node.value)}</span>`

const components: Plugin<[RenderState, RenderChildren]> = (state, render) => (tree) => {
  visit(tree, (node, index, parent) => {
    if (index === undefined || !parent || !('children' in parent)) {
      return
    }

    const parentChildren = (parent as { children: RootContent[] }).children

    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const element = node as MdxElement
      parentChildren[index] = { type: 'html', value: componentMarkup(element, render, state) }
      element.children = []
    } else if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      parentChildren[index] = {
        type: 'html',
        value: expressionMarkup(node as MdxFlowExpression | MdxTextExpression),
      }
    } else if (node.type === 'mdxjsEsm') {
      parentChildren[index] = {
        type: 'html',
        value: `<span class="md-unknown" data-component="module">${escape((node as unknown as { value: string }).value)}</span>`,
      }
    }
  })
}

export default components
