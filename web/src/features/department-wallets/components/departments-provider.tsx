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
import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { Department, DepartmentDialogType } from '../types'

type DepartmentsContextValue = {
  open: DepartmentDialogType
  setOpen: (open: DepartmentDialogType) => void
  currentRow: Department | null
  setCurrentRow: (row: Department | null) => void
  triggerRefresh: () => void
}

const DepartmentsContext = createContext<DepartmentsContextValue | null>(null)

export function DepartmentsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<DepartmentDialogType>(null)
  const [currentRow, setCurrentRowState] = useState<Department | null>(null)

  const setCurrentRow = useCallback((row: Department | null) => {
    setCurrentRowState(row)
    // Clearing selection must also close dialogs, otherwise a stale `open`
    // value reopens the previous dialog when the user selects again.
    if (row == null) {
      setOpen(null)
    }
  }, [])

  const triggerRefresh = useCallback(() => {
    // Keep query keys stable and invalidate in place so cached data (and the
    // current department selection) are not wiped during refetch.
    void queryClient.invalidateQueries({ queryKey: ['departments'] })
    void queryClient.invalidateQueries({
      queryKey: ['department-members-unassigned'],
    })
    void queryClient.invalidateQueries({ queryKey: ['department-members'] })
    void queryClient.invalidateQueries({ queryKey: ['department-managers'] })
  }, [queryClient])

  const value = useMemo(
    () => ({
      open,
      setOpen,
      currentRow,
      setCurrentRow,
      triggerRefresh,
    }),
    [open, currentRow, setCurrentRow, triggerRefresh]
  )

  return (
    <DepartmentsContext.Provider value={value}>
      {children}
    </DepartmentsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDepartments() {
  const ctx = useContext(DepartmentsContext)
  if (!ctx) {
    throw new Error('useDepartments must be used within DepartmentsProvider')
  }
  return ctx
}
