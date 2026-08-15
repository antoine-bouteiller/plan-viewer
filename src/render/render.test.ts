import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { ready, renderDoc } from './index'
import * as markdown from './internal/markdown'

const render = (source: string) => renderDoc({ path: 'fixture.md', source })
const renderMdx = (source: string) => renderDoc({ path: 'fixture.mdx', source })

describe('renderDoc', () => {
  beforeAll(async () => {
    await ready
  })

  test('renders GFM tables', () => {
    const { html } = render(`| Name | Status |
| --- | --- |
| T-003 | Done |`)

    expect(html).toContain('<table>')
  })

  test('assigns unique IDs to repeated headings', () => {
    const { html } = render(`## Repeated heading

## Repeated heading`)

    expect(html).toContain('id="repeated-heading"')
    expect(html).toContain('id="repeated-heading-2"')
  })

  test('includes H2 and H3 entries in the table of contents in document order', () => {
    const { toc } = render(`## First section

### First detail

#### Excluded detail

## Second section`)

    expect(toc).toEqual([
      { depth: 2, id: 'first-section', text: 'First section' },
      { depth: 3, id: 'first-detail', text: 'First detail' },
      { depth: 2, id: 'second-section', text: 'Second section' },
    ])
  })

  test('assigns H4 headings IDs without adding them to the table of contents', () => {
    const { html, toc } = render('#### Deep section')

    expect(html).toContain('id="deep-section"')
    expect(toc).toEqual([])
  })

  test('renders bare cross-reference IDs as chips', () => {
    const { html } = render('See AC-001 for acceptance criteria.')

    expect(html).toContain('<button class="xref-chip" data-kind="ac" data-ref="AC-001" title="Copy AC-001" type="button">AC-001</button>')
  })

  test('renders bracketed cross-reference code spans as chips', () => {
    const { html } = render('See `[KD-3.1]` for details.')

    expect(html).toContain('class="xref-chip"')
    expect(html).toContain('data-kind="kd"')
    expect(html).toContain('data-ref="KD-3.1"')
  })

  test('leaves cross-reference IDs in fenced code blocks untouched', () => {
    const { html } = render('```text\nAC-001\n```')

    expect(html).toContain('AC-001')
    expect(html).not.toContain('xref-chip')
  })

  test('syntax highlights TypeScript fences with both themes', () => {
    const { html } = render('```ts\nconst answer: number = 42\n```')

    expect(html).toContain('class="shiki')
    expect(html).toContain('background-color:')
    expect(html).toContain('--shiki-dark')
  })

  test('renders Mermaid fences as client-renderable placeholders', () => {
    const { hasMermaid, html } = render('```mermaid\ngraph TD\n  A --> B\n```')

    expect(hasMermaid).toBe(true)
    expect(html).toContain('<pre class="mermaid">graph TD\n  A --> B\n</pre>')
  })

  test('renders mmd fences as client-renderable placeholders', () => {
    const { hasMermaid, html } = render('```mmd\ngraph LR\n  A --> B\n```')

    expect(hasMermaid).toBe(true)
    expect(html).toContain('<pre class="mermaid">graph LR\n  A --> B\n</pre>')
  })

  test('does not mark TypeScript-only documents as containing Mermaid', () => {
    const { hasMermaid, html } = render('```ts\nconst answer: number = 42\n```')

    expect(hasMermaid).toBe(false)
    expect(html).toContain('class="shiki')
  })

  test('does not leak Mermaid state between renders', () => {
    render('```mermaid\ngraph TD\n  A --> B\n```')
    const result = render('Plain text')

    expect(result.hasMermaid).toBe(false)
  })

  test('leaves unknown fence languages as escaped plain code', () => {
    const { html } = render('```brainfuck\n+++.\n```')

    expect(html).toMatch(/<pre><code(?: [^>]*)?>\+\+\+\.\n<\/code><\/pre>/)
    expect(html).not.toContain('class="shiki')
  })

  test('escapes script-like fence content', () => {
    const { html } = render('```brainfuck\n<script>alert(1)</script>\n```')

    expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>')
    expect(html).not.toContain('<script>')
  })

  test('bridges CodeTabs into labelled tab panels', () => {
    const { html } = renderMdx('<CodeTabs><CodeTab label="TypeScript">Tab content</CodeTab></CodeTabs>')

    expect(html).toContain('<div class="md-codetabs-wrapper">')
    expect(html).toContain('<section class="md-codetab-panel" data-label="TypeScript">')
    expect(html).toContain('Tab content')
  })

  test('bridges Comparison into a comparison section and grid', () => {
    const { html } = renderMdx('<Comparison><Option name="First">Option content</Option></Comparison>')

    expect(html).toContain('<section class="md-comparison">')
    expect(html).toContain('<div class="md-comparison-grid">')
    expect(html).toContain('Option content')
  })

  test('bridges DecisionMatrix into a scored matrix table', () => {
    const { html } = renderMdx('<DecisionMatrix score="5">Matrix content</DecisionMatrix>')

    expect(html).toContain('<table class="md-matrix">')
    expect(html).toContain('<td data-score="5">')
    expect(html).toContain('Matrix content')
  })

  test('bridges AnnotatedDiff into an annotated figure with margin notes', () => {
    const { html } = renderMdx('<AnnotatedDiff>Diff content<MarginNote line="3">Note content</MarginNote></AnnotatedDiff>')

    expect(html).toContain('<figure class="md-annotated-diff">')
    expect(html).toContain('<ol class="md-margin-notes">')
    expect(html).toContain('Diff content')
    expect(html).toContain('Note content')
  })

  test('bridges Flowchart into Mermaid markup and node details', () => {
    const { hasMermaid, html } = renderMdx('<Flowchart>graph TD\nA --> B<NodeDetail name="A">Node content</NodeDetail></Flowchart>')

    expect(hasMermaid).toBe(true)
    expect(html).toContain('<div class="md-flowchart">')
    expect(html).toContain('<pre class="mermaid">graph TD\nA --&gt; B</pre>')
    expect(html).toContain('<div class="md-node-details">')
    expect(html).toContain('Node content')
  })

  test('bridges StepRail into an ordered step list', () => {
    const { html } = renderMdx('<StepRail><Step title="First">Step content</Step></StepRail>')

    expect(html).toContain('<ol class="md-steprail">')
    expect(html).toContain('<li class="md-step" data-title="First">')
    expect(html).toContain('Step content')
  })

  test('degrades unknown MDX components while preserving children', () => {
    const { html } = renderMdx('<FeatureViewer>\n\nFeature content\n\n</FeatureViewer>')

    expect(html).toContain('<div class="md-unknown" data-component="FeatureViewer">')
    expect(html).toContain('Feature content')
  })

  test('keeps unknown inline MDX components inside their paragraph', () => {
    const { html } = renderMdx('before <FeatureViewer>child</FeatureViewer> after')

    expect(html).toContain('<p>before <span class="md-unknown" data-component="FeatureViewer">child</span> after</p>')
  })

  test('orders headings in bridged component children and assigns unique IDs', () => {
    const { html, toc } = renderMdx(`## Before

<StepRail>
<Step title="First">

## Repeated

</Step>
</StepRail>

## Repeated`)
    const ids = [...html.matchAll(/id="(?<id>[^"]+)"/g)].map((match) => match.groups?.id ?? '')

    expect(toc).toEqual([
      { depth: 2, id: 'before', text: 'Before' },
      { depth: 2, id: 'repeated', text: 'Repeated' },
      { depth: 2, id: 'repeated-2', text: 'Repeated' },
    ])
    expect(ids).toEqual(['before', 'repeated', 'repeated-2'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('degrades MDX expressions while preserving their source', () => {
    const { html } = renderMdx('{someExpression}')

    expect(html).toContain('<span class="md-unknown" data-component="expression">someExpression</span>')
  })

  test('preserves inline code containing angle brackets in MDX', () => {
    const { html } = renderMdx('`List<String>`')

    expect(html).toContain('<code>List&#x3C;String></code>')
    expect(html).not.toContain('md-unknown')
  })

  test('does not bridge JSX-like markup in Markdown documents', () => {
    const { html } = render('<StepRail>x</StepRail>')

    expect(html).toContain('<StepRail>x</StepRail>')
    expect(html).not.toContain('md-steprail')
    expect(html).not.toContain('md-unknown')
  })

  test('degrades an MDX parse failure to plain markdown', () => {
    const source = 'The prose before the component remains readable.\n\n<StepRail>'
    const result = renderMdx(source)

    expect(result.degraded?.reason).toBe('mdx-parse')
    expect(result.html).toContain('The prose before the component remains readable.')
    expect(result.html).toContain('class="md-degraded"')
  })

  test('does not throw for an MDX parse failure', () => {
    expect(() => renderMdx('Prose\n\n<StepRail>')).not.toThrow()
  })

  test('degrades to escaped source when the markdown pipeline throws', () => {
    const pipeline = spyOn(markdown, 'markdownProcessor').mockImplementation(() => {
      throw new Error('pipeline unavailable')
    })

    try {
      const source = '<script>alert("failure")</script>'

      expect(() => render(source)).not.toThrow()

      const result = render(source)
      expect(result.html).toContain('class="md-degraded"')
      expect(result.html).toContain('&lt;script&gt;alert(&quot;failure&quot;)&lt;/script&gt;')
      expect(result.degraded?.reason).toBe('mdx-parse')
    } finally {
      pipeline.mockRestore()
    }
  })

  test('tags relative document links with their worktree-relative target', () => {
    const { html } = renderDoc({
      path: 'plan-viewer/spec/viewer.spec.md',
      source: '[leaf](document-render.spec.md) [up](../../other/x.spec.mdx#s) [web](https://example.com/a.md)',
    })

    expect(html).toContain('data-doc="plan-viewer/spec/document-render.spec.md"')
    expect(html).toContain('data-doc="other/x.spec.mdx"')
    expect(html).not.toContain('data-doc="https')
  })

  test('leaves unknown cross-reference prefixes untouched', () => {
    const { html } = render('ZZ-001')

    expect(html).toContain('ZZ-001')
    expect(html).not.toContain('xref-chip')
  })

  test('renders known but unmapped cross-reference prefixes as other chips', () => {
    const { html } = render('FR-002')

    expect(html).toContain('class="xref-chip"')
    expect(html).toContain('data-kind="other"')
    expect(html).toContain('data-ref="FR-002"')
  })
})
