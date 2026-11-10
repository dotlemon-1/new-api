package model

import "time"

const (
	DepartmentLedgerTopup       = "topup"
	DepartmentLedgerGrantUser   = "grant_user"
	DepartmentLedgerTransferOut = "transfer_out"
	DepartmentLedgerTransferIn  = "transfer_in"
	DepartmentLedgerReclaimUser = "reclaim_user"
)

// DepartmentQuotaLedger records every department wallet balance change.
// Amount is the department-wallet delta: topup > 0, grant_user < 0,
// transfer_out < 0, transfer_in > 0, reclaim_user > 0.
type DepartmentQuotaLedger struct {
	Id                       int       `json:"id"`
	DepartmentId             int       `json:"department_id" gorm:"index;not null"`
	Type                     string    `json:"type" gorm:"type:varchar(32);index;not null"`
	Amount                   int       `json:"amount" gorm:"not null"`
	DeptQuotaBefore          int       `json:"dept_quota_before"`
	DeptQuotaAfter           int       `json:"dept_quota_after"`
	TargetUserId             int       `json:"target_user_id" gorm:"index"`
	CounterpartyDepartmentId int       `json:"counterparty_department_id" gorm:"index"`
	OperatorUserId           int       `json:"operator_user_id" gorm:"index"`
	Remark                   string    `json:"remark" gorm:"type:varchar(512)"`
	CreatedAt                time.Time `json:"created_at" gorm:"index"`
}

func (DepartmentQuotaLedger) TableName() string {
	return "department_quota_ledgers"
}

func GetDepartmentLedger(departmentId int, offset, limit int) ([]*DepartmentQuotaLedger, int64, error) {
	var total int64
	query := DB.Model(&DepartmentQuotaLedger{}).Where("department_id = ?", departmentId)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []*DepartmentQuotaLedger
	err := query.Order("id desc").Offset(offset).Limit(limit).Find(&items).Error
	return items, total, err
}
