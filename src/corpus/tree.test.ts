import { describe, expect, test } from 'bun:test'

import { buildTree, type DocMeta, type DocNode } from './tree'

const doc = (path: string, title: string, options: Omit<DocMeta, 'path' | 'title'> = {}): DocMeta => ({
  path,
  title,
  ...options,
})

const child = (node: DocNode, name: string) => {
  const result = node.children?.find((item) => item.name === name)

  expect(result).toBeDefined()
  return result as DocNode
}

describe('buildTree', () => {
  test('nests documents below directory nodes for their path segments', () => {
    const tree = buildTree([doc('docs/guides/intro.spec.md', 'Introduction'), doc('docs/reference/api.spec.md', 'API')])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'dir', name: 'docs' })
    expect(tree[0].children?.map(({ name, kind }) => ({ kind, name }))).toEqual([
      { kind: 'dir', name: 'guides' },
      { kind: 'dir', name: 'reference' },
    ])
    expect(child(tree[0], 'guides').children?.[0]).toMatchObject({
      kind: 'leaf',
      name: 'Introduction',
      path: 'docs/guides/intro.spec.md',
    })
  })

  test('absorbs an umbrella when every sibling document links to it', () => {
    const tree = buildTree([
      doc('area/area.spec.md', 'Area overview', { kind: 'umbrella', status: 'active' }),
      doc('area/child.spec.md', 'Child', { 'parent-spec': 'area/area.spec.md' }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      kind: 'umbrella',
      name: 'Area overview',
      path: 'area/area.spec.md',
      status: 'active',
    })
    expect(tree[0].children).toEqual([expect.objectContaining({ kind: 'leaf', name: 'Child', path: 'area/child.spec.md' })])
  })

  test('does not absorb an umbrella when a sibling document does not link to it', () => {
    const tree = buildTree([
      doc('area/area.spec.md', 'Area overview', { kind: 'umbrella' }),
      doc('area/linked.spec.md', 'Linked', { 'parent-spec': 'area/area.spec.md' }),
      doc('area/unlinked.spec.md', 'Unlinked'),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'dir', name: 'area', path: undefined })
    expect(child(tree[0], 'Area overview').children).toEqual([expect.objectContaining({ name: 'Linked', path: 'area/linked.spec.md' })])
    expect(tree[0].children).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Unlinked', path: 'area/unlinked.spec.md' })]))
  })

  test('absorbs an umbrella when a companion belongs to a linking sibling spec', () => {
    const tree = buildTree([
      doc('area/area.spec.md', 'Area overview', { kind: 'umbrella' }),
      doc('area/child.spec.md', 'Child', { 'parent-spec': 'area/area.spec.md' }),
      doc('area/child.discovery.md', 'Child discovery'),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'umbrella', name: 'Area overview', path: 'area/area.spec.md' })
    expect(child(tree[0], 'Child').children).toEqual([expect.objectContaining({ kind: 'discovery', path: 'area/child.discovery.md' })])
  })

  test('leaves an umbrella as a document row when its directory has subdirectories', () => {
    const tree = buildTree([
      doc('settings/settings.spec.md', 'Settings', { kind: 'umbrella' }),
      doc('settings/custom-fields/custom-fields.spec.md', 'Custom Fields', { kind: 'umbrella' }),
    ])

    expect(tree[0]).toMatchObject({ kind: 'dir', name: 'settings', path: undefined })
    expect(tree[0].children?.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: 'Custom Fields', path: 'settings/custom-fields/custom-fields.spec.md' },
      { name: 'Settings', path: 'settings/settings.spec.md' },
    ])
  })

  test('uses the first umbrella by path and leaves another as a document row', () => {
    const tree = buildTree([
      doc('area/z.spec.md', 'Later umbrella', { kind: 'umbrella', 'parent-spec': 'area/a.spec.md' }),
      doc('area/a.spec.md', 'First umbrella', { kind: 'umbrella' }),
    ])

    expect(tree[0]).toMatchObject({ kind: 'umbrella', path: 'area/a.spec.md' })
    expect(tree[0].children).toEqual([expect.objectContaining({ kind: 'umbrella', name: 'Later umbrella', path: 'area/z.spec.md' })])
  })

  test('attaches examples then discovery companions beneath their spec', () => {
    const tree = buildTree([doc('guide.spec.md', 'Guide'), doc('guide.discovery.md', 'Guide discovery'), doc('guide.examples.md', 'Guide examples')])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'leaf', name: 'Guide', path: 'guide.spec.md' })
    expect(tree[0].children?.map(({ name, path, kind }) => ({ kind, name, path }))).toEqual([
      { kind: 'examples', name: 'Guide examples', path: 'guide.examples.md' },
      { kind: 'discovery', name: 'Guide discovery', path: 'guide.discovery.md' },
    ])
  })

  test('leaves an orphan companion in its path directory', () => {
    const tree = buildTree([doc('guides/orphan.examples.md', 'Orphan examples')])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'dir', name: 'guides' })
    expect(tree[0].children).toEqual([expect.objectContaining({ kind: 'examples', name: 'Orphan examples', path: 'guides/orphan.examples.md' })])
  })

  test('re-parents a document when its parent-spec is listed', () => {
    const tree = buildTree([doc('parent.spec.md', 'Parent'), doc('child.spec.md', 'Child', { 'parent-spec': 'parent.spec.md' })])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ name: 'Parent', path: 'parent.spec.md' })
    expect(tree[0].children).toEqual([expect.objectContaining({ name: 'Child', path: 'child.spec.md' })])
  })

  test('leaves a document in place when its parent-spec is not listed', () => {
    const tree = buildTree([doc('guides/child.spec.md', 'Child', { 'parent-spec': 'missing.spec.md' })])

    expect(tree[0]).toMatchObject({ kind: 'dir', name: 'guides' })
    expect(tree[0].children).toEqual([expect.objectContaining({ name: 'Child', path: 'guides/child.spec.md' })])
  })

  test('skips a parent-spec move that would create an ancestor cycle', () => {
    const tree = buildTree([doc('a.spec.md', 'A', { 'parent-spec': 'b.spec.md' }), doc('b.spec.md', 'B', { 'parent-spec': 'a.spec.md' })])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ name: 'B', path: 'b.spec.md' })
    expect(tree[0].children).toEqual([expect.objectContaining({ name: 'A', path: 'a.spec.md' })])
  })

  test('compacts a single-child directory chain into one slash-joined row', () => {
    const tree = buildTree([doc('docs/architecture/specs/guide.spec.md', 'Guide')])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'dir', name: 'docs/architecture/specs' })
    expect(tree[0].children).toEqual([expect.objectContaining({ name: 'Guide', path: 'docs/architecture/specs/guide.spec.md' })])
  })

  test('preserves all children when compacting through a directory with a plan index', () => {
    const tree = buildTree([
      doc('docs/area/plan/index.md', 'Plan', { kind: 'plan' }),
      doc('docs/area/plan/a.spec.md', 'A'),
      doc('docs/area/plan/b.spec.md', 'B'),
    ])

    expect(tree).toHaveLength(1)
    const [plan] = tree
    expect(plan).toMatchObject({ kind: 'plan', name: 'docs/area/plan', path: 'docs/area/plan/index.md' })
    expect(plan.children?.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: 'A', path: 'docs/area/plan/a.spec.md' },
      { name: 'B', path: 'docs/area/plan/b.spec.md' },
    ])
  })

  test('drops directory rows in a flat tree while keeping a plan index and its phases', () => {
    const tree = buildTree(
      [
        doc('.plan/area/plan/index.md', 'Plan', { kind: 'plan' }),
        doc('.plan/area/plan/a.md', 'A', { kind: 'phase' }),
        doc('.plan/loose.md', 'Loose', { kind: 'plan' }),
      ],
      { flat: true }
    )

    expect(tree.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: 'Loose', path: '.plan/loose.md' },
      { name: 'Plan', path: '.plan/area/plan/index.md' },
    ])
    expect(tree[1].children?.map(({ path }) => path)).toEqual(['.plan/area/plan/a.md'])
  })

  test('sorts archived umbrella directories after active umbrella directories', () => {
    const tree = buildTree([
      doc('archived/archived.spec.md', 'Archived', { archived: true, kind: 'umbrella' }),
      doc('active/active.spec.md', 'Active', { kind: 'umbrella' }),
    ])

    expect(tree.map(({ path }) => path)).toEqual(['active/active.spec.md', 'archived/archived.spec.md'])
  })

  test('sorts directories first, documents case-insensitively, and archived documents last', () => {
    const tree = buildTree([
      doc('zeta/item.spec.md', 'Item'),
      doc('bravo.spec.md', 'bravo'),
      doc('alpha.spec.md', 'Alpha'),
      doc('old.spec.md', 'Aardvark', { archived: true }),
    ])

    expect(tree.map(({ name, kind, archived }) => ({ archived, kind, name }))).toEqual([
      { archived: undefined, kind: 'dir', name: 'zeta' },
      { archived: undefined, kind: 'leaf', name: 'Alpha' },
      { archived: undefined, kind: 'leaf', name: 'bravo' },
      { archived: true, kind: 'leaf', name: 'Aardvark' },
    ])
  })
})
