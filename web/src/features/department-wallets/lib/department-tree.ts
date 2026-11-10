/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type {
  Department,
  DepartmentFlatRow,
  DepartmentTreeNode,
} from '../types'

function sortDepartmentNodes(nodes: DepartmentTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.external_no.localeCompare(b.external_no)
  })
  for (const node of nodes) {
    if (node.children?.length) sortDepartmentNodes(node.children)
  }
}

function pruneEmptyChildren(nodes: DepartmentTreeNode[]) {
  for (const node of nodes) {
    if (!node.children?.length) {
      delete node.children
      continue
    }
    pruneEmptyChildren(node.children)
  }
}

/** Build a forest from a flat department list using `parent_id`. */
export function buildDepartmentTree(
  items: Department[]
): DepartmentTreeNode[] {
  const byId = new Map<number, DepartmentTreeNode>()
  for (const item of items) {
    byId.set(item.id, { ...item, children: [] })
  }

  const roots: DepartmentTreeNode[] = []
  for (const node of byId.values()) {
    const parentId = node.parent_id
    const parent = parentId != null ? byId.get(parentId) : undefined
    if (parent) {
      if (!parent.children) parent.children = []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  sortDepartmentNodes(roots)
  pruneEmptyChildren(roots)
  return roots
}

function departmentMatches(dept: Department, keyword: string) {
  return (
    dept.name.toLowerCase().includes(keyword) ||
    dept.external_no.toLowerCase().includes(keyword) ||
    (dept.company_no || '').toLowerCase().includes(keyword)
  )
}

/**
 * Keep nodes that match the keyword or have matching descendants,
 * so search results still show parent context.
 */
export function filterDepartmentTree(
  nodes: DepartmentTreeNode[],
  keyword: string
): DepartmentTreeNode[] {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return nodes

  const filterNodes = (list: DepartmentTreeNode[]): DepartmentTreeNode[] => {
    const result: DepartmentTreeNode[] = []
    for (const node of list) {
      const children = node.children ? filterNodes(node.children) : []
      if (departmentMatches(node, normalized) || children.length > 0) {
        result.push({
          ...node,
          children: children.length > 0 ? children : undefined,
        })
      }
    }
    return result
  }

  return filterNodes(nodes)
}

/**
 * Flatten a department forest for table rendering.
 * Only includes children of ids present in `expandedIds`.
 */
export function flattenDepartmentTree(
  nodes: DepartmentTreeNode[],
  expandedIds: ReadonlySet<number>,
  depth = 0
): DepartmentFlatRow[] {
  const rows: DepartmentFlatRow[] = []
  for (const node of nodes) {
    const hasChildren = !!node.children?.length
    const { children: _children, ...department } = node
    rows.push({
      ...department,
      depth,
      hasChildren,
    })
    if (hasChildren && expandedIds.has(node.id) && node.children) {
      rows.push(...flattenDepartmentTree(node.children, expandedIds, depth + 1))
    }
  }
  return rows
}

/** Flat list of all descendants under `ancestorId` (any depth, excludes self). */
export function listDescendantDepartments(
  items: Department[],
  ancestorId: number
): Department[] {
  const childrenByParent = new Map<number, Department[]>()
  for (const item of items) {
    if (item.parent_id == null) continue
    const list = childrenByParent.get(item.parent_id) ?? []
    list.push(item)
    childrenByParent.set(item.parent_id, list)
  }
  const out: Department[] = []
  const queue = [ancestorId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id == null) break
    for (const child of childrenByParent.get(id) ?? []) {
      out.push(child)
      queue.push(child.id)
    }
  }
  return out
}

/** Collect every non-leaf id so the tree can start fully expanded when searching. */
export function collectExpandableDepartmentIds(
  nodes: DepartmentTreeNode[]
): number[] {
  const ids: number[] = []
  const walk = (list: DepartmentTreeNode[]) => {
    for (const node of list) {
      if (node.children?.length) {
        ids.push(node.id)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return ids
}

/** Ancestor chain from root to `departmentId` (inclusive). */
export function getDepartmentPath(
  items: Department[],
  departmentId: number
): Department[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const path: Department[] = []
  let current = byId.get(departmentId)
  const seen = new Set<number>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    if (current.parent_id == null) break
    current = byId.get(current.parent_id)
  }
  return path
}

/** Human-readable path, e.g. `Group / Finance / Finance (10102)`. */
export function formatDepartmentPathLabel(
  items: Department[],
  departmentId: number
): string {
  const path = getDepartmentPath(items, departmentId)
  if (path.length === 0) return String(departmentId)
  const names = path.map((dept) => dept.name)
  const leaf = path.at(-1)
  if (!leaf) return String(departmentId)
  const trail = names.join(' / ')
  return leaf.external_no ? `${trail} (${leaf.external_no})` : trail
}
