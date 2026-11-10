package model

import (
	"errors"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	DepartmentStatusEnabled  = "enabled"
	DepartmentStatusDisabled = "disabled"
)

// Department is a local mirror of an HR organization unit.
// ExternalId maps to HR DEPT_ID and is the durable sync key (case-sensitive).
// ExternalNo maps to HR DEPT_NO and is used for display/search.
type Department struct {
	Id               int        `json:"id"`
	ExternalNo       string     `json:"external_no" gorm:"type:varchar(64);index;not null"`
	ExternalId       string     `json:"external_id" gorm:"type:varchar(255);uniqueIndex;not null"`
	Name             string     `json:"name" gorm:"type:varchar(255);not null"`
	CompanyNo        string     `json:"company_no" gorm:"type:varchar(16);index"`
	ParentId         *int       `json:"parent_id" gorm:"index"`
	ParentExternalNo string     `json:"parent_external_no" gorm:"type:varchar(64)"`
	ParentExternalId string     `json:"parent_external_id" gorm:"type:varchar(255);index"`
	Level            int        `json:"level"`
	SortOrder        int        `json:"sort_order"`
	SourceType       string     `json:"source_type" gorm:"type:varchar(16)"`
	Status           string     `json:"status" gorm:"type:varchar(16);index;default:enabled"`
	LastSyncedAt     *time.Time `json:"last_synced_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

func (Department) TableName() string {
	return "departments"
}

func GetDepartmentById(id int) (*Department, error) {
	if id <= 0 {
		return nil, errors.New("invalid department id")
	}
	var dept Department
	if err := DB.First(&dept, id).Error; err != nil {
		return nil, err
	}
	return &dept, nil
}

// GetDepartmentByMatchField looks up a department by external_no or external_id.
// external_no is not unique; the first enabled match (then any match) is returned.
func GetDepartmentByMatchField(matchField, value string) (*Department, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, gorm.ErrRecordNotFound
	}
	column := ""
	switch strings.ToLower(strings.TrimSpace(matchField)) {
	case "external_no":
		column = "external_no"
	case "external_id":
		column = "external_id"
	default:
		return nil, errors.New("unsupported department match field")
	}
	var dept Department
	err := DB.Where(column+" = ? AND status = ?", value, DepartmentStatusEnabled).
		Order("id asc").
		First(&dept).Error
	if err == nil {
		return &dept, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	err = DB.Where(column+" = ?", value).Order("id asc").First(&dept).Error
	if err != nil {
		return nil, err
	}
	return &dept, nil
}

// DepartmentListItem is a department row with wallet balances for admin UI.
type DepartmentListItem struct {
	Department
	Quota       int `json:"quota"`
	UsedQuota   int `json:"used_quota"`
	MemberCount int `json:"member_count"`
}

func ListDepartments() ([]*Department, error) {
	var depts []*Department
	err := DB.Order("sort_order asc, external_no asc").Find(&depts).Error
	return depts, err
}

func ListDepartmentsWithWallets() ([]*DepartmentListItem, error) {
	depts, err := ListDepartments()
	if err != nil {
		return nil, err
	}
	if len(depts) == 0 {
		return []*DepartmentListItem{}, nil
	}
	ids := make([]int, 0, len(depts))
	for _, d := range depts {
		ids = append(ids, d.Id)
	}
	return ListDepartmentsWithWalletsForIDs(ids)
}

func ListDepartmentsWithWalletsForIDs(ids []int) ([]*DepartmentListItem, error) {
	if len(ids) == 0 {
		return []*DepartmentListItem{}, nil
	}
	var depts []*Department
	if err := DB.Where("id IN ?", ids).
		Order("sort_order asc, external_no asc").
		Find(&depts).Error; err != nil {
		return nil, err
	}
	if len(depts) == 0 {
		return []*DepartmentListItem{}, nil
	}
	deptIDs := make([]int, 0, len(depts))
	for _, d := range depts {
		deptIDs = append(deptIDs, d.Id)
	}
	var wallets []DepartmentWallet
	if err := DB.Where("department_id IN ?", deptIDs).Find(&wallets).Error; err != nil {
		return nil, err
	}
	byDept := make(map[int]DepartmentWallet, len(wallets))
	for _, w := range wallets {
		byDept[w.DepartmentId] = w
	}
	type memberCountRow struct {
		DepartmentId int
		Count        int64
	}
	var memberCounts []memberCountRow
	if err := DB.Model(&DepartmentMember{}).
		Select("department_id, count(*) as count").
		Where("department_id IN ?", deptIDs).
		Group("department_id").
		Find(&memberCounts).Error; err != nil {
		return nil, err
	}
	countByDept := make(map[int]int, len(memberCounts))
	for _, row := range memberCounts {
		countByDept[row.DepartmentId] = int(row.Count)
	}
	items := make([]*DepartmentListItem, 0, len(depts))
	for _, d := range depts {
		item := &DepartmentListItem{Department: *d}
		if w, ok := byDept[d.Id]; ok {
			item.Quota = w.Quota
			item.UsedQuota = w.UsedQuota
		}
		item.MemberCount = countByDept[d.Id]
		items = append(items, item)
	}
	return items, nil
}

func IsDepartmentManagerOfAny(userId int) (bool, error) {
	ids, err := ListManagedDepartmentIDs(userId)
	if err != nil {
		return false, err
	}
	return len(ids) > 0, nil
}

// ListAccessibleDepartmentIDs returns departments the user is assigned to manage,
// plus every descendant of those departments.
func ListAccessibleDepartmentIDs(userId int) ([]int, error) {
	roots, err := ListManagedDepartmentIDs(userId)
	if err != nil {
		return nil, err
	}
	return ExpandDepartmentSubtreeIDs(roots)
}

// ExpandDepartmentSubtreeIDs returns rootIDs plus all descendants (any depth).
func ExpandDepartmentSubtreeIDs(rootIDs []int) ([]int, error) {
	if len(rootIDs) == 0 {
		return []int{}, nil
	}
	var all []Department
	if err := DB.Select("id", "parent_id").Find(&all).Error; err != nil {
		return nil, err
	}
	children := make(map[int][]int, len(all))
	for _, d := range all {
		if d.ParentId == nil {
			continue
		}
		children[*d.ParentId] = append(children[*d.ParentId], d.Id)
	}
	seen := make(map[int]struct{}, len(rootIDs))
	queue := make([]int, 0, len(rootIDs))
	for _, id := range rootIDs {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		queue = append(queue, id)
	}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, childID := range children[id] {
			if _, ok := seen[childID]; ok {
				continue
			}
			seen[childID] = struct{}{}
			queue = append(queue, childID)
		}
	}
	out := make([]int, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	slices.Sort(out)
	return out, nil
}

// CanManageDepartment is true when the user is an assigned manager of the
// department or of any ancestor department.
func CanManageDepartment(departmentId, userId int) (bool, error) {
	if departmentId <= 0 || userId <= 0 {
		return false, nil
	}
	managed, err := ListManagedDepartmentIDs(userId)
	if err != nil {
		return false, err
	}
	if len(managed) == 0 {
		return false, nil
	}
	managedSet := make(map[int]struct{}, len(managed))
	for _, id := range managed {
		managedSet[id] = struct{}{}
	}
	if _, ok := managedSet[departmentId]; ok {
		return true, nil
	}
	currentID := departmentId
	for range 64 {
		var dept Department
		if err := DB.Select("id", "parent_id").First(&dept, currentID).Error; err != nil {
			return false, err
		}
		if dept.ParentId == nil {
			return false, nil
		}
		if _, ok := managedSet[*dept.ParentId]; ok {
			return true, nil
		}
		currentID = *dept.ParentId
	}
	return false, nil
}

// IsDepartmentDescendant reports whether candidateId is under ancestorId
// (any depth). candidateId == ancestorId is false.
func IsDepartmentDescendant(candidateId, ancestorId int) (bool, error) {
	if candidateId <= 0 || ancestorId <= 0 || candidateId == ancestorId {
		return false, nil
	}
	currentID := candidateId
	for range 64 {
		var dept Department
		if err := DB.Select("id", "parent_id").First(&dept, currentID).Error; err != nil {
			return false, err
		}
		if dept.ParentId == nil {
			return false, nil
		}
		if *dept.ParentId == ancestorId {
			return true, nil
		}
		currentID = *dept.ParentId
	}
	return false, nil
}
