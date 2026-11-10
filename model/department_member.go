package model

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const UnassignedDepartmentID = 0

var (
	ErrDepartmentMemberNotFound = errors.New("department member not found")
	ErrInvalidDepartmentMember  = errors.New("invalid department or user id")
)

// DepartmentMember links a user to exactly one department for org roster.
type DepartmentMember struct {
	Id           int       `json:"id"`
	DepartmentId int       `json:"department_id" gorm:"index;not null"`
	UserId       int       `json:"user_id" gorm:"uniqueIndex;not null"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DepartmentMember) TableName() string {
	return "department_members"
}

// DepartmentMemberView is a roster row enriched with user display fields.
type DepartmentMemberView struct {
	Id           int       `json:"id"`
	DepartmentId int       `json:"department_id"`
	UserId       int       `json:"user_id"`
	Username     string    `json:"username"`
	DisplayName  string    `json:"display_name"`
	CreatedAt    time.Time `json:"created_at"`
}

// SetDepartmentMember assigns userId to departmentId. If the user already
// belongs to another department, the membership is moved.
func SetDepartmentMember(departmentId, userId int) error {
	if departmentId <= 0 || userId <= 0 {
		return ErrInvalidDepartmentMember
	}
	if _, err := GetDepartmentById(departmentId); err != nil {
		return err
	}
	var user User
	if err := DB.Select("id").First(&user, userId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrDepartmentManagerUserMissing
		}
		return err
	}
	row := DepartmentMember{DepartmentId: departmentId, UserId: userId}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"department_id", "updated_at"}),
	}).Create(&row).Error
}

func ClearDepartmentMember(userId int) error {
	if userId <= 0 {
		return ErrInvalidDepartmentMember
	}
	result := DB.Where("user_id = ?", userId).Delete(&DepartmentMember{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrDepartmentMemberNotFound
	}
	return nil
}

func ListDepartmentMembers(departmentId int) ([]*DepartmentMemberView, error) {
	if departmentId <= 0 {
		return nil, ErrInvalidDepartmentMember
	}
	var rows []DepartmentMember
	if err := DB.Where("department_id = ?", departmentId).
		Order("id asc").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	return enrichDepartmentMembers(rows)
}

// ListUnassignedDepartmentUsers returns enabled users with no department membership.
func ListUnassignedDepartmentUsers(offset, limit int) ([]*DepartmentMemberView, error) {
	if limit <= 0 {
		limit = 50
	}
	type row struct {
		Id          int
		Username    string
		DisplayName string
	}
	var users []row
	err := DB.Table("users").
		Select("users.id, users.username, users.display_name").
		Joins("LEFT JOIN department_members ON department_members.user_id = users.id").
		Where("department_members.id IS NULL").
		Order("users.id asc").
		Offset(offset).
		Limit(limit).
		Find(&users).Error
	if err != nil {
		return nil, err
	}
	views := make([]*DepartmentMemberView, 0, len(users))
	for _, u := range users {
		views = append(views, &DepartmentMemberView{
			DepartmentId: UnassignedDepartmentID,
			UserId:       u.Id,
			Username:     u.Username,
			DisplayName:  u.DisplayName,
		})
	}
	return views, nil
}

func CountDepartmentMembers(departmentId int) (int64, error) {
	if departmentId <= 0 {
		return 0, nil
	}
	var count int64
	err := DB.Model(&DepartmentMember{}).
		Where("department_id = ?", departmentId).
		Count(&count).Error
	return count, err
}

// GetUserDepartmentID returns the user's membership department id, or 0 when unassigned.
func GetUserDepartmentID(userId int) (int, error) {
	if userId <= 0 {
		return 0, nil
	}
	var row DepartmentMember
	err := DB.Select("department_id").Where("user_id = ?", userId).First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil
		}
		return 0, err
	}
	return row.DepartmentId, nil
}

// IsUserInDepartmentSubtree is true when the user is a member of ancestorDepartmentId
// or any of its descendant departments.
func IsUserInDepartmentSubtree(userId, ancestorDepartmentId int) (bool, error) {
	if userId <= 0 || ancestorDepartmentId <= 0 {
		return false, nil
	}
	memberDeptID, err := GetUserDepartmentID(userId)
	if err != nil || memberDeptID <= 0 {
		return false, err
	}
	if memberDeptID == ancestorDepartmentId {
		return true, nil
	}
	return IsDepartmentDescendant(memberDeptID, ancestorDepartmentId)
}

// SearchUsersInDepartmentSubtree searches users who belong to departmentId or its descendants.
func SearchUsersInDepartmentSubtree(departmentId int, keyword string, startIdx, num int) ([]*User, int64, error) {
	if departmentId <= 0 {
		return []*User{}, 0, nil
	}
	if num <= 0 {
		num = 10
	}
	deptIDs, err := ExpandDepartmentSubtreeIDs([]int{departmentId})
	if err != nil {
		return nil, 0, err
	}
	if len(deptIDs) == 0 {
		return []*User{}, 0, nil
	}

	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&User{}).
		Joins("INNER JOIN department_members ON department_members.user_id = users.id").
		Where("department_members.department_id IN ?", deptIDs)

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		likeCondition := "users.username LIKE ? OR users.email LIKE ? OR users.display_name LIKE ?"
		likeArgs := []any{"%" + keyword + "%", "%" + keyword + "%", "%" + keyword + "%"}
		if keywordInt, atoiErr := strconv.Atoi(keyword); atoiErr == nil {
			likeCondition = "users.id = ? OR " + likeCondition
			likeArgs = append([]any{keywordInt}, likeArgs...)
		}
		query = query.Where("("+likeCondition+")", likeArgs...)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	var users []*User
	if err := query.Omit("password", "access_token").
		Order("users.id asc").
		Limit(num).
		Offset(startIdx).
		Find(&users).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err := tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func enrichDepartmentMembers(rows []DepartmentMember) ([]*DepartmentMemberView, error) {
	if len(rows) == 0 {
		return []*DepartmentMemberView{}, nil
	}
	userIDs := make([]int, 0, len(rows))
	for _, row := range rows {
		userIDs = append(userIDs, row.UserId)
	}
	var users []User
	if err := DB.Select("id", "username", "display_name").
		Where("id IN ?", userIDs).
		Find(&users).Error; err != nil {
		return nil, err
	}
	byID := make(map[int]User, len(users))
	for _, u := range users {
		byID[u.Id] = u
	}
	views := make([]*DepartmentMemberView, 0, len(rows))
	for _, row := range rows {
		view := &DepartmentMemberView{
			Id:           row.Id,
			DepartmentId: row.DepartmentId,
			UserId:       row.UserId,
			CreatedAt:    row.CreatedAt,
		}
		if u, ok := byID[row.UserId]; ok {
			view.Username = u.Username
			view.DisplayName = u.DisplayName
		}
		views = append(views, view)
	}
	return views, nil
}
