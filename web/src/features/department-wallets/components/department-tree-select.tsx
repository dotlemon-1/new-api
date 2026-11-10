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
import { Check, ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import {
  buildDepartmentTree,
  collectExpandableDepartmentIds,
  filterDepartmentTree,
  flattenDepartmentTree,
  formatDepartmentPathLabel,
} from '../lib/department-tree'
import type { Department } from '../types'

type DepartmentTreeSelectProps = {
  /** Departments shown in the selectable tree. */
  departments: Department[]
  /**
   * Optional fuller list used only to build ancestor path labels
   * (useful when the selectable set is a subtree).
   */
  pathDepartments?: Department[]
  value: number | null
  onValueChange: (departmentId: number | null) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Compact trigger for inline table/list actions. */
  size?: 'default' | 'sm'
}

export function DepartmentTreeSelect(props: DepartmentTreeSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const pathDepartments = props.pathDepartments ?? props.departments

  const selectedLabel = useMemo(() => {
    if (props.value == null) return null
    return formatDepartmentPathLabel(pathDepartments, props.value)
  }, [pathDepartments, props.value])

  const treeRoots = useMemo(() => {
    const tree = buildDepartmentTree(props.departments)
    return filterDepartmentTree(tree, keyword)
  }, [props.departments, keyword])

  useEffect(() => {
    if (!open) {
      setKeyword('')
      return
    }
    // Open fully expanded so the hierarchy is visible immediately.
    const roots = buildDepartmentTree(props.departments)
    setExpandedIds(new Set(collectExpandableDepartmentIds(roots)))
  }, [open, props.departments])

  useEffect(() => {
    if (!keyword.trim()) return
    setExpandedIds(new Set(collectExpandableDepartmentIds(treeRoots)))
  }, [keyword, treeRoots])

  const rows = useMemo(
    () => flattenDepartmentTree(treeRoots, expandedIds),
    [treeRoots, expandedIds]
  )

  const toggleExpand = (departmentId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(departmentId)) next.delete(departmentId)
      else next.add(departmentId)
      return next
    })
  }

  const handleSelect = (departmentId: number) => {
    props.onValueChange(departmentId)
    setOpen(false)
    setKeyword('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            role='combobox'
            aria-expanded={open}
            disabled={props.disabled}
            className={cn(
              'justify-between gap-2 font-normal',
              props.size === 'sm' ? 'h-8 min-w-56 px-2 text-sm' : 'h-9 min-w-64',
              props.className
            )}
          />
        }
      >
        <span className='truncate text-left'>
          {selectedLabel ??
            props.placeholder ??
            t('Select a target department')}
        </span>
        <ChevronsUpDown className='text-muted-foreground size-4 shrink-0 opacity-60' />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[min(24rem,calc(100vw-2rem))] p-0'
      >
        <div className='border-border border-b p-2'>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('Search by name or department number')}
            className='h-8'
            autoFocus
          />
        </div>
        <div className='max-h-72 overflow-y-auto p-1'>
          {rows.length === 0 ? (
            <div className='text-muted-foreground px-3 py-6 text-center text-sm'>
              {t('No departments found')}
            </div>
          ) : (
            rows.map((dept) => {
              const isSelected = props.value === dept.id
              const pathLabel = formatDepartmentPathLabel(
                pathDepartments,
                dept.id
              )
              const shortLabel = dept.external_no
                ? `${dept.name} (${dept.external_no})`
                : dept.name
              return (
                <div
                  key={dept.id}
                  className='flex items-stretch gap-0.5'
                  style={{ paddingLeft: `${dept.depth * 0.75}rem` }}
                >
                  {dept.hasChildren ? (
                    <button
                      type='button'
                      className='text-muted-foreground hover:bg-muted hover:text-foreground size-7 shrink-0 rounded-md text-xs'
                      aria-expanded={expandedIds.has(dept.id)}
                      aria-label={
                        expandedIds.has(dept.id) ? t('Collapse') : t('Expand')
                      }
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        toggleExpand(dept.id)
                      }}
                    >
                      {expandedIds.has(dept.id) ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className='size-7 shrink-0' aria-hidden='true' />
                  )}
                  <button
                    type='button'
                    className={cn(
                      'hover:bg-muted flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                      isSelected && 'bg-muted'
                    )}
                    onClick={() => handleSelect(dept.id)}
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-medium'>
                        {dept.name}
                        <span className='text-muted-foreground ml-1 font-normal'>
                          ({dept.external_no})
                        </span>
                      </div>
                      {pathLabel !== shortLabel ? (
                        <div className='text-muted-foreground truncate text-xs'>
                          {pathLabel}
                        </div>
                      ) : null}
                    </div>
                    <Check
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        isSelected ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
