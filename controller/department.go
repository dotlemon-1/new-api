package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type departmentSyncRequest struct {
	Rows []departmentSyncRow `json:"rows"`
}

type departmentSyncRow struct {
	DeptNo   string `json:"dept_no"`
	DeptID   string `json:"dept_id"`
	DeptName string `json:"dept_name"`
	CompNo   string `json:"comp_no"`
	PDeptNo  string `json:"p_dept_no"`
	PDeptID  string `json:"p_dept_id"`
	Level    int    `json:"level"`
	IsSealUp int    `json:"issealup"`
	IsDel    int    `json:"is_del"`
	FOrder   int    `json:"f_order"`
	DeptType string `json:"dept_type"`
}

type departmentQuotaRequest struct {
	Quota  int    `json:"quota"`
	Remark string `json:"remark"`
}

type departmentGrantRequest struct {
	UserId int    `json:"user_id"`
	Quota  int    `json:"quota"`
	Remark string `json:"remark"`
}

type departmentManagerRequest struct {
	UserId int `json:"user_id"`
}

type departmentMemberRequest struct {
	UserId int `json:"user_id"`
}

type departmentTransferRequest struct {
	ToDepartmentId int    `json:"to_department_id"`
	Quota          int    `json:"quota"`
	Remark         string `json:"remark"`
}

type departmentReclaimRequest struct {
	UserId int    `json:"user_id"`
	Quota  int    `json:"quota"`
	Remark string `json:"remark"`
}

func isPlatformAdmin(c *gin.Context) bool {
	return c.GetInt("role") >= common.RoleAdminUser
}

// departmentAuditLabel returns 「名称」 when available, otherwise the numeric id.
func departmentAuditLabel(departmentId int) string {
	dept, err := model.GetDepartmentById(departmentId)
	if err != nil || dept.Name == "" {
		return strconv.Itoa(departmentId)
	}
	return "「" + dept.Name + "」"
}

// userAuditLabel returns 「username」 when available, otherwise the numeric id.
func userAuditLabel(userId int) string {
	username, err := model.GetUsernameById(userId, false)
	if err != nil || username == "" {
		return strconv.Itoa(userId)
	}
	return "「" + username + "」"
}

func canAccessDepartment(c *gin.Context, departmentId int) bool {
	if isPlatformAdmin(c) {
		return true
	}
	ok, err := model.CanManageDepartment(departmentId, c.GetInt("id"))
	return err == nil && ok
}

func requireDepartmentAccess(c *gin.Context, departmentId int) bool {
	if canAccessDepartment(c, departmentId) {
		return true
	}
	common.ApiErrorT(c, "Access denied")
	return false
}

func GetDepartments(c *gin.Context) {
	var (
		depts []*model.DepartmentListItem
		err   error
	)
	if isPlatformAdmin(c) {
		depts, err = model.ListDepartmentsWithWallets()
	} else {
		ids, listErr := model.ListAccessibleDepartmentIDs(c.GetInt("id"))
		if listErr != nil {
			common.ApiError(c, listErr)
			return
		}
		depts, err = model.ListDepartmentsWithWalletsForIDs(ids)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, depts)
}

func SyncDepartments(c *gin.Context) {
	var req departmentSyncRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len(req.Rows) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	rows := make([]model.HROrgDeptRow, 0, len(req.Rows))
	for _, row := range req.Rows {
		rows = append(rows, model.HROrgDeptRow{
			DeptNo:   row.DeptNo,
			DeptID:   row.DeptID,
			DeptName: row.DeptName,
			CompNo:   row.CompNo,
			PDeptNo:  row.PDeptNo,
			PDeptID:  row.PDeptID,
			Level:    row.Level,
			IsSealUp: row.IsSealUp,
			IsDel:    row.IsDel,
			FOrder:   row.FOrder,
			DeptType: row.DeptType,
		})
	}
	if err := model.SyncDepartmentsFromHRRows(rows); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "department.sync", map[string]any{"row_count": len(rows)})
	common.ApiSuccess(c, nil)
}

func TopupDepartment(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req departmentQuotaRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"department_id":           id,
		"department_label":        departmentAuditLabel(id),
		"requested_quota":         req.Quota,
		"requested_quota_display": logger.FormatQuota(req.Quota),
		"remark":                  req.Remark,
	}
	success := false
	defer func() {
		content := "部门额度充值失败"
		if success {
			content = auditContentEN("department.quota_topup", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.quota_topup", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.TopupDepartment(id, req.Quota, c.GetInt("id"), req.Remark)
	if err != nil {
		writeDepartmentQuotaError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func GrantDepartmentQuota(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !requireDepartmentAccess(c, id) {
		return
	}
	var req departmentGrantRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"department_id":           id,
		"department_label":        departmentAuditLabel(id),
		"target_user_id":          req.UserId,
		"target_user_label":       userAuditLabel(req.UserId),
		"requested_quota":         req.Quota,
		"requested_quota_display": logger.FormatQuota(req.Quota),
		"remark":                  req.Remark,
	}
	success := false
	defer func() {
		content := "部门额度发放失败"
		if success {
			content = auditContentEN("department.quota_grant", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.quota_grant", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.GrantDepartmentToUser(id, req.UserId, req.Quota, c.GetInt("id"), req.Remark)
	if err != nil {
		writeDepartmentQuotaError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func GetDepartmentLedger(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !requireDepartmentAccess(c, id) {
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.GetDepartmentLedger(id, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func TransferDepartmentQuota(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !requireDepartmentAccess(c, id) {
		return
	}
	var req departmentTransferRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"department_id":           id,
		"department_label":        departmentAuditLabel(id),
		"to_department_id":        req.ToDepartmentId,
		"to_department_label":     departmentAuditLabel(req.ToDepartmentId),
		"requested_quota":         req.Quota,
		"requested_quota_display": logger.FormatQuota(req.Quota),
		"remark":                  req.Remark,
	}
	success := false
	defer func() {
		content := "部门额度划拨失败"
		if success {
			content = auditContentEN("department.quota_transfer", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.quota_transfer", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.TransferDepartmentQuota(id, req.ToDepartmentId, req.Quota, c.GetInt("id"), req.Remark)
	if err != nil {
		writeDepartmentQuotaError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func ReclaimDepartmentQuota(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !requireDepartmentAccess(c, id) {
		return
	}
	var req departmentReclaimRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"department_id":           id,
		"department_label":        departmentAuditLabel(id),
		"target_user_id":          req.UserId,
		"target_user_label":       userAuditLabel(req.UserId),
		"requested_quota":         req.Quota,
		"requested_quota_display": logger.FormatQuota(req.Quota),
		"remark":                  req.Remark,
	}
	success := false
	defer func() {
		content := "部门额度回收失败"
		if success {
			content = auditContentEN("department.quota_reclaim", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.quota_reclaim", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.ReclaimDepartmentFromUser(id, req.UserId, req.Quota, c.GetInt("id"), req.Remark)
	if err != nil {
		writeDepartmentQuotaError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func SearchDepartmentGrantUsers(c *gin.Context) {
	if !isPlatformAdmin(c) {
		ok, err := model.IsDepartmentManagerOfAny(c.GetInt("id"))
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if !ok {
			common.ApiErrorT(c, "Access denied")
			return
		}
	}
	keyword := c.Query("keyword")
	pageInfo := common.GetPageQuery(c)

	var (
		users []*model.User
		total int64
		err   error
	)
	if deptIDRaw := c.Query("department_id"); deptIDRaw != "" {
		deptID, parseErr := strconv.Atoi(deptIDRaw)
		if parseErr != nil || deptID <= 0 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		if !requireDepartmentAccess(c, deptID) {
			return
		}
		users, total, err = model.SearchUsersInDepartmentSubtree(
			deptID,
			keyword,
			pageInfo.GetStartIdx(),
			pageInfo.GetPageSize(),
		)
	} else {
		users, total, err = model.SearchUsers(keyword, "", nil, nil, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(users)
	common.ApiSuccess(c, pageInfo)
}

func ListDepartmentManagers(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !requireDepartmentAccess(c, id) {
		return
	}
	managers, err := model.ListDepartmentManagers(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, managers)
}

func AssignDepartmentManager(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req departmentManagerRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if req.UserId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"department_id":     id,
		"department_label":  departmentAuditLabel(id),
		"target_user_id":    req.UserId,
		"target_user_label": userAuditLabel(req.UserId),
	}
	success := false
	defer func() {
		content := "指派部门管理人失败"
		if success {
			content = auditContentEN("department.manager_assign", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.manager_assign", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.AssignDepartmentManager(id, req.UserId)
	if err != nil {
		writeDepartmentManagerError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func RemoveDepartmentManager(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	userId, err := strconv.Atoi(c.Param("userId"))
	if err != nil || userId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"department_id":     id,
		"department_label":  departmentAuditLabel(id),
		"target_user_id":    userId,
		"target_user_label": userAuditLabel(userId),
	}
	success := false
	defer func() {
		content := "移除部门管理人失败"
		if success {
			content = auditContentEN("department.manager_remove", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.manager_remove", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.RemoveDepartmentManager(id, userId)
	if err != nil {
		writeDepartmentManagerError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func writeDepartmentManagerError(c *gin.Context, err error, params model.AuditFields) {
	switch {
	case errors.Is(err, model.ErrInvalidDepartmentManager):
		params["failure_reason"] = "invalid_parameters"
		common.ApiErrorT(c, "Invalid parameters")
	case errors.Is(err, model.ErrDepartmentManagerUserMissing):
		params["failure_reason"] = "user_not_found"
		common.ApiErrorT(c, "User does not exist")
	case errors.Is(err, model.ErrDepartmentManagerNotFound):
		params["failure_reason"] = "manager_not_found"
		common.ApiErrorT(c, "Department manager not found")
	case errors.Is(err, gorm.ErrRecordNotFound):
		params["failure_reason"] = "not_found"
		common.ApiErrorT(c, "Department does not exist")
	default:
		params["failure_reason"] = "database_error"
		common.ApiError(c, err)
	}
}

func GetDepartmentWallet(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !requireDepartmentAccess(c, id) {
		return
	}
	wallet, err := model.GetDepartmentWallet(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Department does not exist")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, wallet)
}

func ListUnassignedDepartmentMembers(c *gin.Context) {
	if !isPlatformAdmin(c) {
		common.ApiErrorT(c, "Access denied")
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, err := model.ListUnassignedDepartmentUsers(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, items)
}

func ListDepartmentMembers(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !requireDepartmentAccess(c, id) {
		return
	}
	items, err := model.ListDepartmentMembers(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, items)
}

func SetDepartmentMember(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req departmentMemberRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if req.UserId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"department_id":     id,
		"department_label":  departmentAuditLabel(id),
		"target_user_id":    req.UserId,
		"target_user_label": userAuditLabel(req.UserId),
	}
	success := false
	defer func() {
		content := "设置部门成员失败"
		if success {
			content = auditContentEN("department.member_set", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.member_set", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.SetDepartmentMember(id, req.UserId)
	if err != nil {
		writeDepartmentMemberError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func ClearDepartmentMember(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("userId"))
	if err != nil || userId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := model.AuditFields{
		"target_user_id":    userId,
		"target_user_label": userAuditLabel(userId),
	}
	success := false
	defer func() {
		content := "移除部门成员失败"
		if success {
			content = auditContentEN("department.member_clear", params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), "department.member_clear", params,
			auditOperatorInfo(c), &model.AuditRequestInfo{
				Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success,
			}, c)
		markAuditLogged(c)
	}()

	err = model.ClearDepartmentMember(userId)
	if err != nil {
		writeDepartmentMemberError(c, err, params)
		return
	}
	success = true
	common.ApiSuccess(c, nil)
}

func writeDepartmentMemberError(c *gin.Context, err error, params model.AuditFields) {
	switch {
	case errors.Is(err, model.ErrInvalidDepartmentMember):
		params["failure_reason"] = "invalid_parameters"
		common.ApiErrorT(c, "Invalid parameters")
	case errors.Is(err, model.ErrDepartmentManagerUserMissing):
		params["failure_reason"] = "user_not_found"
		common.ApiErrorT(c, "User does not exist")
	case errors.Is(err, model.ErrDepartmentMemberNotFound):
		params["failure_reason"] = "member_not_found"
		common.ApiErrorT(c, "Department member not found")
	case errors.Is(err, gorm.ErrRecordNotFound):
		params["failure_reason"] = "not_found"
		common.ApiErrorT(c, "Department does not exist")
	default:
		params["failure_reason"] = "database_error"
		common.ApiError(c, err)
	}
}

func writeDepartmentQuotaError(c *gin.Context, err error, params model.AuditFields) {
	switch {
	case errors.Is(err, model.ErrInvalidDepartmentQuota):
		params["failure_reason"] = "invalid_parameters"
		common.ApiErrorT(c, "Invalid parameters")
	case errors.Is(err, model.ErrDepartmentDisabled):
		params["failure_reason"] = "department_disabled"
		common.ApiErrorT(c, "Department is disabled")
	case errors.Is(err, model.ErrDepartmentWalletInsufficient):
		params["failure_reason"] = "insufficient_quota"
		common.ApiErrorT(c, "Department wallet quota insufficient")
	case errors.Is(err, model.ErrUserQuotaInsufficient):
		params["failure_reason"] = "user_quota_insufficient"
		common.ApiErrorT(c, "User quota insufficient")
	case errors.Is(err, model.ErrDepartmentReclaimUserOutOfScope):
		params["failure_reason"] = "user_out_of_scope"
		common.ApiErrorT(c, "User is not in this department or its sub-departments")
	case errors.Is(err, model.ErrDepartmentTransferNotDescendant):
		params["failure_reason"] = "not_descendant"
		common.ApiErrorT(c, "Transfer target must be a descendant department")
	case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
		params["failure_reason"] = "quota_limit_exceeded"
		common.ApiError(c, err)
	case errors.Is(err, gorm.ErrRecordNotFound):
		params["failure_reason"] = "not_found"
		common.ApiErrorT(c, "Department does not exist")
	default:
		params["failure_reason"] = "database_error"
		common.ApiError(c, err)
	}
}
