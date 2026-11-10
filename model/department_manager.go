package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrDepartmentManagerNotFound    = errors.New("department manager not found")
	ErrInvalidDepartmentManager     = errors.New("invalid department or user id")
	ErrDepartmentManagerUserMissing = errors.New("user does not exist")
)

// DepartmentManager links a user as a manager of a department.
type DepartmentManager struct {
	Id           int       `json:"id"`
	DepartmentId int       `json:"department_id" gorm:"uniqueIndex:uk_dept_manager;not null"`
	UserId       int       `json:"user_id" gorm:"uniqueIndex:uk_dept_manager;index;not null"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DepartmentManager) TableName() string {
	return "department_managers"
}

// DepartmentManagerView is a manager row enriched with user display fields.
type DepartmentManagerView struct {
	Id           int       `json:"id"`
	DepartmentId int       `json:"department_id"`
	UserId       int       `json:"user_id"`
	Username     string    `json:"username"`
	DisplayName  string    `json:"display_name"`
	CreatedAt    time.Time `json:"created_at"`
}

func AssignDepartmentManager(departmentId, userId int) error {
	if departmentId <= 0 || userId <= 0 {
		return ErrInvalidDepartmentManager
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
	row := DepartmentManager{DepartmentId: departmentId, UserId: userId}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "department_id"}, {Name: "user_id"}},
		DoNothing: true,
	}).Create(&row).Error
}

func RemoveDepartmentManager(departmentId, userId int) error {
	if departmentId <= 0 || userId <= 0 {
		return ErrInvalidDepartmentManager
	}
	result := DB.Where("department_id = ? AND user_id = ?", departmentId, userId).
		Delete(&DepartmentManager{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrDepartmentManagerNotFound
	}
	return nil
}

func IsDepartmentManager(departmentId, userId int) (bool, error) {
	if departmentId <= 0 || userId <= 0 {
		return false, nil
	}
	var count int64
	err := DB.Model(&DepartmentManager{}).
		Where("department_id = ? AND user_id = ?", departmentId, userId).
		Count(&count).Error
	return count > 0, err
}

func ListManagedDepartmentIDs(userId int) ([]int, error) {
	if userId <= 0 {
		return []int{}, nil
	}
	var ids []int
	err := DB.Model(&DepartmentManager{}).
		Where("user_id = ?", userId).
		Order("department_id asc").
		Pluck("department_id", &ids).Error
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = []int{}
	}
	return ids, nil
}

func ListDepartmentManagers(departmentId int) ([]*DepartmentManagerView, error) {
	if departmentId <= 0 {
		return nil, errors.New("invalid department id")
	}
	var rows []DepartmentManager
	if err := DB.Where("department_id = ?", departmentId).
		Order("id asc").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []*DepartmentManagerView{}, nil
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
	views := make([]*DepartmentManagerView, 0, len(rows))
	for _, row := range rows {
		view := &DepartmentManagerView{
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
