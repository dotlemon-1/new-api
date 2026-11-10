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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useIsAdmin } from '@/hooks/use-admin'
import { createServerError } from '@/lib/server-error-message'

import {
  listDepartments,
  listUnassignedDepartmentMembers,
} from '../api'
import { UNASSIGNED_DEPARTMENT_ID, type Department } from '../types'
import { DepartmentsMembersPanel } from './departments-members-panel'
import { useDepartments } from './departments-provider'
import { DepartmentsTreePanel } from './departments-tree-panel'

function buildUnassignedDepartment(
  name: string,
  memberCount: number
): Department {
  return {
    id: UNASSIGNED_DEPARTMENT_ID,
    external_no: '-',
    external_id: '',
    name,
    company_no: '',
    parent_id: null,
    parent_external_no: '',
    parent_external_id: '',
    level: 0,
    sort_order: Number.MAX_SAFE_INTEGER,
    source_type: 'virtual',
    status: 'enabled',
    last_synced_at: null,
    created_at: '',
    updated_at: '',
    quota: 0,
    used_quota: 0,
    member_count: memberCount,
    is_unassigned: true,
  }
}

export function DepartmentsWorkspace() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const { currentRow, setCurrentRow } = useDepartments()

  const departmentsQuery = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const result = await listDepartments()
      if (!result.success) {
        throw createServerError(result, t('Failed to load departments'))
      }
      return result.data ?? []
    },
  })

  const unassignedQuery = useQuery({
    queryKey: ['department-members-unassigned'],
    enabled: isAdmin,
    queryFn: async () => {
      const result = await listUnassignedDepartmentMembers()
      if (!result.success) {
        throw createServerError(
          result,
          t('Failed to load unassigned members')
        )
      }
      return result.data ?? []
    },
  })

  const departments = useMemo(() => {
    const items: Department[] = [...(departmentsQuery.data ?? [])]
    if (isAdmin) {
      items.push(
        buildUnassignedDepartment(
          t('Unassigned department'),
          unassignedQuery.data?.length ?? 0
        )
      )
    }
    return items
  }, [departmentsQuery.data, isAdmin, t, unassignedQuery.data])

  // Keep selection fresh after sync / wallet / membership refresh.
  useEffect(() => {
    if (currentRow == null) return
    const fresh = departments.find((dept) => dept.id === currentRow.id)
    if (!fresh) {
      // Avoid clearing selection while the list is still loading / refetching.
      if (departmentsQuery.isLoading || departmentsQuery.isFetching) return
      if (!departmentsQuery.data) return
      setCurrentRow(null)
      return
    }
    if (
      fresh.quota !== currentRow.quota ||
      fresh.used_quota !== currentRow.used_quota ||
      fresh.member_count !== currentRow.member_count ||
      fresh.name !== currentRow.name ||
      fresh.status !== currentRow.status
    ) {
      setCurrentRow(fresh)
    }
  }, [
    departments,
    currentRow,
    setCurrentRow,
    departmentsQuery.isLoading,
    departmentsQuery.isFetching,
    departmentsQuery.data,
  ])

  const selected =
    currentRow == null
      ? null
      : (departments.find((dept) => dept.id === currentRow.id) ?? currentRow)

  return (
    <div className='border-border bg-background flex h-full min-h-0 overflow-hidden rounded-xl border'>
      <ResizablePanelGroup orientation='horizontal' className='h-full'>
        <ResizablePanel defaultSize='32' minSize='22' maxSize='48'>
          <DepartmentsTreePanel
            departments={departments}
            selectedId={selected?.id ?? null}
            onSelect={setCurrentRow}
            isLoading={
              departmentsQuery.isLoading ||
              (isAdmin && unassignedQuery.isLoading)
            }
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize='68' minSize='40'>
          <DepartmentsMembersPanel department={selected} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
