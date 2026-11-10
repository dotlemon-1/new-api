package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrDepartmentWalletInsufficient    = errors.New("department wallet quota insufficient")
	ErrDepartmentDisabled              = errors.New("department is disabled")
	ErrInvalidDepartmentQuota          = errors.New("invalid department quota amount")
	ErrDepartmentTransferNotDescendant = errors.New("transfer target must be a descendant department")
	ErrUserQuotaInsufficient           = errors.New("user quota insufficient")
	ErrDepartmentReclaimUserOutOfScope = errors.New("user is not in this department subtree")
)

// DepartmentWallet holds the spendable quota pool for one department.
type DepartmentWallet struct {
	Id           int       `json:"id"`
	DepartmentId int       `json:"department_id" gorm:"uniqueIndex;not null"`
	Quota        int       `json:"quota" gorm:"type:int;default:0"`
	UsedQuota    int       `json:"used_quota" gorm:"type:int;default:0;column:used_quota"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DepartmentWallet) TableName() string {
	return "department_wallets"
}

func EnsureDepartmentWallet(departmentId int) (*DepartmentWallet, error) {
	if departmentId <= 0 {
		return nil, errors.New("invalid department id")
	}
	wallet := DepartmentWallet{DepartmentId: departmentId}
	err := DB.Where(DepartmentWallet{DepartmentId: departmentId}).
		Attrs(DepartmentWallet{Quota: 0, UsedQuota: 0}).
		FirstOrCreate(&wallet).Error
	if err != nil {
		return nil, err
	}
	return &wallet, nil
}

func GetDepartmentWallet(departmentId int) (*DepartmentWallet, error) {
	var wallet DepartmentWallet
	if err := DB.Where("department_id = ?", departmentId).First(&wallet).Error; err != nil {
		return nil, err
	}
	return &wallet, nil
}

func getDepartmentWalletForUpdate(tx *gorm.DB, departmentId int) (*DepartmentWallet, error) {
	var wallet DepartmentWallet
	err := lockForUpdate(tx).Where("department_id = ?", departmentId).First(&wallet).Error
	if err != nil {
		return nil, err
	}
	return &wallet, nil
}

func ensureDepartmentEnabled(tx *gorm.DB, departmentId int) error {
	var dept Department
	if err := tx.Select("id", "status").First(&dept, departmentId).Error; err != nil {
		return err
	}
	if dept.Status != DepartmentStatusEnabled {
		return ErrDepartmentDisabled
	}
	return nil
}

func increaseUserQuotaTx(tx *gorm.DB, id int, quota int) error {
	if quota < 0 {
		return errors.New("quota cannot be negative")
	}
	if err := common.ValidateWalletQuota(quota); err != nil {
		return err
	}
	result := tx.Model(&User{}).
		Where("id = ? AND quota <= ?", id, common.MaxWalletQuota-quota).
		Update("quota", gorm.Expr("quota + ?", quota))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var count int64
	if err := tx.Model(&User{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return ErrWalletQuotaLimitExceeded
}

func decreaseUserQuotaTx(tx *gorm.DB, id int, quota int) error {
	if quota < 0 {
		return errors.New("quota cannot be negative")
	}
	if err := common.ValidateWalletQuota(quota); err != nil {
		return err
	}
	result := tx.Model(&User{}).
		Where("id = ? AND quota >= ?", id, quota).
		Update("quota", gorm.Expr("quota - ?", quota))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var count int64
	if err := tx.Model(&User{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return ErrUserQuotaInsufficient
}

// TopupDepartment adds quota to a department wallet and writes a ledger row.
func TopupDepartment(departmentId, amount, operatorUserId int, remark string) error {
	if amount <= 0 {
		return ErrInvalidDepartmentQuota
	}
	if err := common.ValidateWalletQuota(amount); err != nil {
		return err
	}
	if _, err := EnsureDepartmentWallet(departmentId); err != nil {
		return err
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		if err := ensureDepartmentEnabled(tx, departmentId); err != nil {
			return err
		}
		wallet, err := getDepartmentWalletForUpdate(tx, departmentId)
		if err != nil {
			return err
		}
		before := wallet.Quota
		after := before + amount
		if after > common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		result := tx.Model(&DepartmentWallet{}).Where("id = ?", wallet.Id).Update("quota", after)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Create(&DepartmentQuotaLedger{
			DepartmentId:    departmentId,
			Type:            DepartmentLedgerTopup,
			Amount:          amount,
			DeptQuotaBefore: before,
			DeptQuotaAfter:  after,
			OperatorUserId:  operatorUserId,
			Remark:          remark,
		}).Error
	})
}

// GrantDepartmentToUser moves quota from a department wallet to a user wallet.
func GrantDepartmentToUser(departmentId, userId, amount, operatorUserId int, remark string) error {
	if amount <= 0 {
		return ErrInvalidDepartmentQuota
	}
	if userId <= 0 {
		return ErrInvalidDepartmentQuota
	}
	if err := common.ValidateWalletQuota(amount); err != nil {
		return err
	}
	if _, err := EnsureDepartmentWallet(departmentId); err != nil {
		return err
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := ensureDepartmentEnabled(tx, departmentId); err != nil {
			return err
		}
		wallet, err := getDepartmentWalletForUpdate(tx, departmentId)
		if err != nil {
			return err
		}
		if wallet.Quota < amount {
			return ErrDepartmentWalletInsufficient
		}
		before := wallet.Quota
		after := before - amount
		result := tx.Model(&DepartmentWallet{}).
			Where("id = ? AND quota >= ?", wallet.Id, amount).
			Updates(map[string]any{
				"quota":      after,
				"used_quota": gorm.Expr("used_quota + ?", amount),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDepartmentWalletInsufficient
		}
		if err := increaseUserQuotaTx(tx, userId, amount); err != nil {
			return err
		}
		return tx.Create(&DepartmentQuotaLedger{
			DepartmentId:    departmentId,
			Type:            DepartmentLedgerGrantUser,
			Amount:          -amount,
			DeptQuotaBefore: before,
			DeptQuotaAfter:  after,
			TargetUserId:    userId,
			OperatorUserId:  operatorUserId,
			Remark:          remark,
		}).Error
	})
	if err != nil {
		return err
	}
	if cacheErr := cacheIncrUserQuota(userId, int64(amount)); cacheErr != nil {
		common.SysError(common.LogText("failed to sync department grant cache for user %d: %s", userId, cacheErr.Error()))
	}
	return nil
}

// EnsureDepartmentWalletTx creates the wallet row inside an existing transaction if missing.
func EnsureDepartmentWalletTx(tx *gorm.DB, departmentId int) error {
	wallet := DepartmentWallet{DepartmentId: departmentId, Quota: 0, UsedQuota: 0}
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "department_id"}},
		DoNothing: true,
	}).Create(&wallet).Error
}

// TransferDepartmentQuota moves quota from a parent department wallet to a
// descendant. Locks both wallets by ascending department_id to avoid deadlocks.
func TransferDepartmentQuota(fromId, toId, amount, operatorUserId int, remark string) error {
	if amount <= 0 || fromId <= 0 || toId <= 0 || fromId == toId {
		return ErrInvalidDepartmentQuota
	}
	if err := common.ValidateWalletQuota(amount); err != nil {
		return err
	}
	ok, err := IsDepartmentDescendant(toId, fromId)
	if err != nil {
		return err
	}
	if !ok {
		return ErrDepartmentTransferNotDescendant
	}
	if _, err := EnsureDepartmentWallet(fromId); err != nil {
		return err
	}
	if _, err := EnsureDepartmentWallet(toId); err != nil {
		return err
	}

	firstID, secondID := fromId, toId
	if secondID < firstID {
		firstID, secondID = secondID, firstID
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		if err := ensureDepartmentEnabled(tx, fromId); err != nil {
			return err
		}
		if err := ensureDepartmentEnabled(tx, toId); err != nil {
			return err
		}
		firstWallet, err := getDepartmentWalletForUpdate(tx, firstID)
		if err != nil {
			return err
		}
		secondWallet, err := getDepartmentWalletForUpdate(tx, secondID)
		if err != nil {
			return err
		}
		fromWallet, toWallet := firstWallet, secondWallet
		if fromId != firstID {
			fromWallet, toWallet = secondWallet, firstWallet
		}
		if fromWallet.Quota < amount {
			return ErrDepartmentWalletInsufficient
		}
		fromBefore := fromWallet.Quota
		fromAfter := fromBefore - amount
		toBefore := toWallet.Quota
		toAfter := toBefore + amount
		if toAfter > common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		result := tx.Model(&DepartmentWallet{}).
			Where("id = ? AND quota >= ?", fromWallet.Id, amount).
			Update("quota", fromAfter)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDepartmentWalletInsufficient
		}
		result = tx.Model(&DepartmentWallet{}).Where("id = ?", toWallet.Id).Update("quota", toAfter)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Create(&DepartmentQuotaLedger{
			DepartmentId:             fromId,
			Type:                     DepartmentLedgerTransferOut,
			Amount:                   -amount,
			DeptQuotaBefore:          fromBefore,
			DeptQuotaAfter:           fromAfter,
			CounterpartyDepartmentId: toId,
			OperatorUserId:           operatorUserId,
			Remark:                   remark,
		}).Error; err != nil {
			return err
		}
		return tx.Create(&DepartmentQuotaLedger{
			DepartmentId:             toId,
			Type:                     DepartmentLedgerTransferIn,
			Amount:                   amount,
			DeptQuotaBefore:          toBefore,
			DeptQuotaAfter:           toAfter,
			CounterpartyDepartmentId: fromId,
			OperatorUserId:           operatorUserId,
			Remark:                   remark,
		}).Error
	})
}

// ReclaimDepartmentFromUser moves quota from a user wallet back to a department
// wallet. The user must be a member of that department or one of its descendants.
// Recyclable amount is capped by the user's current quota (not by which grant
// originally funded it). used_quota is reduced but never below zero.
func ReclaimDepartmentFromUser(departmentId, userId, amount, operatorUserId int, remark string) error {
	if amount <= 0 || userId <= 0 || departmentId <= 0 {
		return ErrInvalidDepartmentQuota
	}
	if err := common.ValidateWalletQuota(amount); err != nil {
		return err
	}
	inScope, err := IsUserInDepartmentSubtree(userId, departmentId)
	if err != nil {
		return err
	}
	if !inScope {
		return ErrDepartmentReclaimUserOutOfScope
	}
	if _, err := EnsureDepartmentWallet(departmentId); err != nil {
		return err
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := ensureDepartmentEnabled(tx, departmentId); err != nil {
			return err
		}
		wallet, err := getDepartmentWalletForUpdate(tx, departmentId)
		if err != nil {
			return err
		}
		before := wallet.Quota
		after := before + amount
		if after > common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		usedAfter := wallet.UsedQuota - amount
		if usedAfter < 0 {
			usedAfter = 0
		}
		if err := decreaseUserQuotaTx(tx, userId, amount); err != nil {
			return err
		}
		result := tx.Model(&DepartmentWallet{}).Where("id = ?", wallet.Id).Updates(map[string]any{
			"quota":      after,
			"used_quota": usedAfter,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Create(&DepartmentQuotaLedger{
			DepartmentId:    departmentId,
			Type:            DepartmentLedgerReclaimUser,
			Amount:          amount,
			DeptQuotaBefore: before,
			DeptQuotaAfter:  after,
			TargetUserId:    userId,
			OperatorUserId:  operatorUserId,
			Remark:          remark,
		}).Error
	})
	if err != nil {
		return err
	}
	if cacheErr := cacheDecrUserQuota(userId, int64(amount)); cacheErr != nil {
		common.SysError(common.LogText("failed to sync department reclaim cache for user %d: %s", userId, cacheErr.Error()))
	}
	return nil
}
