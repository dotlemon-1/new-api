package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

// HROrgDeptRow is one row from HR_ORG_DEPT (or an equivalent export).
type HROrgDeptRow struct {
	DeptNo   string
	DeptID   string
	DeptName string
	CompNo   string
	PDeptNo  string
	PDeptID  string
	Level    int
	IsSealUp int
	IsDel    int
	FOrder   int
	DeptType string
}

// isRootParentRef reports whether an HR parent reference means "no parent".
// Real department "00" (group company parent of many units) must NOT be treated
// as a sentinel — only empty / "-1" are roots in HR_ORG_DEPT.
func isRootParentRef(ref string) bool {
	ref = strings.TrimSpace(ref)
	return ref == "" || ref == "-1"
}

func hrRowDisabled(row HROrgDeptRow) bool {
	return row.IsDel != 0 || row.IsSealUp != 0
}

// SyncDepartmentsFromHRRows upserts departments by DEPT_ID, resolves parents
// primarily via P_DEPT_ID (with P_DEPT_NO fallback), and ensures wallets.
// Legacy rows that only have external_no are matched once and then rebound to DEPT_ID.
func SyncDepartmentsFromHRRows(rows []HROrgDeptRow) error {
	now := time.Now()
	return DB.Transaction(func(tx *gorm.DB) error {
		for _, row := range rows {
			externalID := strings.TrimSpace(row.DeptID)
			externalNo := strings.TrimSpace(row.DeptNo)
			if externalID == "" || externalNo == "" {
				continue
			}
			status := DepartmentStatusEnabled
			if hrRowDisabled(row) {
				status = DepartmentStatusDisabled
			}
			parentExternalID := strings.TrimSpace(row.PDeptID)
			parentExternalNo := strings.TrimSpace(row.PDeptNo)
			if isRootParentRef(parentExternalID) {
				parentExternalID = ""
			}
			if isRootParentRef(parentExternalNo) {
				parentExternalNo = ""
			}

			var existing Department
			err := tx.Where("external_id = ?", externalID).First(&existing).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				err = tx.Where("external_no = ?", externalNo).First(&existing).Error
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				dept := Department{
					ExternalNo:       externalNo,
					ExternalId:       externalID,
					Name:             strings.TrimSpace(row.DeptName),
					CompanyNo:        strings.TrimSpace(row.CompNo),
					ParentExternalNo: parentExternalNo,
					ParentExternalId: parentExternalID,
					Level:            row.Level,
					SortOrder:        row.FOrder,
					SourceType:       strings.TrimSpace(row.DeptType),
					Status:           status,
					LastSyncedAt:     &now,
				}
				if err := tx.Create(&dept).Error; err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}

			if err := tx.Model(&existing).Updates(map[string]any{
				"external_id":        externalID,
				"external_no":        externalNo,
				"name":               strings.TrimSpace(row.DeptName),
				"company_no":         strings.TrimSpace(row.CompNo),
				"parent_external_no": parentExternalNo,
				"parent_external_id": parentExternalID,
				"level":              row.Level,
				"sort_order":         row.FOrder,
				"source_type":        strings.TrimSpace(row.DeptType),
				"status":             status,
				"last_synced_at":     &now,
			}).Error; err != nil {
				return err
			}
		}

		var depts []Department
		if err := tx.Find(&depts).Error; err != nil {
			return err
		}
		byID := make(map[string]int, len(depts))
		byNo := make(map[string]int, len(depts))
		for _, d := range depts {
			if d.ExternalId != "" {
				byID[d.ExternalId] = d.Id
			}
			if d.ExternalNo != "" {
				byNo[d.ExternalNo] = d.Id
			}
		}
		for _, d := range depts {
			var parentID *int
			if d.ParentExternalId != "" {
				if pid, ok := byID[d.ParentExternalId]; ok {
					parentID = &pid
				}
			}
			if parentID == nil && d.ParentExternalNo != "" {
				if pid, ok := byNo[d.ParentExternalNo]; ok {
					parentID = &pid
				}
			}
			if err := tx.Model(&Department{}).Where("id = ?", d.Id).Update("parent_id", parentID).Error; err != nil {
				return err
			}
			if err := EnsureDepartmentWalletTx(tx, d.Id); err != nil {
				return err
			}
		}
		return nil
	})
}
