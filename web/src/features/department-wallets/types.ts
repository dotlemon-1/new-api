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

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface Department {
  id: number
  external_no: string
  external_id: string
  name: string
  company_no: string
  parent_id: number | null
  parent_external_no: string
  parent_external_id?: string
  level: number
  sort_order: number
  source_type: string
  status: string
  last_synced_at: string | null
  created_at: string
  updated_at: string
  quota: number
  used_quota: number
  member_count?: number
  /** Virtual bucket for users with no department membership. */
  is_unassigned?: boolean
}

export type DepartmentTreeNode = Department & {
  children?: DepartmentTreeNode[]
}

/** Flat row used by the tree table (expand state owned by the page). */
export type DepartmentFlatRow = Department & {
  depth: number
  hasChildren: boolean
}

export interface DepartmentWallet {
  id: number
  department_id: number
  quota: number
  used_quota: number
}

export interface DepartmentLedgerEntry {
  id: number
  department_id: number
  type: string
  amount: number
  dept_quota_before: number
  dept_quota_after: number
  target_user_id: number
  operator_user_id: number
  remark: string
  created_at: string
}

export interface DepartmentLedgerPage {
  page: number
  page_size: number
  total: number
  items: DepartmentLedgerEntry[]
}

export interface DepartmentManager {
  id: number
  department_id: number
  user_id: number
  username: string
  display_name: string
  created_at: string
}

export interface DepartmentMember {
  id: number
  department_id: number
  user_id: number
  username: string
  display_name: string
  created_at: string
}

export const UNASSIGNED_DEPARTMENT_ID = 0

export interface HROrgDeptRow {
  dept_no: string
  dept_id?: string
  dept_name: string
  comp_no?: string
  p_dept_no?: string
  p_dept_id?: string
  level?: number
  issealup?: number
  is_del?: number
  f_order?: number
  dept_type?: string
}

export type DepartmentDialogType =
  | 'sync'
  | 'topup'
  | 'grant'
  | 'reclaim'
  | 'ledger'
  | 'managers'
  | 'transfer'
  | null
