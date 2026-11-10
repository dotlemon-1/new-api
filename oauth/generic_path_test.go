package oauth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/tidwall/gjson"
)

func TestNormalizeGjsonPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "bracket index",
			in:   "data.userDepartments[0].department.deptNo",
			want: "data.userDepartments.0.department.deptNo",
		},
		{
			name: "already gjson index",
			in:   "data.userDepartments.0.department.deptNo",
			want: "data.userDepartments.0.department.deptNo",
		},
		{
			name: "nested brackets",
			in:   "a[1].b[2].c",
			want: "a.1.b.2.c",
		},
		{
			name: "trim spaces",
			in:   "  data.id  ",
			want: "data.id",
		},
		{
			name: "empty",
			in:   "   ",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, normalizeGjsonPath(tt.in))
		})
	}
}

func TestNormalizeGjsonPathExtractsDepartment(t *testing.T) {
	t.Parallel()

	body := `{"data":{"userDepartments":[{"department":{"deptNo":"10102"}}]}}`
	path := normalizeGjsonPath("data.userDepartments[0].department.deptNo")
	assert.Equal(t, "10102", gjson.Get(body, path).String())
}
