package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
)

// migrateDepartmentSyncKeys prepares departments for DEPT_ID-based sync:
// backfills blank external_id, and drops the legacy unique index on external_no
// so AutoMigrate can recreate a non-unique index and add unique(external_id).
func migrateDepartmentSyncKeys() error {
	if DB == nil {
		return nil
	}
	migrator := DB.Migrator()
	if !migrator.HasTable(&Department{}) {
		return nil
	}

	// Legacy rows synced only by DEPT_NO may have empty external_id. Use
	// external_no as a temporary value so the unique index can be created;
	// the next HR sync rebinds them to the real DEPT_ID via external_no match.
	if err := DB.Exec(
		"UPDATE departments SET external_id = external_no WHERE external_id IS NULL OR external_id = ''",
	).Error; err != nil {
		return fmt.Errorf("backfill department external_id: %w", err)
	}

	for _, indexName := range []string{
		"idx_departments_external_no",
		"uni_departments_external_no",
		"ExternalNo",
	} {
		if !migrator.HasIndex(&Department{}, indexName) {
			continue
		}
		if err := migrator.DropIndex(&Department{}, indexName); err != nil {
			common.SysError(common.LogText(
				"failed to drop legacy department index %s: %s",
				indexName,
				err.Error(),
			))
		}
	}
	return nil
}
