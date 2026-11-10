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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchUsers } from '@/features/users/api'
import { useIsAdmin } from '@/hooks/use-admin'
import { formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  clearDepartmentMember,
  listDepartmentManagers,
  listDepartmentMembers,
  listDepartments,
  listUnassignedDepartmentMembers,
  setDepartmentMember,
} from '../api'
import {
  UNASSIGNED_DEPARTMENT_ID,
  type Department,
  type DepartmentMember,
} from '../types'
import { DepartmentTreeSelect } from './department-tree-select'
import { useDepartments } from './departments-provider'

type DepartmentsMembersPanelProps = {
  department: Department | null
}

type PersonRow = {
  user_id: number
  username: string
  display_name?: string
}

export function DepartmentsMembersPanel(props: DepartmentsMembersPanelProps) {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()
  const { setOpen, setCurrentRow, triggerRefresh } = useDepartments()
  const [userKeyword, setUserKeyword] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<DepartmentMember | null>(
    null
  )
  const [rowAssignDept, setRowAssignDept] = useState<Record<number, number>>(
    {}
  )
  const [rowAssigningId, setRowAssigningId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const department = props.department
  const isUnassigned =
    !!department?.is_unassigned || department?.id === UNASSIGNED_DEPARTMENT_ID
  const walletDisabled = !department || department.status !== 'enabled'

  useEffect(() => {
    setUserKeyword('')
    setSelectedUserId(null)
    setPendingRemove(null)
    setRowAssignDept({})
    setRowAssigningId(null)
    setShowAdd(false)
  }, [department?.id])

  const membersQuery = useQuery({
    queryKey: [
      'department-members',
      isUnassigned ? 'unassigned' : department?.id,
    ],
    enabled: !!department,
    queryFn: async () => {
      if (!department) return []
      if (isUnassigned) {
        const result = await listUnassignedDepartmentMembers()
        if (!result.success) {
          throw createServerError(
            result,
            t('Failed to load unassigned members')
          )
        }
        return result.data ?? []
      }
      const result = await listDepartmentMembers(department.id)
      if (!result.success) {
        throw createServerError(result, t('Failed to load department members'))
      }
      return result.data ?? []
    },
  })

  const managersQuery = useQuery({
    queryKey: ['department-managers', department?.id],
    enabled: !!department && !isUnassigned,
    queryFn: async () => {
      if (!department) return []
      const result = await listDepartmentManagers(department.id)
      if (!result.success) {
        throw createServerError(
          result,
          t('Failed to load department managers')
        )
      }
      return result.data ?? []
    },
  })

  const departmentsQuery = useQuery({
    queryKey: ['departments'],
    enabled: !!department && isAdmin && isUnassigned,
    queryFn: async () => {
      const result = await listDepartments()
      if (!result.success) {
        throw createServerError(result, t('Failed to load departments'))
      }
      return (result.data ?? []).filter((dept) => dept.status === 'enabled')
    },
  })

  const usersQuery = useQuery({
    queryKey: ['department-member-users', userKeyword],
    enabled:
      !!department &&
      isAdmin &&
      !isUnassigned &&
      showAdd &&
      userKeyword.trim().length >= 1,
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

  const members = membersQuery.data ?? []
  const managers = managersQuery.data ?? []
  const memberUserIds = new Set(members.map((m) => m.user_id))
  const targetDepartments = departmentsQuery.data ?? []
  const listLoading =
    membersQuery.isLoading || (!isUnassigned && managersQuery.isLoading)

  if (!department) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <EmptyState
          className='min-h-0'
          title={t('Select a department')}
          description={t(
            'Choose a department on the left to view its members.'
          )}
          bordered={false}
        />
      </div>
    )
  }

  const refreshMembership = async () => {
    await membersQuery.refetch()
    if (!isUnassigned) {
      await managersQuery.refetch()
    }
    await queryClient.invalidateQueries({
      queryKey: ['department-members-unassigned'],
    })
    triggerRefresh()
  }

  const openWalletDialog = (
    type: 'topup' | 'grant' | 'reclaim' | 'transfer' | 'ledger' | 'managers'
  ) => {
    setCurrentRow(department)
    setOpen(type)
  }

  const handleAssign = async () => {
    if (!selectedUserId) {
      toast.error(t('Select a user first'))
      return
    }
    setAssigning(true)
    try {
      const result = await setDepartmentMember(department.id, selectedUserId)
      if (!result.success) {
        handleServerError(result, t('Failed to assign department member'))
        return
      }
      toast.success(t('Department member assigned'))
      setUserKeyword('')
      setSelectedUserId(null)
      setShowAdd(false)
      await refreshMembership()
    } catch (error) {
      handleServerError(error, t('Failed to assign department member'))
    } finally {
      setAssigning(false)
    }
  }

  const handleAssignUnassignedRow = async (userId: number) => {
    const targetId = rowAssignDept[userId]
    if (!targetId) {
      toast.error(t('Select a target department'))
      return
    }
    setRowAssigningId(userId)
    try {
      const result = await setDepartmentMember(targetId, userId)
      if (!result.success) {
        handleServerError(result, t('Failed to assign department member'))
        return
      }
      toast.success(t('Department member assigned'))
      await refreshMembership()
    } catch (error) {
      handleServerError(error, t('Failed to assign department member'))
    } finally {
      setRowAssigningId(null)
    }
  }

  const handleRemove = async () => {
    if (!pendingRemove) return
    setRemoving(true)
    try {
      const result = await clearDepartmentMember(pendingRemove.user_id)
      if (!result.success) {
        handleServerError(result, t('Failed to remove department member'))
        return
      }
      toast.success(t('Department member removed'))
      setPendingRemove(null)
      await refreshMembership()
    } catch (error) {
      handleServerError(error, t('Failed to remove department member'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <div className='flex h-full min-h-0 flex-col'>
        <div className='border-border space-y-3 shrink-0 border-b p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0 space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <h3 className='truncate text-base font-semibold'>
                  {department.name}
                </h3>
                {isUnassigned ? (
                  <Badge variant='secondary'>{t('Virtual')}</Badge>
                ) : (
                  <Badge
                    variant={
                      department.status === 'enabled' ? 'default' : 'secondary'
                    }
                  >
                    {department.status === 'enabled'
                      ? t('Enabled')
                      : t('Disabled')}
                  </Badge>
                )}
              </div>
              {!isUnassigned ? (
                <div className='text-muted-foreground text-sm'>
                  {department.external_no}
                  {department.company_no
                    ? ` · ${t('Company')} ${department.company_no}`
                    : ''}
                  {` · ${t('Balance')}: ${formatQuota(department.quota)}`}
                  {` · ${t('Granted')}: ${formatQuota(department.used_quota)}`}
                </div>
              ) : (
                <div className='text-muted-foreground text-sm'>
                  {t(
                    'Users without a department membership. Assign them to a department to place them in the org tree.'
                  )}
                </div>
              )}
            </div>
            <div className='flex flex-wrap gap-2'>
              {!isUnassigned && isAdmin ? (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={walletDisabled}
                  onClick={() => openWalletDialog('topup')}
                >
                  {t('Top up')}
                </Button>
              ) : null}
              {!isUnassigned ? (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={walletDisabled}
                  onClick={() => openWalletDialog('grant')}
                >
                  {t('Grant to user')}
                </Button>
              ) : null}
              {!isUnassigned ? (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={walletDisabled}
                  onClick={() => openWalletDialog('reclaim')}
                >
                  {t('Reclaim')}
                </Button>
              ) : null}
              {!isUnassigned ? (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={walletDisabled}
                  onClick={() => openWalletDialog('transfer')}
                >
                  {t('Transfer')}
                </Button>
              ) : null}
              {!isUnassigned ? (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => openWalletDialog('ledger')}
                >
                  {t('View ledger')}
                </Button>
              ) : null}
              {!isUnassigned && isAdmin ? (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => openWalletDialog('managers')}
                >
                  {t('Managers')}
                </Button>
              ) : null}
              {isAdmin && !isUnassigned ? (
                <Button
                  size='sm'
                  onClick={() => setShowAdd((v) => !v)}
                >
                  {t('Add member')}
                </Button>
              ) : null}
            </div>
          </div>

          {isAdmin && !isUnassigned && showAdd ? (
            <div className='space-y-2 rounded-md border p-3'>
              <Label htmlFor='dept-member-user'>{t('Add member')}</Label>
              <Input
                id='dept-member-user'
                value={userKeyword}
                onChange={(e) => {
                  setUserKeyword(e.target.value)
                  setSelectedUserId(null)
                }}
                placeholder={t('Search username or display name')}
              />
              {userKeyword.trim() ? (
                <div className='border-border max-h-40 overflow-y-auto rounded-md border'>
                  {(usersQuery.data ?? []).length === 0 &&
                  !usersQuery.isFetching ? (
                    <div className='text-muted-foreground p-3 text-sm'>
                      {t('No users found')}
                    </div>
                  ) : (
                    (usersQuery.data ?? []).map((user) => {
                      const already = memberUserIds.has(user.id)
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
                            {user.display_name
                              ? ` (${user.display_name})`
                              : ''}
                            {already ? ` · ${t('Already a member')}` : ''}
                          </span>
                          <span className='text-muted-foreground'>
                            #{user.id}
                          </span>
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
                {assigning ? t('Processing...') : t('Assign member')}
              </Button>
            </div>
          ) : null}
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {(() => {
            if (listLoading) {
              return <LoadingState className='py-12' />
            }
            if (isUnassigned) {
              return (
                <div className='p-4'>
                  <PersonSection
                    title={t('Unassigned users')}
                    emptyText={t('No unassigned users')}
                    people={members}
                    bordered
                    renderActions={(person) =>
                      isAdmin ? (
                        <div className='flex flex-wrap items-center gap-2'>
                          <DepartmentTreeSelect
                            departments={targetDepartments}
                            value={rowAssignDept[person.user_id] ?? null}
                            onValueChange={(departmentId) => {
                              if (departmentId == null) return
                              setRowAssignDept((prev) => ({
                                ...prev,
                                [person.user_id]: departmentId,
                              }))
                            }}
                            size='sm'
                            className='max-w-72'
                          />
                          <Button
                            size='sm'
                            disabled={
                              rowAssigningId === person.user_id ||
                              !rowAssignDept[person.user_id]
                            }
                            onClick={() =>
                              handleAssignUnassignedRow(person.user_id)
                            }
                          >
                            {rowAssigningId === person.user_id
                              ? t('Processing...')
                              : t('Assign')}
                          </Button>
                        </div>
                      ) : null
                    }
                  />
                </div>
              )
            }
            return (
              <div className='space-y-4 p-4'>
                <PersonSection
                  title={t('Department managers')}
                  emptyText={t('No managers assigned')}
                  people={managers}
                  highlight
                  badgeLabel={t('Department manager')}
                  bordered
                />
                <PersonSection
                  title={t('Department employees')}
                  emptyText={t('No members assigned')}
                  people={members}
                  bordered
                  renderActions={(person) => {
                    if (!isAdmin) return null
                    const member = members.find(
                      (m) => m.user_id === person.user_id
                    )
                    if (!member) return null
                    return (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setPendingRemove(member)}
                      >
                        {t('Remove')}
                      </Button>
                    )
                  }}
                />
              </div>
            )
          })()}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(next) => {
          if (!next) setPendingRemove(null)
        }}
        title={t('Remove department member')}
        desc={
          pendingRemove
            ? t(
                'Remove {{username}} from this department? They will appear under Unassigned department.',
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

function PersonSection(props: {
  title: string
  emptyText: string
  people: PersonRow[]
  badgeLabel?: string
  highlight?: boolean
  bordered?: boolean
  renderActions?: (person: PersonRow) => ReactNode
}) {
  return (
    <section className='space-y-2'>
      <div className='flex items-center justify-between gap-2 px-1'>
        <h4 className='text-sm font-semibold'>{props.title}</h4>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {props.people.length}
        </span>
      </div>
      <div
        className={
          props.bordered
            ? 'border-border overflow-hidden rounded-md border'
            : undefined
        }
      >
        {props.people.length === 0 ? (
          <div className='text-muted-foreground px-3 py-4 text-sm'>
            {props.emptyText}
          </div>
        ) : (
          <div className='divide-border divide-y'>
            {props.people.map((person) => (
              <div
                key={person.user_id}
                className={
                  props.highlight
                    ? 'bg-primary/5 flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between'
                    : 'flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between'
                }
              >
                <div className='min-w-0 space-y-1'>
                  <div className='flex min-w-0 flex-wrap items-center gap-2'>
                    <span className='truncate text-sm font-medium'>
                      {person.username}
                      {person.display_name
                        ? ` (${person.display_name})`
                        : ''}
                    </span>
                    {props.badgeLabel ? (
                      <Badge
                        variant='warning'
                        className='border-warning font-semibold'
                      >
                        {props.badgeLabel}
                      </Badge>
                    ) : null}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    #{person.user_id}
                  </div>
                </div>
                {props.renderActions?.(person)}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
