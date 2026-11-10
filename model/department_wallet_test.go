package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDepartmentWalletMigrateAndCreate(t *testing.T) {
	truncateTables(t)

	dept := Department{
		ExternalNo: "10100",
		ExternalId: "76MAAAAANr3M567U",
		Name:       "办公室",
		CompanyNo:  "10",
		Level:      3,
		SortOrder:  80,
		SourceType: "HR",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&dept).Error)
	require.NotZero(t, dept.Id)

	wallet, err := EnsureDepartmentWallet(dept.Id)
	require.NoError(t, err)
	require.NotNil(t, wallet)
	assert.Equal(t, dept.Id, wallet.DepartmentId)
	assert.Equal(t, 0, wallet.Quota)
	assert.Equal(t, 0, wallet.UsedQuota)

	again, err := EnsureDepartmentWallet(dept.Id)
	require.NoError(t, err)
	assert.Equal(t, wallet.Id, again.Id)
	assert.Equal(t, 0, again.Quota)
}

func TestDepartmentExternalIdUnique(t *testing.T) {
	truncateTables(t)

	first := Department{
		ExternalNo: "10100",
		ExternalId: "76MAAAAANr3M567U",
		Name:       "办公室",
		CompanyNo:  "10",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&first).Error)

	dup := Department{
		ExternalNo: "10100X",
		ExternalId: "76MAAAAANr3M567U",
		Name:       "办公室-重复",
		CompanyNo:  "10",
		Status:     DepartmentStatusEnabled,
	}
	require.Error(t, DB.Create(&dup).Error)
}

func createDeptWalletTestUser(t *testing.T, quota int) User {
	t.Helper()
	user := User{
		Username:    "dept-wallet-" + common.GetRandomString(6),
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
		Quota:       quota,
		AffCode:     "dept-aff-" + common.GetRandomString(8),
	}
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func TestDepartmentTopupAndGrantToUser(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)

	dept := Department{
		ExternalNo: "10",
		ExternalId: "10",
		Name:       "集团公司",
		CompanyNo:  "10",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&dept).Error)
	_, err := EnsureDepartmentWallet(dept.Id)
	require.NoError(t, err)

	user := createDeptWalletTestUser(t, 50)

	require.NoError(t, TopupDepartment(dept.Id, 1000, 1, "initial"))
	wallet, err := GetDepartmentWallet(dept.Id)
	require.NoError(t, err)
	assert.Equal(t, 1000, wallet.Quota)

	require.NoError(t, GrantDepartmentToUser(dept.Id, user.Id, 300, 1, "team allot"))
	wallet, err = GetDepartmentWallet(dept.Id)
	require.NoError(t, err)
	assert.Equal(t, 700, wallet.Quota)
	assert.Equal(t, 350, getUserQuotaFromDB(t, user.Id))

	err = GrantDepartmentToUser(dept.Id, user.Id, 800, 1, "too much")
	require.ErrorIs(t, err, ErrDepartmentWalletInsufficient)
	wallet, err = GetDepartmentWallet(dept.Id)
	require.NoError(t, err)
	assert.Equal(t, 700, wallet.Quota)
	assert.Equal(t, 350, getUserQuotaFromDB(t, user.Id))

	var ledgers []DepartmentQuotaLedger
	require.NoError(t, DB.Where("department_id = ?", dept.Id).Order("id asc").Find(&ledgers).Error)
	require.Len(t, ledgers, 2)
	assert.Equal(t, DepartmentLedgerTopup, ledgers[0].Type)
	assert.Equal(t, 1000, ledgers[0].Amount)
	assert.Equal(t, DepartmentLedgerGrantUser, ledgers[1].Type)
	assert.Equal(t, -300, ledgers[1].Amount)
	assert.Equal(t, user.Id, ledgers[1].TargetUserId)
}

func TestSyncDepartmentsFromHRRows(t *testing.T) {
	truncateTables(t)

	const (
		rootID   = "00000000-0000-0000-0000-000000000000CCE7AED4"
		groupID  = "76MAAAAANrbM567U"
		officeID = "76MAAAAANr3M567U"
	)
	rows := []HROrgDeptRow{
		{DeptNo: "00", DeptID: rootID, DeptName: "徐州地铁集团有限公司", CompNo: "00", PDeptNo: "-1", PDeptID: "-1", Level: 1, IsSealUp: 0, IsDel: 0, FOrder: 1, DeptType: "HR"},
		{DeptNo: "10", DeptID: groupID, DeptName: "集团公司", CompNo: "10", PDeptNo: "00", PDeptID: rootID, Level: 2, IsSealUp: 0, IsDel: 0, FOrder: 10, DeptType: "HR"},
		{DeptNo: "10100", DeptID: officeID, DeptName: "办公室", CompNo: "10", PDeptNo: "10", PDeptID: groupID, Level: 3, IsSealUp: 0, IsDel: 0, FOrder: 80, DeptType: "HR"},
		{DeptNo: "10110", DeptID: "76MAAAAANsXM567U", DeptName: "党委组织部（人力资源中心）", CompNo: "10", PDeptNo: "10", PDeptID: groupID, Level: 3, IsSealUp: 0, IsDel: 0, FOrder: 160, DeptType: "HR"},
		{DeptNo: "10120", DeptID: "76MAAAAANszM567U", DeptName: "党群工作部", CompNo: "10", PDeptNo: "10", PDeptID: groupID, Level: 3, IsSealUp: 0, IsDel: 0, FOrder: 90, DeptType: "HR"},
	}
	require.NoError(t, SyncDepartmentsFromHRRows(rows))

	var depts []Department
	require.NoError(t, DB.Order("external_no asc").Find(&depts).Error)
	require.Len(t, depts, 5)

	byNo := map[string]Department{}
	for _, d := range depts {
		byNo[d.ExternalNo] = d
		wallet, err := GetDepartmentWallet(d.Id)
		require.NoError(t, err)
		assert.Equal(t, 0, wallet.Quota)
	}
	root := byNo["00"]
	group := byNo["10"]
	office := byNo["10100"]
	assert.Nil(t, root.ParentId)
	require.NotNil(t, group.ParentId)
	assert.Equal(t, root.Id, *group.ParentId)
	require.NotNil(t, office.ParentId)
	assert.Equal(t, group.Id, *office.ParentId)
	assert.Equal(t, rootID, group.ParentExternalId)
	assert.Equal(t, "00", group.ParentExternalNo)

	// DEPT_ID is the durable key: renaming DEPT_NO must keep the same row.
	officeIDBefore := office.Id
	rows[2].DeptNo = "10100X"
	require.NoError(t, SyncDepartmentsFromHRRows(rows))
	var renamed Department
	require.NoError(t, DB.Where("external_id = ?", officeID).First(&renamed).Error)
	assert.Equal(t, officeIDBefore, renamed.Id)
	assert.Equal(t, "10100X", renamed.ExternalNo)

	rows[2].IsDel = 1
	require.NoError(t, SyncDepartmentsFromHRRows(rows))
	var disabled Department
	require.NoError(t, DB.Where("external_id = ?", officeID).First(&disabled).Error)
	assert.Equal(t, DepartmentStatusDisabled, disabled.Status)
	_, err := GetDepartmentWallet(disabled.Id)
	require.NoError(t, err)
}

func TestListDepartmentsWithWallets(t *testing.T) {
	truncateTables(t)

	dept := Department{
		ExternalNo: "20100",
		ExternalId: "20100",
		Name:       "财务部",
		CompanyNo:  "20",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&dept).Error)
	require.NoError(t, TopupDepartment(dept.Id, 500, 1, "seed"))

	items, err := ListDepartmentsWithWallets()
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, dept.Id, items[0].Id)
	assert.Equal(t, 500, items[0].Quota)
	assert.Equal(t, 0, items[0].UsedQuota)
}

func TestListDepartmentsWithWalletsForIDs(t *testing.T) {
	truncateTables(t)

	deptA := Department{
		ExternalNo: "40100",
		ExternalId: "40100",
		Name:       "A部",
		CompanyNo:  "40",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&deptA).Error)
	deptB := Department{
		ExternalNo: "40200",
		ExternalId: "40200",
		Name:       "B部",
		CompanyNo:  "40",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&deptB).Error)
	require.NoError(t, TopupDepartment(deptA.Id, 100, 1, "a"))
	require.NoError(t, TopupDepartment(deptB.Id, 200, 1, "b"))

	items, err := ListDepartmentsWithWalletsForIDs([]int{deptA.Id})
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, deptA.Id, items[0].Id)
	assert.Equal(t, 100, items[0].Quota)

	empty, err := ListDepartmentsWithWalletsForIDs(nil)
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestDepartmentManagerAssignAndQuery(t *testing.T) {
	truncateTables(t)

	dept := Department{
		ExternalNo: "30100",
		ExternalId: "30100",
		Name:       "技术部",
		CompanyNo:  "30",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&dept).Error)
	other := Department{
		ExternalNo: "30200",
		ExternalId: "30200",
		Name:       "市场部",
		CompanyNo:  "30",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&other).Error)
	user := createDeptWalletTestUser(t, 0)

	require.NoError(t, AssignDepartmentManager(dept.Id, user.Id))
	require.NoError(t, AssignDepartmentManager(dept.Id, user.Id)) // idempotent

	ok, err := IsDepartmentManager(dept.Id, user.Id)
	require.NoError(t, err)
	assert.True(t, ok)

	ok, err = IsDepartmentManager(other.Id, user.Id)
	require.NoError(t, err)
	assert.False(t, ok)

	ids, err := ListManagedDepartmentIDs(user.Id)
	require.NoError(t, err)
	assert.Equal(t, []int{dept.Id}, ids)

	managers, err := ListDepartmentManagers(dept.Id)
	require.NoError(t, err)
	require.Len(t, managers, 1)
	assert.Equal(t, user.Id, managers[0].UserId)
	assert.Equal(t, user.Username, managers[0].Username)

	require.NoError(t, RemoveDepartmentManager(dept.Id, user.Id))
	ok, err = IsDepartmentManager(dept.Id, user.Id)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestDepartmentManagerSubtreeAccess(t *testing.T) {
	truncateTables(t)

	root := Department{
		ExternalNo: "50",
		ExternalId: "50",
		Name:       "集团",
		CompanyNo:  "50",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&root).Error)
	child := Department{
		ExternalNo:       "50100",
		ExternalId:       "50100",
		Name:             "办公室",
		CompanyNo:        "50",
		ParentId:         &root.Id,
		ParentExternalNo: "50",
		ParentExternalId: "50",
		Status:           DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&child).Error)
	grand := Department{
		ExternalNo:       "50101",
		ExternalId:       "50101",
		Name:             "秘书组",
		CompanyNo:        "50",
		ParentId:         &child.Id,
		ParentExternalNo: "50100",
		ParentExternalId: "50100",
		Status:           DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&grand).Error)
	sibling := Department{
		ExternalNo: "50200",
		ExternalId: "50200",
		Name:       "无关部门",
		CompanyNo:  "50",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&sibling).Error)

	user := createDeptWalletTestUser(t, 0)
	require.NoError(t, AssignDepartmentManager(root.Id, user.Id))

	ok, err := CanManageDepartment(root.Id, user.Id)
	require.NoError(t, err)
	assert.True(t, ok)
	ok, err = CanManageDepartment(child.Id, user.Id)
	require.NoError(t, err)
	assert.True(t, ok)
	ok, err = CanManageDepartment(grand.Id, user.Id)
	require.NoError(t, err)
	assert.True(t, ok)
	ok, err = CanManageDepartment(sibling.Id, user.Id)
	require.NoError(t, err)
	assert.False(t, ok)

	ids, err := ListAccessibleDepartmentIDs(user.Id)
	require.NoError(t, err)
	assert.Equal(t, []int{root.Id, child.Id, grand.Id}, ids)
}

func TestDepartmentMemberAssignAndUnassigned(t *testing.T) {
	truncateTables(t)

	dept := Department{
		ExternalNo: "70100",
		ExternalId: "70100",
		Name:       "研发部",
		CompanyNo:  "70",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&dept).Error)
	other := Department{
		ExternalNo: "70200",
		ExternalId: "70200",
		Name:       "产品部",
		CompanyNo:  "70",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&other).Error)
	u1 := createDeptWalletTestUser(t, 0)
	u2 := createDeptWalletTestUser(t, 0)

	require.NoError(t, SetDepartmentMember(dept.Id, u1.Id))
	require.NoError(t, SetDepartmentMember(dept.Id, u1.Id))  // idempotent
	require.NoError(t, SetDepartmentMember(other.Id, u1.Id)) // move

	members, err := ListDepartmentMembers(other.Id)
	require.NoError(t, err)
	require.Len(t, members, 1)
	assert.Equal(t, u1.Id, members[0].UserId)
	assert.Equal(t, u1.Username, members[0].Username)

	empty, err := ListDepartmentMembers(dept.Id)
	require.NoError(t, err)
	assert.Empty(t, empty)

	unassigned, err := ListUnassignedDepartmentUsers(0, 50)
	require.NoError(t, err)
	ids := make([]int, 0, len(unassigned))
	for _, u := range unassigned {
		ids = append(ids, u.UserId)
	}
	assert.Contains(t, ids, u2.Id)
	assert.NotContains(t, ids, u1.Id)

	require.NoError(t, ClearDepartmentMember(u1.Id))
	unassigned, err = ListUnassignedDepartmentUsers(0, 50)
	require.NoError(t, err)
	ids = ids[:0]
	for _, u := range unassigned {
		ids = append(ids, u.UserId)
	}
	assert.Contains(t, ids, u1.Id)
	assert.Contains(t, ids, u2.Id)
}

func TestDepartmentTransferToDescendant(t *testing.T) {
	truncateTables(t)

	parent := Department{
		ExternalNo: "60",
		ExternalId: "60",
		Name:       "父部门",
		CompanyNo:  "60",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&parent).Error)
	child := Department{
		ExternalNo:       "60100",
		ExternalId:       "60100",
		Name:             "子部门",
		CompanyNo:        "60",
		ParentId:         &parent.Id,
		ParentExternalNo: "60",
		ParentExternalId: "60",
		Status:           DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&child).Error)
	other := Department{
		ExternalNo: "60200",
		ExternalId: "60200",
		Name:       "非下级",
		CompanyNo:  "60",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&other).Error)

	require.NoError(t, TopupDepartment(parent.Id, 1000, 1, "seed"))
	require.NoError(t, TransferDepartmentQuota(parent.Id, child.Id, 400, 1, "alloc"))

	pw, err := GetDepartmentWallet(parent.Id)
	require.NoError(t, err)
	assert.Equal(t, 600, pw.Quota)
	cw, err := GetDepartmentWallet(child.Id)
	require.NoError(t, err)
	assert.Equal(t, 400, cw.Quota)

	var ledgers []DepartmentQuotaLedger
	require.NoError(t, DB.Where("department_id IN ?", []int{parent.Id, child.Id}).Order("id asc").Find(&ledgers).Error)
	require.GreaterOrEqual(t, len(ledgers), 3) // topup + out + in
	var outRow, inRow *DepartmentQuotaLedger
	for i := range ledgers {
		switch ledgers[i].Type {
		case DepartmentLedgerTransferOut:
			outRow = &ledgers[i]
		case DepartmentLedgerTransferIn:
			inRow = &ledgers[i]
		}
	}
	require.NotNil(t, outRow)
	require.NotNil(t, inRow)
	assert.Equal(t, -400, outRow.Amount)
	assert.Equal(t, child.Id, outRow.CounterpartyDepartmentId)
	assert.Equal(t, 400, inRow.Amount)
	assert.Equal(t, parent.Id, inRow.CounterpartyDepartmentId)

	err = TransferDepartmentQuota(parent.Id, other.Id, 100, 1, "bad")
	require.ErrorIs(t, err, ErrDepartmentTransferNotDescendant)

	err = TransferDepartmentQuota(parent.Id, child.Id, 700, 1, "too much")
	require.ErrorIs(t, err, ErrDepartmentWalletInsufficient)
	pw, err = GetDepartmentWallet(parent.Id)
	require.NoError(t, err)
	assert.Equal(t, 600, pw.Quota)
}

func TestDepartmentReclaimFromUser(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)

	parent := Department{
		ExternalNo: "70",
		ExternalId: "70",
		Name:       "回收测试部",
		CompanyNo:  "70",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&parent).Error)
	child := Department{
		ExternalNo:       "70100",
		ExternalId:       "70100",
		Name:             "回收子部门",
		CompanyNo:        "70",
		ParentId:         &parent.Id,
		ParentExternalNo: "70",
		ParentExternalId: "70",
		Status:           DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&child).Error)
	other := Department{
		ExternalNo: "71",
		ExternalId: "71",
		Name:       "无关部门",
		CompanyNo:  "71",
		Status:     DepartmentStatusEnabled,
	}
	require.NoError(t, DB.Create(&other).Error)

	member := createDeptWalletTestUser(t, 50)
	childMember := createDeptWalletTestUser(t, 50)
	outsider := createDeptWalletTestUser(t, 50)
	require.NoError(t, SetDepartmentMember(parent.Id, member.Id))
	require.NoError(t, SetDepartmentMember(child.Id, childMember.Id))
	require.NoError(t, SetDepartmentMember(other.Id, outsider.Id))

	require.NoError(t, TopupDepartment(parent.Id, 1000, 1, "seed"))
	require.NoError(t, GrantDepartmentToUser(parent.Id, member.Id, 300, 1, "grant"))
	require.NoError(t, GrantDepartmentToUser(parent.Id, childMember.Id, 200, 1, "child grant"))

	wallet, err := GetDepartmentWallet(parent.Id)
	require.NoError(t, err)
	assert.Equal(t, 500, wallet.Quota)
	assert.Equal(t, 500, wallet.UsedQuota)

	require.NoError(t, ReclaimDepartmentFromUser(parent.Id, member.Id, 100, 1, "partial"))
	wallet, err = GetDepartmentWallet(parent.Id)
	require.NoError(t, err)
	assert.Equal(t, 600, wallet.Quota)
	assert.Equal(t, 400, wallet.UsedQuota)
	assert.Equal(t, 250, getUserQuotaFromDB(t, member.Id))

	require.NoError(t, ReclaimDepartmentFromUser(parent.Id, childMember.Id, 50, 1, "from child"))
	wallet, err = GetDepartmentWallet(parent.Id)
	require.NoError(t, err)
	assert.Equal(t, 650, wallet.Quota)
	assert.Equal(t, 350, wallet.UsedQuota)

	err = ReclaimDepartmentFromUser(parent.Id, outsider.Id, 10, 1, "outsider")
	require.ErrorIs(t, err, ErrDepartmentReclaimUserOutOfScope)

	err = ReclaimDepartmentFromUser(parent.Id, member.Id, 999, 1, "too much")
	require.ErrorIs(t, err, ErrUserQuotaInsufficient)
	wallet, err = GetDepartmentWallet(parent.Id)
	require.NoError(t, err)
	assert.Equal(t, 650, wallet.Quota)
	assert.Equal(t, 350, wallet.UsedQuota)
	assert.Equal(t, 250, getUserQuotaFromDB(t, member.Id))

	found, total, err := SearchUsersInDepartmentSubtree(parent.Id, member.Username, 0, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, found, 1)
	assert.Equal(t, member.Id, found[0].Id)

	found, total, err = SearchUsersInDepartmentSubtree(parent.Id, outsider.Username, 0, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Empty(t, found)

	var ledgers []DepartmentQuotaLedger
	require.NoError(t, DB.Where("department_id = ? AND type = ?", parent.Id, DepartmentLedgerReclaimUser).Find(&ledgers).Error)
	require.Len(t, ledgers, 2)
}
