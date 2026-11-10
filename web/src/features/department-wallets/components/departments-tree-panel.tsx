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
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  buildDepartmentTree,
  collectExpandableDepartmentIds,
  filterDepartmentTree,
  flattenDepartmentTree,
} from '../lib/department-tree'
import type { Department, DepartmentTreeNode } from '../types'

type DepartmentsTreePanelProps = {
  departments: Department[]
  selectedId: number | null
  onSelect: (department: Department) => void
  isLoading?: boolean
}

function TreeNodeRows(props: {
  nodes: DepartmentTreeNode[]
  depth: number
  expandedIds: ReadonlySet<number>
  selectedId: number | null
  onToggleExpand: (departmentId: number) => void
  onSelect: (department: Department) => void
}) {
  const { t } = useTranslation()
  const rows = flattenDepartmentTree(
    props.nodes,
    props.expandedIds,
    props.depth
  )

  return (
    <ul className='space-y-0.5 p-2' role='tree'>
      {rows.map((dept) => {
        const isExpanded = props.expandedIds.has(dept.id)
        const isSelected = props.selectedId === dept.id
        return (
          <li key={dept.id} role='treeitem' aria-selected={isSelected}>
            <div
              className={cn(
                'hover:bg-muted flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left text-sm',
                isSelected && 'bg-muted'
              )}
              style={{ paddingLeft: `${0.25 + dept.depth * 0.85}rem` }}
            >
              {dept.hasChildren ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='size-6 shrink-0'
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? t('Collapse') : t('Expand')}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    props.onToggleExpand(dept.id)
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown className='size-4' />
                  ) : (
                    <ChevronRight className='size-4' />
                  )}
                </Button>
              ) : (
                <span className='size-6 shrink-0' aria-hidden='true' />
              )}
              <button
                type='button'
                className='flex min-w-0 flex-1 items-center gap-2 text-left'
                onClick={() => props.onSelect(dept)}
              >
                <span className='min-w-0 flex-1 truncate font-medium'>
                  {dept.name}
                </span>
                <Badge
                  variant={isSelected ? 'default' : 'secondary'}
                  className='shrink-0 tabular-nums'
                >
                  {dept.member_count ?? 0}
                </Badge>
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function DepartmentsTreePanel(props: DepartmentsTreePanelProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())

  const onToggleExpand = useCallback((departmentId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(departmentId)) next.delete(departmentId)
      else next.add(departmentId)
      return next
    })
  }, [])

  const treeRoots = useMemo(() => {
    const tree = buildDepartmentTree(props.departments)
    return filterDepartmentTree(tree, keyword)
  }, [props.departments, keyword])

  useEffect(() => {
    if (!keyword.trim()) return
    setExpandedIds(new Set(collectExpandableDepartmentIds(treeRoots)))
  }, [keyword, treeRoots])

  // Expand first level by default when data first arrives.
  useEffect(() => {
    if (expandedIds.size > 0 || props.departments.length === 0) return
    const roots = buildDepartmentTree(props.departments)
    setExpandedIds(new Set(roots.filter((n) => n.children?.length).map((n) => n.id)))
  }, [props.departments, expandedIds.size])

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='border-border shrink-0 border-b p-3'>
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t('Search by name or department number')}
          aria-label={t('Search by name or department number')}
        />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {(() => {
          if (props.isLoading) {
            return (
              <div className='text-muted-foreground p-4 text-sm'>
                {t('Loading...')}
              </div>
            )
          }
          if (treeRoots.length === 0) {
            return (
              <div className='text-muted-foreground p-4 text-sm'>
                {t('No departments found')}
              </div>
            )
          }
          return (
            <TreeNodeRows
              nodes={treeRoots}
              depth={0}
              expandedIds={expandedIds}
              selectedId={props.selectedId}
              onToggleExpand={onToggleExpand}
              onSelect={props.onSelect}
            />
          )
        })()}
      </div>
    </div>
  )
}
