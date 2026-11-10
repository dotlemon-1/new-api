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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { searchUsers } from '@/features/users/api'
import { toIntlLocale } from '@/i18n/languages'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  assignDepartmentManager,
  getDepartmentLedger,
  grantDepartmentQuota,
  listDepartments,
  listDepartmentManagers,
  reclaimDepartmentQuota,
  removeDepartmentManager,
  searchDepartmentGrantUsers,
  syncDepartments,
  topupDepartment,
  transferDepartmentQuota,
  type DepartmentGrantUser,
} from '../api'
import { listDescendantDepartments } from '../lib/department-tree'
import { parseHrOrgDeptExcel } from '../lib/parse-hr-org-excel'
import type { DepartmentManager, HROrgDeptRow } from '../types'
import { DepartmentTreeSelect } from './department-tree-select'
import { useDepartments } from './departments-provider'

const SAMPLE_SYNC_JSON = `[
  {
    "dept_no": "00",
    "dept_id": "00000000-0000-0000-0000-000000000000CCE7AED4",
    "dept_name": "Group Root",
    "comp_no": "00",
    "p_dept_no": "-1",
    "p_dept_id": "-1",
    "level": 1,
    "issealup": 0,
    "is_del": 0,
    "f_order": 1,
    "dept_type": "HR"
  },
  {
    "dept_no": "10",
    "dept_id": "76MAAAAANrbM567U",
    "dept_name": "Group Company",
    "comp_no": "10",
    "p_dept_no": "00",
    "p_dept_id": "00000000-0000-0000-0000-000000000000CCE7AED4",
    "level": 2,
    "issealup": 0,
    "is_del": 0,
    "f_order": 10,
    "dept_type": "HR"
  },
  {
    "dept_no": "10100",
    "dept_id": "76MAAAAANr3M567U",
    "dept_name": "Office",
    "comp_no": "10",
    "p_dept_no": "10",
    "p_dept_id": "76MAAAAANrbM567U",
    "level": 3,
    "issealup": 0,
    "is_del": 0,
    "f_order": 80,
    "dept_type": "HR"
  }
]`

export function DepartmentsDialogs() {
  const { open, setOpen, currentRow } = useDepartments()

  return (
    <>
      <SyncDialog
        open={open === 'sync'}
        onOpenChange={(next) => setOpen(next ? 'sync' : null)}
      />
      {currentRow ? (
        <>
          <TopupDialog
            open={open === 'topup'}
            onOpenChange={(next) => setOpen(next ? 'topup' : null)}
          />
          <GrantDialog
            open={open === 'grant'}
            onOpenChange={(next) => setOpen(next ? 'grant' : null)}
          />
          <ReclaimDialog
            open={open === 'reclaim'}
            onOpenChange={(next) => setOpen(next ? 'reclaim' : null)}
          />
          <LedgerDialog
            open={open === 'ledger'}
            onOpenChange={(next) => setOpen(next ? 'ledger' : null)}
          />
          <ManagersDialog
            open={open === 'managers'}
            onOpenChange={(next) => setOpen(next ? 'managers' : null)}
          />
          <TransferDialog
            open={open === 'transfer'}
            onOpenChange={(next) => setOpen(next ? 'transfer' : null)}
          />
        </>
      ) : null}
    </>
  )
}

function SyncDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { triggerRefresh } = useDepartments()
  const [source, setSource] = useState<'json' | 'excel'>('json')
  const [jsonText, setJsonText] = useState(SAMPLE_SYNC_JSON)
  const [excelRows, setExcelRows] = useState<HROrgDeptRow[]>([])
  const [excelFileName, setExcelFileName] = useState('')
  const [excelParsing, setExcelParsing] = useState(false)
  const [loading, setLoading] = useState(false)
  const excelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!props.open) {
      setSource('json')
      setExcelRows([])
      setExcelFileName('')
      setExcelParsing(false)
    }
  }, [props.open])

  const runSync = async (rows: HROrgDeptRow[]) => {
    if (rows.length === 0) {
      toast.error(t('Sync payload must be a non-empty JSON array'))
      return
    }
    setLoading(true)
    try {
      const result = await syncDepartments(rows)
      if (!result.success) {
        handleServerError(result, t('Failed to sync departments'))
        return
      }
      toast.success(t('Departments synced successfully'))
      props.onOpenChange(false)
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to sync departments'))
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (source === 'excel') {
      if (excelRows.length === 0) {
        toast.error(t('Select an Excel file first'))
        return
      }
      await runSync(excelRows)
      return
    }

    let rows: HROrgDeptRow[]
    try {
      const parsed = JSON.parse(jsonText) as unknown
      if (!Array.isArray(parsed) || parsed.length === 0) {
        toast.error(t('Sync payload must be a non-empty JSON array'))
        return
      }
      rows = parsed as HROrgDeptRow[]
    } catch {
      toast.error(t('Invalid JSON'))
      return
    }
    await runSync(rows)
  }

  const handleExcelFile = async (file: File | undefined) => {
    if (!file) return
    setExcelParsing(true)
    setExcelRows([])
    setExcelFileName(file.name)
    try {
      const buffer = await file.arrayBuffer()
      const rows = parseHrOrgDeptExcel(buffer)
      if (rows.length === 0) {
        toast.error(t('No valid department rows found in the Excel file'))
        setExcelFileName('')
        return
      }
      setExcelRows(rows)
      toast.success(
        t('Loaded {{count}} rows from {{fileName}}', {
          count: rows.length,
          fileName: file.name,
        })
      )
    } catch {
      setExcelFileName('')
      toast.error(t('Failed to parse Excel file'))
    } finally {
      setExcelParsing(false)
    }
  }

  let excelButtonLabel = t('Choose Excel file')
  if (excelParsing) {
    excelButtonLabel = t('Parsing...')
  } else if (excelFileName) {
    excelButtonLabel = t('Choose another file')
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Sync departments')}
      description={t(
        'Import HR organization rows from JSON or Excel. Existing departments are matched by DEPT_ID.'
      )}
      contentHeight='auto'
      bodyClassName='space-y-3'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={loading}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || excelParsing}
          >
            {loading ? t('Syncing...') : t('Sync')}
          </Button>
        </>
      }
    >
      <Tabs
        value={source}
        onValueChange={(value) => {
          if (value === 'json' || value === 'excel') setSource(value)
        }}
      >
        <TabsList className='grid h-auto w-full grid-cols-2'>
          <TabsTrigger value='json'>{t('JSON')}</TabsTrigger>
          <TabsTrigger value='excel'>{t('Excel')}</TabsTrigger>
        </TabsList>
        <TabsContent value='json' className='space-y-2'>
          <Label htmlFor='dept-sync-json'>{t('HR rows (JSON)')}</Label>
          <Textarea
            id='dept-sync-json'
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className='min-h-56 font-mono text-xs'
            spellCheck={false}
          />
        </TabsContent>
        <TabsContent value='excel' className='space-y-3'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Excel columns should match HR_ORG_DEPT (DEPT_ID, DEPT_NO, DEPT_NAME, P_DEPT_ID, …).'
            )}
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={excelParsing || loading}
              onClick={() => excelInputRef.current?.click()}
            >
              {excelButtonLabel}
            </Button>
            <label className='sr-only' htmlFor='dept-sync-excel'>
              {t('Excel file')}
            </label>
            <input
              ref={excelInputRef}
              id='dept-sync-excel'
              type='file'
              accept='.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv'
              className='sr-only'
              onChange={(event) => {
                void handleExcelFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
          {excelFileName && excelRows.length > 0 ? (
            <p className='text-sm'>
              {t('Loaded {{count}} rows from {{fileName}}', {
                count: excelRows.length,
                fileName: excelFileName,
              })}
            </p>
          ) : null}
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}

function QuotaAmountFields(props: {
  amount: string
  remark: string
  onAmountChange: (value: string) => void
  onRemarkChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const placeholder = tokensOnly
    ? t('Enter amount in tokens')
    : t('Enter amount in {{currency}}', { currency: currencyLabel })

  return (
    <>
      <div className='space-y-2'>
        <Label htmlFor='dept-quota-amount'>{t('Amount')}</Label>
        <Input
          id='dept-quota-amount'
          type='number'
          min='0'
          step='any'
          value={props.amount}
          onChange={(e) => props.onAmountChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='dept-quota-remark'>{t('Remark')}</Label>
        <Input
          id='dept-quota-remark'
          value={props.remark}
          onChange={(e) => props.onRemarkChange(e.target.value)}
          placeholder={t('Optional remark')}
        />
      </div>
    </>
  )
}

function TopupDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { currentRow, triggerRefresh } = useDepartments()
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.open) {
      setAmount('')
      setRemark('')
    }
  }, [props.open])

  if (!currentRow) return null

  const quotaValue = parseQuotaFromDollars(Math.abs(Number.parseFloat(amount) || 0))

  const handleConfirm = async () => {
    if (quotaValue <= 0) {
      toast.error(t('Amount must be greater than zero'))
      return
    }
    setLoading(true)
    try {
      const result = await topupDepartment(currentRow.id, quotaValue, remark)
      if (!result.success) {
        handleServerError(result, t('Failed to top up department wallet'))
        return
      }
      toast.success(t('Department wallet topped up'))
      props.onOpenChange(false)
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to top up department wallet'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Top up department wallet')}
      description={`${currentRow.name} (${currentRow.external_no}) · ${t('Balance')}: ${formatQuota(currentRow.quota)}`}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={loading}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={loading || quotaValue <= 0}>
            {loading ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <QuotaAmountFields
        amount={amount}
        remark={remark}
        onAmountChange={setAmount}
        onRemarkChange={setRemark}
      />
    </Dialog>
  )
}

function GrantDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { currentRow, triggerRefresh } = useDepartments()
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [userKeyword, setUserKeyword] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.open) {
      setAmount('')
      setRemark('')
      setUserKeyword('')
      setSelectedUserId(null)
    }
  }, [props.open])

  const usersQuery = useQuery({
    queryKey: ['department-grant-users', userKeyword],
    enabled: props.open && userKeyword.trim().length >= 1,
    queryFn: async () => {
      const result = await searchDepartmentGrantUsers({
        keyword: userKeyword.trim(),
        p: 1,
        page_size: 8,
      })
      if (!result.success) {
        throw createServerError(result, t('Failed to search users'))
      }
      return result.data?.items ?? []
    },
  })

  if (!currentRow) return null

  const quotaValue = parseQuotaFromDollars(Math.abs(Number.parseFloat(amount) || 0))

  const handleConfirm = async () => {
    if (!selectedUserId) {
      toast.error(t('Select a user first'))
      return
    }
    if (quotaValue <= 0) {
      toast.error(t('Amount must be greater than zero'))
      return
    }
    setLoading(true)
    try {
      const result = await grantDepartmentQuota(
        currentRow.id,
        selectedUserId,
        quotaValue,
        remark
      )
      if (!result.success) {
        handleServerError(result, t('Failed to grant department quota'))
        return
      }
      toast.success(t('Quota granted to user'))
      props.onOpenChange(false)
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to grant department quota'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Grant department quota')}
      description={`${currentRow.name} · ${t('Balance')}: ${formatQuota(currentRow.quota)}`}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={loading}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !selectedUserId || quotaValue <= 0}
          >
            {loading ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <div className='space-y-2'>
        <Label htmlFor='dept-grant-user'>{t('User')}</Label>
        <Input
          id='dept-grant-user'
          value={userKeyword}
          onChange={(e) => {
            setUserKeyword(e.target.value)
            setSelectedUserId(null)
          }}
          placeholder={t('Search username or display name')}
        />
        {userKeyword.trim() ? (
          <div className='border-border max-h-40 overflow-y-auto rounded-md border'>
            {(usersQuery.data ?? []).length === 0 && !usersQuery.isFetching ? (
              <div className='text-muted-foreground p-3 text-sm'>
                {t('No users found')}
              </div>
            ) : (
              (usersQuery.data ?? []).map((user) => (
                <button
                  key={user.id}
                  type='button'
                  className={`hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    selectedUserId === user.id ? 'bg-muted' : ''
                  }`}
                  onClick={() => {
                    setSelectedUserId(user.id)
                    setUserKeyword(user.username)
                  }}
                >
                  <span>
                    {user.username}
                    {user.display_name ? ` (${user.display_name})` : ''}
                  </span>
                  <span className='text-muted-foreground'>#{user.id}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <QuotaAmountFields
        amount={amount}
        remark={remark}
        onAmountChange={setAmount}
        onRemarkChange={setRemark}
      />
    </Dialog>
  )
}

function ReclaimDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { currentRow, triggerRefresh } = useDepartments()
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [userKeyword, setUserKeyword] = useState('')
  const [selectedUser, setSelectedUser] = useState<DepartmentGrantUser | null>(
    null
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.open) {
      setAmount('')
      setRemark('')
      setUserKeyword('')
      setSelectedUser(null)
    }
  }, [props.open])

  const showUserResults =
    props.open &&
    userKeyword.trim().length >= 1 &&
    (!selectedUser || userKeyword.trim() !== selectedUser.username)

  const usersQuery = useQuery({
    queryKey: ['department-reclaim-users', currentRow?.id, userKeyword],
    enabled: showUserResults && !!currentRow,
    queryFn: async () => {
      if (!currentRow) return []
      const result = await searchDepartmentGrantUsers({
        keyword: userKeyword.trim(),
        departmentId: currentRow.id,
        p: 1,
        page_size: 8,
      })
      if (!result.success) {
        throw createServerError(result, t('Failed to search users'))
      }
      return result.data?.items ?? []
    },
  })

  if (!currentRow) return null

  const selectedQuota = selectedUser?.quota ?? 0
  const quotaValue = parseQuotaFromDollars(Math.abs(Number.parseFloat(amount) || 0))

  const handleConfirm = async () => {
    if (!selectedUser) {
      toast.error(t('Select a user first'))
      return
    }
    if (quotaValue <= 0) {
      toast.error(t('Amount must be greater than zero'))
      return
    }
    setLoading(true)
    try {
      const result = await reclaimDepartmentQuota(
        currentRow.id,
        selectedUser.id,
        quotaValue,
        remark
      )
      if (!result.success) {
        handleServerError(result, t('Failed to reclaim department quota'))
        return
      }
      toast.success(t('Quota reclaimed to department'))
      props.onOpenChange(false)
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to reclaim department quota'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Reclaim department quota')}
      description={`${currentRow.name} · ${t('Balance')}: ${formatQuota(currentRow.quota)}`}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={loading}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !selectedUser || quotaValue <= 0}
          >
            {loading ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <p className='text-muted-foreground text-sm'>
        {t(
          'Only members of this department and its sub-departments can be searched or reclaimed.'
        )}
      </p>
      <div className='space-y-2'>
        <Label htmlFor='dept-reclaim-user'>{t('User')}</Label>
        <Input
          id='dept-reclaim-user'
          value={userKeyword}
          onChange={(e) => {
            setUserKeyword(e.target.value)
            setSelectedUser(null)
          }}
          placeholder={t('Search username or display name')}
        />
        {showUserResults ? (
          <div className='border-border max-h-40 overflow-y-auto rounded-md border'>
            {(usersQuery.data ?? []).length === 0 && !usersQuery.isFetching ? (
              <div className='text-muted-foreground p-3 text-sm'>
                {t('No users found')}
              </div>
            ) : (
              (usersQuery.data ?? []).map((user) => (
                <button
                  key={user.id}
                  type='button'
                  className='hover:bg-muted flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm'
                  onClick={() => {
                    setSelectedUser(user)
                    setUserKeyword(user.username)
                  }}
                >
                  <span className='min-w-0 truncate'>
                    {user.username}
                    {user.display_name ? ` (${user.display_name})` : ''}
                  </span>
                  <span className='text-muted-foreground shrink-0'>
                    {formatQuota(user.quota ?? 0)}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
        {selectedUser ? (
          <div className='bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm'>
            <span>
              {t('User balance')}:{' '}
              <span className='font-medium'>{formatQuota(selectedQuota)}</span>
            </span>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={selectedQuota <= 0 || loading}
              onClick={() =>
                setAmount(String(quotaUnitsToDollars(selectedQuota)))
              }
            >
              {t('Use max')}
            </Button>
          </div>
        ) : null}
      </div>
      <QuotaAmountFields
        amount={amount}
        remark={remark}
        onAmountChange={setAmount}
        onRemarkChange={setRemark}
      />
    </Dialog>
  )
}

function LedgerDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { currentRow } = useDepartments()
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (props.open) setPage(1)
  }, [props.open, currentRow?.id])

  const ledgerQuery = useQuery({
    queryKey: ['department-ledger', currentRow?.id, page],
    enabled: props.open && !!currentRow,
    queryFn: async () => {
      if (!currentRow) return { items: [], total: 0, page: 1, page_size: 20 }
      const result = await getDepartmentLedger(currentRow.id, page, 20)
      if (!result.success) {
        throw createServerError(result, t('Failed to load ledger'))
      }
      return (
        result.data ?? {
          items: [],
          total: 0,
          page,
          page_size: 20,
        }
      )
    },
  })

  if (!currentRow) return null

  const items = ledgerQuery.data?.items ?? []
  const total = ledgerQuery.data?.total ?? 0
  const pageSize = ledgerQuery.data?.page_size || 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const typeLabel = (type: string) => {
    if (type === 'topup') return t('Top up')
    if (type === 'grant_user') return t('Grant to user')
    if (type === 'transfer_out') return t('Transfer out')
    if (type === 'transfer_in') return t('Transfer in')
    if (type === 'reclaim_user') return t('Reclaim from user')
    return type
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Department ledger')}
      description={`${currentRow.name} (${currentRow.external_no})`}
      contentClassName='sm:max-w-3xl'
      bodyClassName='space-y-3'
      footer={
        <div className='flex w-full items-center justify-between gap-2'>
          <div className='text-muted-foreground text-sm'>
            {t('Page {{page}} of {{total}}', { page, total: totalPages })}
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              disabled={page <= 1 || ledgerQuery.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('Previous')}
            </Button>
            <Button
              variant='outline'
              disabled={page >= totalPages || ledgerQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('Next')}
            </Button>
            <Button variant='outline' onClick={() => props.onOpenChange(false)}>
              {t('Close')}
            </Button>
          </div>
        </div>
      }
    >
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50 text-left'>
            <tr>
              <th className='px-3 py-2 font-medium'>{t('Time')}</th>
              <th className='px-3 py-2 font-medium'>{t('Type')}</th>
              <th className='px-3 py-2 font-medium'>{t('Amount')}</th>
              <th className='px-3 py-2 font-medium'>{t('Balance after')}</th>
              <th className='px-3 py-2 font-medium'>{t('User')}</th>
              <th className='px-3 py-2 font-medium'>{t('Remark')}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className='text-muted-foreground px-3 py-6 text-center'
                >
                  {ledgerQuery.isLoading
                    ? t('Loading...')
                    : t('No ledger entries')}
                </td>
              </tr>
            ) : (
              items.map((entry) => (
                <tr key={entry.id} className='border-t'>
                  <td className='px-3 py-2 whitespace-nowrap'>
                    {new Date(entry.created_at).toLocaleString(locale)}
                  </td>
                  <td className='px-3 py-2'>{typeLabel(entry.type)}</td>
                  <td className='px-3 py-2'>
                    {entry.amount > 0 ? '+' : ''}
                    {formatQuota(entry.amount)}
                  </td>
                  <td className='px-3 py-2'>
                    {formatQuota(entry.dept_quota_after)}
                  </td>
                  <td className='px-3 py-2'>
                    {entry.target_user_id
                      ? `#${entry.target_user_id}`
                      : '—'}
                  </td>
                  <td className='max-w-40 truncate px-3 py-2'>
                    {entry.remark || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}

function TransferDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { currentRow, triggerRefresh } = useDepartments()
  const [toDepartmentId, setToDepartmentId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.open) {
      setToDepartmentId(null)
      setAmount('')
      setRemark('')
    }
  }, [props.open])

  const departmentsQuery = useQuery({
    queryKey: ['departments'],
    enabled: props.open && !!currentRow,
    queryFn: async () => {
      const result = await listDepartments()
      if (!result.success) {
        throw createServerError(result, t('Failed to load departments'))
      }
      return result.data ?? []
    },
  })

  if (!currentRow) return null

  const descendants = listDescendantDepartments(
    departmentsQuery.data ?? [],
    currentRow.id
  ).filter((dept) => dept.status === 'enabled')
  const quotaValue = parseQuotaFromDollars(
    Math.abs(Number.parseFloat(amount) || 0)
  )

  const handleConfirm = async () => {
    if (!toDepartmentId) {
      toast.error(t('Select a target department'))
      return
    }
    if (quotaValue <= 0) {
      toast.error(t('Amount must be greater than zero'))
      return
    }
    setLoading(true)
    try {
      const result = await transferDepartmentQuota(
        currentRow.id,
        toDepartmentId,
        quotaValue,
        remark
      )
      if (!result.success) {
        handleServerError(result, t('Failed to transfer department quota'))
        return
      }
      toast.success(t('Department quota transferred'))
      props.onOpenChange(false)
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to transfer department quota'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Transfer department quota')}
      description={`${currentRow.name} · ${t('Balance')}: ${formatQuota(currentRow.quota)}`}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={loading}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !toDepartmentId || quotaValue <= 0}
          >
            {loading ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <div className='space-y-2'>
        <Label>{t('Target department')}</Label>
        {descendants.length === 0 ? (
          <div className='text-muted-foreground text-sm'>
            {t('No descendant departments available')}
          </div>
        ) : (
          <DepartmentTreeSelect
            departments={descendants}
            pathDepartments={departmentsQuery.data ?? []}
            value={toDepartmentId}
            onValueChange={setToDepartmentId}
            className='w-full'
          />
        )}
      </div>
      <QuotaAmountFields
        amount={amount}
        remark={remark}
        onAmountChange={setAmount}
        onRemarkChange={setRemark}
      />
    </Dialog>
  )
}

function ManagersDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { currentRow, triggerRefresh } = useDepartments()
  const [userKeyword, setUserKeyword] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<DepartmentManager | null>(
    null
  )

  useEffect(() => {
    if (!props.open) {
      setUserKeyword('')
      setSelectedUserId(null)
      setPendingRemove(null)
    }
  }, [props.open])

  const managersQuery = useQuery({
    queryKey: ['department-managers', currentRow?.id],
    enabled: props.open && !!currentRow,
    queryFn: async () => {
      if (!currentRow) return []
      const result = await listDepartmentManagers(currentRow.id)
      if (!result.success) {
        throw createServerError(result, t('Failed to load department managers'))
      }
      return result.data ?? []
    },
  })

  const usersQuery = useQuery({
    queryKey: ['department-manager-users', userKeyword],
    enabled: props.open && userKeyword.trim().length >= 1,
    queryFn: async () => {
      const result = await searchUsers({
        keyword: userKeyword.trim(),
        p: 1,
        page_size: 8,
      })
      if (!result.success) {
        throw createServerError(result, t('Failed to search users'))
      }
      return result.data?.items ?? []
    },
  })

  if (!currentRow) return null

  const managers = managersQuery.data ?? []
  const managedUserIds = new Set(managers.map((m) => m.user_id))

  const handleAssign = async () => {
    if (!selectedUserId) {
      toast.error(t('Select a user first'))
      return
    }
    setAssigning(true)
    try {
      const result = await assignDepartmentManager(currentRow.id, selectedUserId)
      if (!result.success) {
        handleServerError(result, t('Failed to assign department manager'))
        return
      }
      toast.success(t('Department manager assigned'))
      setUserKeyword('')
      setSelectedUserId(null)
      await managersQuery.refetch()
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to assign department manager'))
    } finally {
      setAssigning(false)
    }
  }

  const handleRemove = async () => {
    if (!pendingRemove) return
    setRemoving(true)
    try {
      const result = await removeDepartmentManager(
        currentRow.id,
        pendingRemove.user_id
      )
      if (!result.success) {
        handleServerError(result, t('Failed to remove department manager'))
        return
      }
      toast.success(t('Department manager removed'))
      setPendingRemove(null)
      await managersQuery.refetch()
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to remove department manager'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={t('Department managers')}
        description={`${currentRow.name} (${currentRow.external_no})`}
        contentHeight='auto'
        bodyClassName='space-y-4'
        footer={
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
        }
      >
        <div className='space-y-2'>
          <Label htmlFor='dept-manager-user'>{t('Add manager')}</Label>
          <Input
            id='dept-manager-user'
            value={userKeyword}
            onChange={(e) => {
              setUserKeyword(e.target.value)
              setSelectedUserId(null)
            }}
            placeholder={t('Search username or display name')}
          />
          {userKeyword.trim() ? (
            <div className='border-border max-h-40 overflow-y-auto rounded-md border'>
              {(usersQuery.data ?? []).length === 0 && !usersQuery.isFetching ? (
                <div className='text-muted-foreground p-3 text-sm'>
                  {t('No users found')}
                </div>
              ) : (
                (usersQuery.data ?? []).map((user) => {
                  const already = managedUserIds.has(user.id)
                  return (
                    <button
                      key={user.id}
                      type='button'
                      disabled={already}
                      className={`hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm disabled:opacity-50 ${
                        selectedUserId === user.id ? 'bg-muted' : ''
                      }`}
                      onClick={() => {
                        setSelectedUserId(user.id)
                        setUserKeyword(user.username)
                      }}
                    >
                      <span>
                        {user.username}
                        {user.display_name ? ` (${user.display_name})` : ''}
                        {already ? ` · ${t('Already a manager')}` : ''}
                      </span>
                      <span className='text-muted-foreground'>#{user.id}</span>
                    </button>
                  )
                })
              )}
            </div>
          ) : null}
          <Button
            onClick={handleAssign}
            disabled={assigning || !selectedUserId}
          >
            {assigning ? t('Processing...') : t('Assign manager')}
          </Button>
        </div>

        <div className='space-y-2'>
          <Label>{t('Current managers')}</Label>
          <div className='border-border rounded-md border'>
            {managers.length === 0 ? (
              <div className='text-muted-foreground p-3 text-sm'>
                {managersQuery.isLoading
                  ? t('Loading...')
                  : t('No managers assigned')}
              </div>
            ) : (
              managers.map((manager) => (
                <div
                  key={manager.id}
                  className='flex items-center justify-between gap-3 border-t px-3 py-2 first:border-t-0'
                >
                  <div className='min-w-0'>
                    <div className='truncate text-sm font-medium'>
                      {manager.username}
                      {manager.display_name
                        ? ` (${manager.display_name})`
                        : ''}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      #{manager.user_id}
                    </div>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPendingRemove(manager)}
                  >
                    {t('Remove')}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(next) => {
          if (!next) setPendingRemove(null)
        }}
        title={t('Remove department manager')}
        desc={
          pendingRemove
            ? t(
                'Remove {{username}} as a manager of this department?',
                { username: pendingRemove.username }
              )
            : ''
        }
        confirmText={t('Remove')}
        destructive
        isLoading={removing}
        handleConfirm={handleRemove}
      />
    </>
  )
}
