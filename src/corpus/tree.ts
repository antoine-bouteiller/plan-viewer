interface Counts {
  done: number
  total: number
}

export interface DocNode {
  name: string // Row label: directory segment(s) or document title
  path?: string // Worktree-relative file path; absent for a directory with no umbrella
  kind: 'dir' | 'plan' | 'phase' | 'umbrella' | 'leaf' | 'discovery' | 'examples'
  status?: string
  archived?: boolean
  tasks?: Counts
  acceptance?: Counts
  children?: DocNode[]
}

export interface DocMeta {
  acceptance?: Counts
  archived?: boolean
  kind?: DocNode['kind']
  'parent-spec'?: string
  path: string
  status?: string
  tasks?: Counts
  title: string
}

type InternalNode = Omit<DocNode, 'children'> & {
  children: InternalNode[]
  directory: boolean
  order: number
  parent?: InternalNode
}

const kindOf = (doc: DocMeta): DocNode['kind'] => {
  if (doc.kind) {
    return doc.kind
  }
  if (/\.discovery\.mdx?$/.test(doc.path)) {
    return 'discovery'
  }
  if (/\.examples\.mdx?$/.test(doc.path)) {
    return 'examples'
  }
  return 'leaf'
}

const isCompanion = (kind: DocNode['kind']) => kind === 'discovery' || kind === 'examples'
const isPlanIndex = (doc: DocMeta) => doc.kind === 'plan' && /(?:^|\/)index\.md$/.test(doc.path)
const stemOf = (path: string) => path.replace(/\.(?:spec|discovery|examples)\.mdx?$/, '')
const companionOrder = (node: InternalNode) => {
  if (node.kind === 'examples') {
    return 1
  }
  if (node.kind === 'discovery') {
    return 2
  }
  return 0
}

const detach = (node: InternalNode) => {
  if (node.parent) {
    const index = node.parent.children.indexOf(node)
    if (index === -1) {
      return
    }
    node.parent.children.splice(index, 1)
    node.parent = undefined
  }
}

const append = (parent: InternalNode, node: InternalNode) => {
  detach(node)
  parent.children.push(node)
  node.parent = parent
}

const contains = (node: InternalNode, wanted: InternalNode): boolean => node === wanted || node.children.some((child) => contains(child, wanted))

const documentNode = (doc: DocMeta, order: number): InternalNode => ({
  acceptance: doc.acceptance,
  archived: doc.archived,
  children: [],
  directory: false,
  kind: kindOf(doc),
  name: doc.title,
  order,
  path: doc.path,
  status: doc.status,
  tasks: doc.tasks,
})

const attachDocument = (directory: InternalNode, document: InternalNode) => {
  directory.acceptance = document.acceptance
  directory.archived = document.archived
  directory.kind = document.kind
  directory.order = document.order
  directory.path = document.path
  directory.status = document.status
  directory.tasks = document.tasks
  detach(document)
}

const compact = (node: InternalNode) => {
  for (const child of node.children) {
    compact(child)
  }
  while (!node.path && node.directory && node.children.length === 1 && node.children[0].directory) {
    const [child] = node.children
    node.name = `${node.name}/${child.name}`
    if (child.path) {
      attachDocument(node, child)
    }
    node.children = child.children
    for (const grandchild of node.children) {
      grandchild.parent = node
    }
  }
}

const isPlainDirectory = (node: InternalNode) => node.directory && !node.path

const archivedOrder = (first: InternalNode, second: InternalNode) => {
  if (!first.path || !second.path || first.archived === second.archived) {
    return 0
  }
  return first.archived ? 1 : -1
}

const compareNodes = (first: InternalNode, second: InternalNode) => {
  if (isPlainDirectory(first) !== isPlainDirectory(second)) {
    return isPlainDirectory(first) ? -1 : 1
  }
  const archived = archivedOrder(first, second)
  if (archived) {
    return archived
  }
  if (first.kind === 'phase' && second.kind === 'phase') {
    return first.order - second.order
  }
  const sameStem = first.path && second.path && stemOf(first.path) === stemOf(second.path)
  if (sameStem && (isCompanion(first.kind) || isCompanion(second.kind))) {
    const companion = companionOrder(first) - companionOrder(second)
    if (companion) {
      return companion
    }
  }
  return first.name.toLowerCase().localeCompare(second.name.toLowerCase()) || first.order - second.order
}

const sortTree = (node: InternalNode) => {
  node.children.sort(compareNodes)
  for (const child of node.children) {
    sortTree(child)
  }
}

const toWire = (node: InternalNode): DocNode => ({
  acceptance: node.acceptance,
  archived: node.archived,
  children: node.children.length ? node.children.map(toWire) : undefined,
  kind: node.kind,
  name: node.name,
  path: node.path,
  status: node.status,
  tasks: node.tasks,
})

interface BuildState {
  directories: Map<string, InternalNode>
  documents: Map<string, InternalNode>
  metadata: Map<InternalNode, DocMeta>
  root: InternalNode
}

const addDocuments = (docs: DocMeta[], state: BuildState) => {
  const { directories, documents, metadata, root } = state
  for (const [order, doc] of docs.entries()) {
    const segments = doc.path.split('/').filter(Boolean)
    const [file] = segments.slice(-1)
    if (file) {
      let parent = root
      let directoryPath = ''
      for (const segment of segments.slice(0, -1)) {
        directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment
        let directory = directories.get(directoryPath)
        if (!directory) {
          directory = { children: [], directory: true, kind: 'dir', name: segment, order }
          append(parent, directory)
          directories.set(directoryPath, directory)
        }
        parent = directory
      }
      const node = documentNode(doc, order)
      append(parent, node)
      documents.set(doc.path, node)
      metadata.set(node, doc)
    }
  }
}

const resolvesToUmbrella = (child: InternalNode, umbrella: InternalNode, state: Pick<BuildState, 'documents' | 'metadata'>) => {
  const childDoc = state.metadata.get(child)
  const umbrellaDoc = state.metadata.get(umbrella)
  if (!childDoc || !umbrellaDoc) {
    return false
  }
  if (childDoc['parent-spec'] === umbrellaDoc.path) {
    return true
  }
  if (!isCompanion(child.kind)) {
    return false
  }
  const spec = state.documents.get(`${stemOf(childDoc.path)}.spec.md`) ?? state.documents.get(`${stemOf(childDoc.path)}.spec.mdx`)
  return spec !== undefined && state.metadata.get(spec)?.['parent-spec'] === umbrellaDoc.path
}

const attachUmbrellas = (state: BuildState, flat: boolean) => {
  const { directories, metadata } = state
  const represented = new Map<InternalNode, InternalNode>()
  for (const [directoryPath, directory] of directories) {
    const nested = directory.children.some((child) => child.directory)
    const [umbrella] = directory.children
      .filter((child) => {
        const doc = metadata.get(child)
        return doc?.kind === 'umbrella' || (doc !== undefined && isPlanIndex(doc))
      })
      .toSorted((first, second) => (first.path ?? '').localeCompare(second.path ?? ''))
    const coversSiblings =
      umbrella?.kind !== 'umbrella' || directory.children.every((child) => child === umbrella || resolvesToUmbrella(child, umbrella, state))
    if (directoryPath && umbrella && !nested && coversSiblings) {
      const umbrellaName = flat || umbrella.kind === 'umbrella' ? umbrella.name : directory.name
      attachDocument(directory, umbrella)
      directory.name = umbrellaName
      represented.set(umbrella, directory)
    }
  }
  return represented
}

const attachCompanions = (
  metadata: Map<InternalNode, DocMeta>,
  documents: Map<string, InternalNode>,
  represented: Map<InternalNode, InternalNode>
) => {
  for (const [node, doc] of metadata) {
    if (isCompanion(node.kind)) {
      const spec = documents.get(`${stemOf(doc.path)}.spec.md`) ?? documents.get(`${stemOf(doc.path)}.spec.mdx`)
      const target = spec && (represented.get(spec) ?? spec)
      if (target) {
        append(target, node)
      }
    }
  }
}

const attachParents = (metadata: Map<InternalNode, DocMeta>, documents: Map<string, InternalNode>, represented: Map<InternalNode, InternalNode>) => {
  for (const [node, doc] of metadata) {
    const parent = doc['parent-spec'] && documents.get(doc['parent-spec'])
    const child = represented.get(node) ?? node
    const target = parent && (represented.get(parent) ?? parent)
    if (target && child !== target && !contains(child, target)) {
      append(target, child)
    }
  }
}

const hoistedDocuments = (nodes: InternalNode[]): InternalNode[] =>
  nodes.flatMap((node) => (isPlainDirectory(node) ? hoistedDocuments(node.children) : [node]))

const flattenDirectories = (root: InternalNode) => {
  root.children = hoistedDocuments(root.children)
  for (const child of root.children) {
    child.parent = root
  }
}

export const buildTree = (docs: DocMeta[], { flat = false }: { flat?: boolean } = {}): DocNode[] => {
  const root: InternalNode = { children: [], directory: true, kind: 'dir', name: '', order: -1 }
  const directories = new Map<string, InternalNode>([['', root]])
  const documents = new Map<string, InternalNode>()
  const metadata = new Map<InternalNode, DocMeta>()
  const state = { directories, documents, metadata, root }
  addDocuments(docs, state)
  const represented = attachUmbrellas(state, flat)
  attachCompanions(metadata, documents, represented)
  attachParents(metadata, documents, represented)
  if (flat) {
    flattenDirectories(root)
  } else {
    for (const child of root.children) {
      compact(child)
    }
  }
  sortTree(root)
  return root.children.map(toWire)
}
