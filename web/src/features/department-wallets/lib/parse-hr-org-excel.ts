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
import * as XLSX from 'xlsx'

import type { HROrgDeptRow } from '../types'

type FieldKey =
  | 'dept_no'
  | 'dept_id'
  | 'dept_name'
  | 'comp_no'
  | 'p_dept_no'
  | 'p_dept_id'
  | 'level'
  | 'issealup'
  | 'is_del'
  | 'f_order'
  | 'dept_type'

const HEADER_ALIASES: Record<string, FieldKey> = {
  dept_no: 'dept_no',
  deptno: 'dept_no',
  dept_id: 'dept_id',
  deptid: 'dept_id',
  dept_name: 'dept_name',
  deptname: 'dept_name',
  comp_no: 'comp_no',
  compno: 'comp_no',
  p_dept_no: 'p_dept_no',
  pdept_no: 'p_dept_no',
  pdeptno: 'p_dept_no',
  p_dept_id: 'p_dept_id',
  pdept_id: 'p_dept_id',
  pdeptid: 'p_dept_id',
  level: 'level',
  issealup: 'issealup',
  is_seal_up: 'issealup',
  is_del: 'is_del',
  isdel: 'is_del',
  f_order: 'f_order',
  forder: 'f_order',
  dept_type: 'dept_type',
  depttype: 'dept_type',
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_')
}

function cellToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return String(value).trim()
}

function cellToInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  const text = cellToString(value)
  if (!text) return 0
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapHeaderRow(
  raw: Record<string, unknown>
): Partial<Record<FieldKey, unknown>> {
  const mapped: Partial<Record<FieldKey, unknown>> = {}
  for (const [key, value] of Object.entries(raw)) {
    const field = HEADER_ALIASES[normalizeHeader(key)]
    if (!field) continue
    mapped[field] = value
  }
  return mapped
}

function rowFromMapped(
  mapped: Partial<Record<FieldKey, unknown>>
): HROrgDeptRow | null {
  const deptNo = cellToString(mapped.dept_no)
  const deptId = cellToString(mapped.dept_id)
  const deptName = cellToString(mapped.dept_name)
  if (!deptNo || !deptId || !deptName) return null
  return {
    dept_no: deptNo,
    dept_id: deptId,
    dept_name: deptName,
    comp_no: cellToString(mapped.comp_no),
    p_dept_no: cellToString(mapped.p_dept_no),
    p_dept_id: cellToString(mapped.p_dept_id),
    level: cellToInt(mapped.level),
    issealup: cellToInt(mapped.issealup),
    is_del: cellToInt(mapped.is_del),
    f_order: cellToInt(mapped.f_order),
    dept_type: cellToString(mapped.dept_type),
  }
}

/** Parse the first sheet of an HR_ORG_DEPT Excel export into sync rows. */
export function parseHrOrgDeptExcel(buffer: ArrayBuffer): HROrgDeptRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('Excel workbook has no sheets')
  }
  const sheet = workbook.Sheets[sheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })
  const rows: HROrgDeptRow[] = []
  for (const raw of rawRows) {
    const mapped = mapHeaderRow(raw)
    const row = rowFromMapped(mapped)
    if (row) rows.push(row)
  }
  return rows
}
