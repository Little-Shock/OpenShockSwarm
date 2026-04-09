package store

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
)

var (
	customerVisibleQuestionBurstPattern = regexp.MustCompile(`\?{2,}`)
	customerVisibleE2EResiduePattern    = regexp.MustCompile(`(?i)\be2e\b.*\b20\d{6,}\b`)
	customerVisiblePlaceholderPattern   = regexp.MustCompile(`(?i)\bplaceholder\b|\bfixture\b|\btest-only\b`)
	customerVisibleMockPattern          = regexp.MustCompile(`本地 mock|还在 mock|mock 频道|mock room|mock 卡片|mock issue|mock run|mock agent|mock workspace`)
	customerVisiblePathPattern          = regexp.MustCompile(`[A-Za-z]:\\|/tmp/openshock|/home/lark/OpenShock|\.openshock-worktrees|\.slock/`)
)

func sanitizeArtifactSnapshotContent(content string) string {
	if strings.TrimSpace(content) == "" {
		return content
	}

	lines := strings.Split(content, "\n")
	changed := false
	for index, line := range lines {
		sanitized := sanitizeArtifactSnapshotLine(line)
		if sanitized != line {
			lines[index] = sanitized
			changed = true
		}
	}
	if !changed {
		return content
	}
	return strings.Join(lines, "\n")
}

func sanitizeArtifactSnapshotLine(line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || !looksLikeCustomerVisibleResidue(trimmed) {
		return line
	}

	indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
	trimmedLeft := strings.TrimLeft(line, " \t")

	if marker, ok := markdownHeadingMarker(trimmedLeft); ok {
		return indent + marker + "已清理历史残留"
	}

	if strings.HasPrefix(trimmedLeft, "- ") {
		return indent + "- 这条历史记录包含测试残留或乱码，已从当前工作区隐藏。"
	}

	if index := strings.Index(line, ": "); index != -1 {
		return line[:index+2] + "这条历史记录包含测试残留或乱码，已从当前工作区隐藏。"
	}

	return indent + "这条历史记录包含测试残留或乱码，已从当前工作区隐藏。"
}

func markdownHeadingMarker(line string) (string, bool) {
	if !strings.HasPrefix(line, "#") {
		return "", false
	}
	count := 0
	for count < len(line) && line[count] == '#' {
		count++
	}
	if count == 0 {
		return "", false
	}
	if count < len(line) && line[count] == ' ' {
		return line[:count+1], true
	}
	return line[:count] + " ", true
}

func looksLikeCustomerVisibleResidue(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	return customerVisibleQuestionBurstPattern.MatchString(trimmed) ||
		customerVisibleE2EResiduePattern.MatchString(trimmed) ||
		customerVisiblePlaceholderPattern.MatchString(lower) ||
		customerVisibleMockPattern.MatchString(trimmed) ||
		customerVisiblePathPattern.MatchString(trimmed)
}

func sanitizedArtifactDigest(content string) (string, int) {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:]), len(content)
}
