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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  Department,
  DepartmentLedgerPage,
  DepartmentManager,
  DepartmentMember,
  DepartmentWallet,
  HROrgDeptRow,
} from './types'

export async function listDepartments(): Promise<ApiResponse<Department[]>> {
  const res = await api.get('/api/department/')
  return res.data
}

export async function syncDepartments(
  rows: HROrgDeptRow[]
): Promise<ApiResponse<null>> {
  const res = await api.post('/api/department/sync', { rows })
  return res.data
}

export async function topupDepartment(
  id: number,
  quota: number,
  remark: string
): Promise<ApiResponse<null>> {
  const res = await api.post(`/api/department/${id}/topup`, { quota, remark })
  return res.data
}

export async function grantDepartmentQuota(
  id: number,
  userId: number,
  quota: number,
  remark: string
): Promise<ApiResponse<null>> {
  const res = await api.post(`/api/department/${id}/grant`, {
    user_id: userId,
    quota,
    remark,
  })
  return res.data
}

export async function transferDepartmentQuota(
  id: number,
  toDepartmentId: number,
  quota: number,
  remark: string
): Promise<ApiResponse<null>> {
  const res = await api.post(`/api/department/${id}/transfer`, {
    to_department_id: toDepartmentId,
    quota,
    remark,
  })
  return res.data
}

export async function reclaimDepartmentQuota(
  id: number,
  userId: number,
  quota: number,
  remark: string
): Promise<ApiResponse<null>> {
  const res = await api.post(`/api/department/${id}/reclaim`, {
    user_id: userId,
    quota,
    remark,
  })
  return res.data
}

export async function getDepartmentWallet(
  id: number
): Promise<ApiResponse<DepartmentWallet>> {
  const res = await api.get(`/api/department/${id}/wallet`)
  return res.data
}

export async function getDepartmentLedger(
  id: number,
  page = 1,
  pageSize = 20
): Promise<ApiResponse<DepartmentLedgerPage>> {
  const res = await api.get(`/api/department/${id}/ledger`, {
    params: { p: page, page_size: pageSize },
  })
  return res.data
}

export async function listDepartmentManagers(
  id: number
): Promise<ApiResponse<DepartmentManager[]>> {
  const res = await api.get(`/api/department/${id}/managers`)
  return res.data
}

export async function assignDepartmentManager(
  id: number,
  userId: number
): Promise<ApiResponse<null>> {
  const res = await api.post(`/api/department/${id}/managers`, {
    user_id: userId,
  })
  return res.data
}

export async function removeDepartmentManager(
  id: number,
  userId: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`/api/department/${id}/managers/${userId}`)
  return res.data
}

export type DepartmentGrantUser = {
  id: number
  username: string
  display_name?: string
  quota?: number
}

export async function searchDepartmentGrantUsers(params: {
  keyword: string
  departmentId?: number
  p?: number
  page_size?: number
}): Promise<
  ApiResponse<{ items: DepartmentGrantUser[]; total: number }>
> {
  const res = await api.get('/api/department/users/search', {
    params: {
      keyword: params.keyword,
      department_id: params.departmentId,
      p: params.p ?? 1,
      page_size: params.page_size ?? 8,
    },
  })
  return res.data
}

export async function listDepartmentMembers(
  id: number
): Promise<ApiResponse<DepartmentMember[]>> {
  const res = await api.get(`/api/department/${id}/members`)
  return res.data
}

export async function listUnassignedDepartmentMembers(): Promise<
  ApiResponse<DepartmentMember[]>
> {
  const res = await api.get('/api/department/members/unassigned', {
    params: { page_size: 200 },
  })
  return res.data
}

export async function setDepartmentMember(
  id: number,
  userId: number
): Promise<ApiResponse<null>> {
  const res = await api.post(`/api/department/${id}/members`, {
    user_id: userId,
  })
  return res.data
}

export async function clearDepartmentMember(
  userId: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`/api/department/members/${userId}`)
  return res.data
}
